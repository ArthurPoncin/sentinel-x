#!/usr/bin/env bash
# Plug and play: turns a Raspberry Pi 4 into the Command Post and flashes the Sentinel plugged
# into one of its USB ports. Run it on the Pi, from the repo root, as your usual user, the first
# time while the Pi has Internet through Ethernet:
#   infra/plug-and-play.sh <table number>        e.g. infra/plug-and-play.sh 4 → the Pi is 192.168.4.1
# It then works offline: run it again after a git pull, or to reflash, it keeps what exists.
#   --no-flash   leaves the ESP32 alone
# From the environment, all optional: WIFI_PASSPHRASE (else made once, kept in
# infra/secrets/wifi.env), WIFI_SSID (SentinelX-<table>), WIFI_CHANNEL (6), WIFI_COUNTRY (FR),
# OPERATOR_PASSWORD (else asked), ESP32_PORT (else the first /dev/ttyUSB*).
#
# Its interface is infra/ui.sh, in French like the step-by-step (docs/INSTALLATION-PI.md): everything
# it needs (sudo, the Operator password) is asked first, then ten steps run on their own, the
# commands' output kept in ~/.local/share/sentinel-x/plug-and-play.log.
# The images are pulled from GHCR when the CI published them for this very code (infra/images.sh,
# .github/workflows/images.yml), and built on the Pi only otherwise: that is most of the time saved.
set -euo pipefail

usage() { echo "Usage : infra/plug-and-play.sh <numéro de table> [--no-flash]" >&2; exit 1; }
table="" flash=true
for arg in "$@"; do
  case "$arg" in
    --no-flash) flash=false ;;
    *) [[ -z "$table" ]] || usage; table="$arg" ;;
  esac
done
if [[ ! "$table" =~ ^[0-9]{1,3}$ ]] || ((10#$table > 254)); then usage; fi
table=$((10#$table))

pi_ip="192.168.${table}.1"
sentinel_ip="192.168.${table}.10"
ssid="${WIFI_SSID:-SentinelX-$table}"
channel="${WIFI_CHANNEL:-6}"
country="${WIFI_COUNTRY:-FR}"
pio_venv="$HOME/.local/share/sentinel-x/platformio"
pio="$pio_venv/bin/pio"

cd "$(dirname "$0")/.."
secrets=infra/secrets
# shellcheck source=infra/ui.sh
source infra/ui.sh

# with_group, pull_images, build_image: shared with infra/update.sh.
# shellcheck source=infra/pull.sh
source infra/pull.sh

# What the steps run in the background, their output in the log. Each stops at its first error.
install_packages() {
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}
install_docker() { curl -fsSL https://get.docker.com | sudo sh; }
install_platformio() {
  python3 -m venv "$pio_venv"
  "$pio_venv/bin/pip" install platformio
}
start_access_point() {
  if command -v raspi-config >/dev/null; then sudo raspi-config nonint do_wifi_country "$country"; fi
  sudo rfkill unblock wifi || true
  local ap_settings=(
    802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel "$channel"
    wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.psk "$passphrase"
    ipv4.method manual ipv4.addresses "$pi_ip/24" ipv6.method disabled
    connection.autoconnect yes connection.autoconnect-priority 100
  )
  if nmcli -t -f NAME connection show | grep -qx sentinel-x-ap; then
    sudo nmcli connection modify sentinel-x-ap 802-11-wireless.ssid "$ssid" "${ap_settings[@]}"
  else
    sudo nmcli connection add type wifi ifname wlan0 con-name sentinel-x-ap ssid "$ssid" "${ap_settings[@]}"
  fi
  sudo nmcli connection up sentinel-x-ap
}
serve_dhcp_and_time() {
  # DHCP only: no DNS, no gateway. sentinel-01 always gets .10, by the name it sends.
  sudo tee /etc/dnsmasq.d/sentinel-x.conf >/dev/null <<DNSMASQ
# Sentinel-X table Wi-Fi. Made by infra/plug-and-play.sh.
port=0
interface=wlan0
bind-dynamic
dhcp-authoritative
dhcp-range=192.168.$table.100,192.168.$table.199,255.255.255.0,12h
dhcp-host=sentinel-01,$sentinel_ip
dhcp-option=3
dhcp-option=6
dhcp-option=option:ntp-server,$pi_ip
DNSMASQ
  sudo systemctl enable --quiet dnsmasq
  sudo systemctl restart dnsmasq
  # The table network has no Internet: the Pi gives the time, which stamps every reading.
  sudo mkdir -p /etc/chrony/conf.d
  sudo tee /etc/chrony/conf.d/sentinel-x.conf >/dev/null <<CHRONY
# Serves the time to the table Wi-Fi. Made by infra/plug-and-play.sh.
allow 192.168.$table.0/24
local stratum 10
CHRONY
  sudo systemctl enable --quiet chrony
  sudo systemctl restart chrony
}
# The status screen on the HDMI console, in place of the login prompt of tty1: ctrl+alt+F2 still
# gives one, with a keyboard.
install_screen() {
  sudo tee /etc/systemd/system/sentinel-x-screen.service >/dev/null <<UNIT
# The Command Post's status screen on the Pi's HDMI console (infra/screen.py). Made by infra/plug-and-play.sh.
[Unit]
Description=Sentinel-X status screen (HDMI, tty1)
After=systemd-user-sessions.service plymouth-quit-wait.service getty@tty1.service docker.service
Conflicts=getty@tty1.service

[Service]
User=$USER
ExecStart=/usr/bin/python3 "$PWD/infra/screen.py" $table
StandardInput=tty
StandardOutput=tty
StandardError=journal
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  sudo systemctl daemon-reload
  sudo systemctl disable --quiet getty@tty1.service
  sudo systemctl enable --quiet sentinel-x-screen.service
  sudo systemctl restart sentinel-x-screen.service
}
# What infra/servo.sh installed for the servo this motor replaced: a hardware PWM channel on GPIO 18,
# which is now the motor's IN2.
servo_unit=/etc/systemd/system/sentinel-x-servo.service
servo_overlay="dtoverlay=pwm,pin=18,func=2"
boot_config=/boot/firmware/config.txt
retire_servo() {
  sudo systemctl disable --now sentinel-x-servo.service || true
  sudo rm -f "$servo_unit"
  sudo systemctl daemon-reload
  if [[ -f "$boot_config" ]]; then
    sudo sed -i -e '/^# Sentinel-X: the camera servo, hardware PWM on GPIO 18/d' -e "/^$servo_overlay\$/d" "$boot_config"
  fi
}
open_firewall() {
  local rule
  for rule in 67/udp 123/udp 443/tcp 8883/tcp; do
    sudo ufw allow in on wlan0 to any port "${rule%/*}" proto "${rule#*/}"
  done
}
join() {
  local IFS=,
  local joined="$*"
  printf '%s' "${joined//,/, }"
}
wait_for_lease() {
  local _
  for _ in $(seq 60); do
    if grep -qs " $sentinel_ip " /var/lib/misc/dnsmasq.leases; then return 0; fi
    sleep 2
  done
  return 1
}
first_snapshot() {
  with_group docker docker compose exec -T mosquitto mosquitto_sub -h mosquitto -p 8883 \
    --cafile /mosquitto/config/certs/ca.crt -u api -P "$api_password" \
    -t sentinel/sentinel-01/telemetry -C 1 -W 60 >"$1"
}
# A snapshot as the Operator reads it: « 23.4 °C · 41 % · gaz 312 ». As it came when it does not parse.
readable_snapshot() {
  local json=$1 temp humidity air
  temp=$(sed -n 's/.*"temp":\([-0-9.]*\).*/\1/p' <<<"$json")
  humidity=$(sed -n 's/.*"humidity":\([-0-9.]*\).*/\1/p' <<<"$json")
  air=$(sed -n 's/.*"air":\([-0-9.]*\).*/\1/p' <<<"$json")
  if [[ -n $temp && -n $humidity && -n $air ]]; then
    printf 'première mesure : %s °C · humidité %s %% · gaz %s' "$temp" "$humidity" "$air"
  else
    printf 'première mesure : %s' "$json"
  fi
}

ui_init 10 "$HOME/.local/share/sentinel-x/plug-and-play.log" "infra/plug-and-play.sh $*"
ui_banner "SENTINEL-X · Command Post" "Table $table · Pi $pi_ip · Wi-Fi $ssid$($flash || echo " · sans flash")"

# --- Before the steps: what the Pi is, and everything to ask ----------------------------------
[[ "$(uname -s)" == Linux ]] || ui_fail "lance ce script sur le Raspberry Pi, pas sur un ordinateur."
grep -qs "Raspberry Pi" /proc/device-tree/model || ui_warn "ça ne ressemble pas à un Raspberry Pi : on continue quand même."
online=false
curl -fsS --max-time 5 -o /dev/null https://download.docker.com && online=true
if $online; then
  ui_ok "Internet joignable : ce qui manque sera téléchargé."
else
  ui_warn "pas d'Internet : seul ce qui est déjà installé servira."
fi
ui_sudo
# setup.sh makes the Operator's password hash with the credentials, once: asked now, not in the
# middle of a step.
if [[ ! -f "$secrets/api.env" && -z "${OPERATOR_PASSWORD:-}" ]]; then
  [[ -t 0 ]] || ui_fail "il faut le mot de passe Opérateur : lance le script dans un terminal, ou donne OPERATOR_PASSWORD."
  again=""
  while :; do
    ui_ask_secret OPERATOR_PASSWORD "Mot de passe Opérateur, celui du dashboard (12 caractères minimum) :"
    if ((${#OPERATOR_PASSWORD} < 12)); then ui_warn "trop court : 12 caractères minimum."; continue; fi
    ui_ask_secret again "Encore une fois :"
    [[ "$OPERATOR_PASSWORD" == "$again" ]] && break
    ui_warn "les deux ne correspondent pas : on recommence."
  done
  export OPERATOR_PASSWORD
fi
ui_ok "Tout est demandé : la suite se fait seule."

# --- 1. Software, while there is Internet ---------------------------------------------------
ui_step "Logiciels"
missing=()
for package in dnsmasq chrony python3-venv python3-paho-mqtt openssl curl; do
  dpkg -s "$package" >/dev/null 2>&1 || missing+=("$package")
done
if ((${#missing[@]})); then
  $online || ui_fail "paquets manquants (${missing[*]}) : branche l'Ethernet, puis relance."
  ui_run "installation de ${missing[*]}" install_packages "${missing[@]}"
fi
if ! command -v docker >/dev/null; then
  $online || ui_fail "Docker manque : branche l'Ethernet, puis relance."
  ui_run "installation de Docker" install_docker
fi
joined_docker=false
if ! id -nG | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  joined_docker=true
fi
if [[ ! -x "$pio" ]]; then
  $online || ui_fail "PlatformIO manque : branche l'Ethernet, puis relance."
  ui_run "installation de PlatformIO" install_platformio
fi
ui_detail "Docker, PlatformIO, dnsmasq (DHCP), chrony (heure)"
ui_done

# --- 2. The images: pulled when the CI built them for this code, built here otherwise -----------
ui_step "Images Docker"
results="$(mktemp)"
pulled=() built=() kept=() unpublished=() private=false
if $online; then
  ui_task "téléchargement des images préconstruites" pull_images "$results"
fi
for service in $(infra/images.sh list); do
  state="$(sed -n "s/^$service //p" "$results")"
  case "$state" in
    pulled) pulled+=("$service"); continue ;;
    private) private=true ;;
    missing) unpublished+=("$service") ;;
  esac
  # Offline, an image built before serves: better than none.
  if ! $online && with_group docker docker image inspect "sentinel-x/$service" >/dev/null 2>&1; then
    kept+=("$service")
    continue
  fi
  ui_task "construction de $service sur le Pi" build_image "$service"
  if ((UI_RC != 0)); then
    $online || ui_fail "l'image $service ne se construit pas sans Internet : branche l'Ethernet, puis relance."
    ui_fail "l'image $service ne se construit pas : la fin du journal dit pourquoi."
  fi
  built+=("$service")
done
rm -f "$results" "$results".*
if $private; then
  ui_note "les images préconstruites sont encore privées sur GitHub : il faut les rendre publiques une fois (paquets sentinel-x-* du dépôt, Package settings → Change visibility → Public). En attendant, elles se construisent ici, c'est plus long."
fi
if ((${#unpublished[@]})); then
  ui_note "pas encore d'image préconstruite pour ce code ($(join "${unpublished[@]}")) : la CI de GitHub la construit peut-être encore. Construite ici en attendant."
fi
summary_images=()
((${#pulled[@]})) && summary_images+=("téléchargées : $(join "${pulled[@]}")")
((${#built[@]})) && summary_images+=("construites ici : $(join "${built[@]}")")
((${#kept[@]})) && summary_images+=("gardées, sans Internet : $(join "${kept[@]}")")
images_detail=""
for part in "${summary_images[@]}"; do images_detail+="${images_detail:+ · }$part"; done
ui_detail "$images_detail"
ui_done

# --- 3. Secrets ------------------------------------------------------------------------------
ui_step "Secrets et certificats"
mkdir -p "$secrets" && chmod 700 "$secrets"
if [[ -n "${WIFI_PASSPHRASE:-}" ]]; then
  passphrase="$WIFI_PASSPHRASE"
elif [[ -f "$secrets/wifi.env" ]]; then
  passphrase="$(sed -n 's/^WIFI_PASSPHRASE=//p' "$secrets/wifi.env")"
else
  passphrase="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)"
fi
[[ "$passphrase" =~ ^[[:print:]]{8,63}$ ]] || ui_fail "la phrase de passe Wi-Fi doit faire 8 à 63 caractères imprimables."
(umask 077 && printf 'WIFI_SSID=%s\nWIFI_PASSPHRASE=%s\n' "$ssid" "$passphrase" >"$secrets/wifi.env")

# A broker certificate made before the ESP32 fix, or for another table: made again.
broker_crt="$secrets/mosquitto/broker.crt"
broker_remade=false
if [[ -f "$broker_crt" ]] && ! openssl x509 -in "$broker_crt" -noout -text 2>/dev/null | grep -q "DNS:$pi_ip"; then
  sudo rm -f "$broker_crt" "$secrets/mosquitto/broker.key"
  broker_remade=true
fi
# A proxy certificate made before the dashboard had a name: made again, by the same CA, so the
# Operator laptop has nothing to import again.
proxy_remade=false
if [[ -f "$secrets/caddy/proxy.crt" ]]; then
  proxy_text="$(openssl x509 -in "$secrets/caddy/proxy.crt" -noout -text 2>/dev/null || true)"
  if ! grep -q "IP Address:$pi_ip" <<<"$proxy_text"; then
    ui_note "le certificat HTTPS est celui d'une autre table : sudo rm infra/secrets/caddy/proxy.*, puis relance."
  elif ! grep -q "DNS:sentinel-x.local" <<<"$proxy_text"; then
    sudo rm -f "$secrets/caddy/proxy.crt" "$secrets/caddy/proxy.key"
    proxy_remade=true
  fi
fi
# The screen's MQTT account, new to a running broker: it must read passwd and the ACL again.
screen_account_new=false
[[ -f "$secrets/screen.env" ]] || screen_account_new=true
# The api image of the step before hashes the Operator's password: setup.sh need not build it again.
export API_IMAGE=sentinel-x/api
ui_run "certificats, comptes MQTT, jetons des services IA" with_group docker infra/setup.sh "$table"

sentinel_password="$(sed -n 's/.*user sentinel-01, password \([0-9a-f]*\).*/\1/p' "$secrets/handover.txt")"
api_password="$(sed -n 's/^MQTT_PASSWORD=//p' "$secrets/api.env")"
[[ -n "$sentinel_password" && -n "$api_password" ]] || ui_fail "pas de mots de passe MQTT dans infra/secrets : sudo rm -rf infra/secrets, puis relance."
ui_detail "dans infra/secrets, jamais commités"
ui_done

# --- 4. The webcam, and the motor that turns it ------------------------------------------------
ui_step "Webcam USB"
# Its node goes to vision only when it is plugged in: missing, Docker would refuse to start the
# container, and `docker compose up` would stop at step 5. Found by its name in /dev/v4l/by-id,
# which only USB devices get: whatever port it is on, and never one of the Pi's own video nodes.
# Each has its compose file, taken on top of docker-compose.yml only when it is there.
compose_files=docker-compose.yml
camera_ok=false
webcam=""
for node in /dev/v4l/by-id/usb-*-video-index0; do
  if [[ -z "$webcam" && -e "$node" ]]; then webcam="$node"; fi
done
touch .env
# The COMPOSE_FILE lines this step writes: with the webcam, with its motor, with both. And what the
# servo this motor replaced left there.
sed -i -e '\|^COMPOSE_FILE=docker-compose\.yml\(:docker-compose\.camera\.yml\)\?\(:docker-compose\.pan\.yml\)\?$|d' \
  -e '/^CAMERA_DEVICE=/d' -e '/^PAN_PWM_CHANNEL=/d' -e '/^PAN_GID=/d' .env
if [[ -z "$webcam" ]]; then
  ui_note "pas de webcam USB : vision tournera sans caméra. Branche-la sur un port USB du Pi, puis relance avec --no-flash."
else
  compose_files+=:docker-compose.camera.yml
  printf 'CAMERA_DEVICE=%s\n' "$webcam" >>.env
  camera_ok=true
  webcam_name="${webcam#/dev/v4l/by-id/usb-}"
  webcam_name="${webcam_name%-video-index0}"
  ui_detail "${webcam_name//_/ }, donnée à vision"
fi
# The motor that turns it, a 28BYJ-48 on its ULN2003 board wired to GPIO 17, 18, 27 and 22, needs
# nothing installed: the header's GPIO chip goes to vision, with the group that owns its node. A
# camera left fixed says so in .env: PAN_DRIVE=none. So does DETECTOR=motion: a camera that turns
# needs the person detector, and vision would leave it where it is.
if [[ -f "$servo_unit" ]] || grep -qsxF "$servo_overlay" "$boot_config"; then
  ui_run "retrait du PWM de l'ancien servo" retire_servo
  ui_note "le PWM de l'ancien servo occupait GPIO 18, maintenant un fil du moteur : il est retiré, redémarre le Pi (sudo reboot) pour libérer la broche."
fi
motor=absent
gpio_chip="$(sed -n 's/^PAN_GPIO_CHIP=//p' .env | tail -n 1)"
gpio_chip="${gpio_chip:-/dev/gpiochip0}"
if grep -qx 'PAN_DRIVE=none' .env; then
  motor=off
elif grep -qx 'DETECTOR=motion' .env; then
  motor=motion
elif [[ -c "$gpio_chip" ]]; then
  # Never the root group, which a chip no rule gave to `gpio` is left to.
  gpio_gid="$(stat -c %g "$gpio_chip")"
  if ((gpio_gid == 0)); then
    ui_note "$gpio_chip n'est ouvert qu'à root : la caméra restera fixe. Sur Raspberry Pi OS, il est au groupe gpio."
  else
    compose_files+=:docker-compose.pan.yml
    printf 'PAN_GID=%s\n' "$gpio_gid" >>.env
    motor=on
    ui_detail "${UI_DETAIL:+$UI_DETAIL · }moteur de la caméra sur GPIO 17, 18, 27 et 22"
  fi
fi
[[ "$compose_files" == docker-compose.yml ]] || printf 'COMPOSE_FILE=%s\n' "$compose_files" >>.env
ui_done

# --- 5. The stack, on the images of step 2 -------------------------------------------------------
ui_step "Démarrage de la stack"
ui_task "démarrage des conteneurs" with_group docker docker compose up -d
((UI_RC == 0)) || ui_fail "la stack ne démarre pas : la fin du journal dit pourquoi."
if $broker_remade || $screen_account_new; then
  ui_run "redémarrage du broker" with_group docker docker compose restart mosquitto
fi
if $proxy_remade; then
  ui_run "redémarrage du proxy, son certificat porte maintenant sentinel-x.local" with_group docker docker compose restart reverse-proxy
fi
ui_detail "en marche : $(with_group docker docker compose ps --format '{{.Service}}' | tr '\n' ' ')"
ui_done

# --- 6. The Sentinel's firmware, built with the secrets of this Pi -----------------------------
ui_step "Firmware du Sentinel"
escape() { sed 's/\\/\\\\/g; s/"/\\"/g' <<<"$1"; }
(
  umask 077
  cat >firmware/include/secrets.h <<SECRETS
#pragma once
// Made by infra/plug-and-play.sh from infra/secrets on this Pi. Never commit it.
#define WIFI_SSID "$(escape "$ssid")"
#define WIFI_PASSPHRASE "$(escape "$passphrase")"
#define BROKER_HOST "$pi_ip"
#define BROKER_PORT 8883
#define MQTT_USER "sentinel-01"
#define MQTT_PASSWORD "$sentinel_password"
#define NTP_SERVER "$pi_ip"
static const char CA_CERT[] = R"PEM(
$(cat "$secrets/ca.crt")
)PEM";
SECRETS
)
ui_task "compilation" "$pio" run -d firmware -s
((UI_RC == 0)) || ui_fail "le firmware ne compile pas (la première fois, il faut Internet)."
ui_detail "compilé avec les secrets de ce Pi"
ui_done

# --- 7. The table network: from here on, the Pi's Wi-Fi is the access point --------------------
ui_step "Wi-Fi de la table"
systemctl is-active --quiet NetworkManager || ui_fail "NetworkManager ne tourne pas : réinstalle un Raspberry Pi OS (64-bit) récent."
if ip route get 1.1.1.1 2>/dev/null | grep -q "dev wlan0"; then
  ui_note "le Pi passait par son Wi-Fi pour Internet : ce lien tombe maintenant (tout est déjà téléchargé)."
fi
ui_run "point d'accès $ssid" start_access_point
ui_run "DHCP et serveur d'heure" serve_dhcp_and_time
if sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  ui_run "pare-feu : DHCP, heure, HTTPS et MQTTS ouverts sur le Wi-Fi de la table" open_firewall
fi
ui_detail "$ssid sur $pi_ip · 2,4 GHz, WPA2, sans Internet · le Sentinel en $sentinel_ip"
ui_done

# --- 8. The status screen, on the Pi's HDMI ----------------------------------------------------
ui_step "Écran HDMI"
screen_ok=false
ui_task "écran de statut sur la console" install_screen
if ((UI_RC != 0)); then
  ui_note "l'écran de statut ne démarre pas : systemctl status sentinel-x-screen dit pourquoi."
elif grep -qsx connected /sys/class/drm/card*-HDMI-A-*/status; then
  screen_ok=true
  ui_detail "le statut du Poste de commande s'y affiche, en continu"
else
  ui_note "pas d'écran HDMI détecté : branche-le, le statut s'y affiche seul (écran noir : voir le dépannage)."
fi
ui_done

# --- 9. Flash the Sentinel --------------------------------------------------------------------
ui_step "Flash de l'ESP32"
if ! $flash; then
  ui_skip "ignoré (--no-flash)"
else
  port="${ESP32_PORT:-}"
  for candidate in /dev/ttyUSB* /dev/ttyACM*; do
    if [[ -z "$port" && -e "$candidate" ]]; then port="$candidate"; fi
  done
  if [[ -z "$port" ]]; then
    ui_note "pas d'ESP32 en USB : branche-le sur le Pi avec un câble de données, puis relance (ou --no-flash)."
  else
    id -nG | grep -qw dialout || sudo usermod -aG dialout "$USER"
    ui_task "envoi sur $port" with_group dialout "$pio" run -d firmware -s -t upload --upload-port "$port"
    ((UI_RC == 0)) || ui_fail "le flash a échoué : maintiens le bouton BOOT de l'ESP32 au début de l'envoi, puis relance."
    ui_detail "flashé sur $port"
  fi
fi
ui_done

# --- 10. Its first snapshot ---------------------------------------------------------------------
ui_step "Première mesure du Sentinel"
sentinel_ok=false
ui_task "attente du Sentinel sur le Wi-Fi (2 min au plus)" wait_for_lease
if ((UI_RC == 0)); then
  sentinel_ok=true
  snapshot_file=$(mktemp)
  ui_task "attente d'une mesure (1 min au plus)" first_snapshot "$snapshot_file"
  if ((UI_RC == 0)) && [[ -s "$snapshot_file" ]]; then
    ui_detail "$(readable_snapshot "$(head -n 1 "$snapshot_file")")"
  else
    ui_note "pas encore de mesure : « $pio device monitor -d firmware » dit ce qu'il attend."
  fi
  rm -f "$snapshot_file"
else
  ui_note "le Sentinel n'est pas encore sur le Wi-Fi : vérifie qu'il est alimenté ; « $pio device monitor -d firmware » dit ce qu'il attend."
fi
ui_done

# --- The summary -------------------------------------------------------------------------------
motor_summary="$G_FAIL pas de GPIO sur cette machine"
if [[ $motor == on ]]; then motor_summary="$G_OK donné à vision, la caméra suit"; fi
if [[ $motor == off ]]; then motor_summary="caméra fixe (PAN_DRIVE=none dans .env)"; fi
if [[ $motor == motion ]]; then motor_summary="caméra fixe (DETECTOR=motion dans .env)"; fi
summary=(
  "Wi-Fi        $ssid"
  "Passphrase   $passphrase"
  "Dashboard    https://$pi_ip/"
  "Sentinel     $($sentinel_ok && echo "$G_OK $sentinel_ip" || echo "$G_FAIL pas encore sur le Wi-Fi")"
  "Webcam       $($camera_ok && echo "$G_OK donnée à vision" || echo "$G_FAIL absente")"
  "Moteur       $motor_summary"
  "Écran HDMI   $($screen_ok && echo "$G_OK statut affiché" || echo "$G_FAIL non détecté")"
  "Durée        $(_ui_duration "$SECONDS")"
  "Journal      $(_ui_home "$UI_LOG")"
)
printf '\n'
if ((${#UI_ALL_NOTES[@]})); then
  ui_box "$C_YELLOW" "Command Post prêt, avec des remarques" "${summary[@]}"
  printf '\n %sÀ voir :%s\n' "$C_BOLD" "$C_RESET"
  for note in "${UI_ALL_NOTES[@]}"; do
    _ui_wrap $((UI_WIDTH - 5)) "$note"
    printf '   %s%s%s %s\n' "$C_YELLOW" "$G_WARN" "$C_RESET" "${UI_WRAPPED[0]}"
    for line in "${UI_WRAPPED[@]:1}"; do printf '     %s\n' "$line"; done
  done
else
  ui_box "$C_GREEN" "Command Post prêt" "${summary[@]}"
fi

# infra/operator.sh looks for the repo in ~/sentinel-x on the Pi: told where it is when elsewhere.
operator_args="$table $USER"
[[ "$PWD" == "$HOME/sentinel-x" ]] || operator_args+=" $PWD"
# Each thing to do, and the command that does it ("" when there is none): a command on its own line,
# whole, to copy as it is.
next=(
  "Connecte le PC Opérateur au Wi-Fi $ssid. Puis, dans le dépôt cloné sur ce PC, une seule commande installe le certificat et donne son nom au Pi (Mac, Linux) :"
  "infra/operator.sh $operator_args"
  "Sur Windows, la même dans un PowerShell ouvert en administrateur :"
  "powershell -ExecutionPolicy Bypass -File infra\\operator.ps1 $operator_args"
  "Ferme et rouvre le navigateur, puis ouvre https://sentinel-x.local/ (ou https://$pi_ip/)"
  ""
)
if $joined_docker; then
  next+=("Reconnecte-toi en SSH avant de lancer docker toi-même : tu viens d'entrer dans son groupe." "")
fi
next+=("Les journaux des services (vision pour la caméra) :" "docker compose logs -f vision")
# The hand sensor is the Operator's, on their own machine: Ultraleap's software reads no Leap Motion
# Controller on a Pi, so nothing of it is installed here.
next+=("En option, le capteur de main (Leap Motion) sur le PC Opérateur, à préparer avec Internet : installe le logiciel Ultraleap, puis double-clique sur leap/start.bat (Windows) ou leap/start.command (macOS). Dans le dashboard : menu, Commande gestuelle." "")
printf '\n %sEnsuite :%s\n' "$C_BOLD" "$C_RESET"
for ((i = 0; i < ${#next[@]}; i += 2)); do
  _ui_wrap $((UI_WIDTH - 6)) "${next[i]}"
  printf '   %s%d.%s %s\n' "$C_CYAN" $((i / 2 + 1)) "$C_RESET" "${UI_WRAPPED[0]}"
  for line in "${UI_WRAPPED[@]:1}"; do printf '      %s\n' "$line"; done
  if [[ -n "${next[i + 1]}" ]]; then printf '      %s%s%s\n' "$C_CYAN" "${next[i + 1]}" "$C_RESET"; fi
done
printf '\n %sTout revient seul au redémarrage du Pi.%s\n\n' "$C_DIM" "$C_RESET"
printf '\n=== fin : %d remarque(s)\n' "${#UI_ALL_NOTES[@]}" >>"$UI_LOG"
