#!/usr/bin/env bash
# Plug and play: turns a Raspberry Pi 4 into the Command Post, and gives the Sentinel its firmware:
# over USB when it is plugged into the Pi, over the table Wi-Fi otherwise. The only script to run, on
# the Pi, from the repo root, as your usual user, the first time while the Pi has Internet through
# Ethernet:
#   infra/plug-and-play.sh <table number>        e.g. infra/plug-and-play.sh 4 → the Pi is 192.168.4.1
# It then works offline, and remembers the table (infra/secrets/table.env): run it again, without the
# number, after a git pull, for a new firmware, a webcam plugged in: it keeps what exists, and leaves
# alone what has not changed (the access point above all: an SSH session over it holds).
#   --no-flash   leaves the ESP32 alone
# From the environment, all optional: WIFI_PASSPHRASE (else made once, kept in
# infra/secrets/wifi.env), WIFI_SSID (SentinelX-<table>), WIFI_CHANNEL (6), WIFI_COUNTRY (FR),
# OPERATOR_PASSWORD (else asked), ESP32_PORT (else the first /dev/ttyUSB*).
#
# The Sentinel needs no cable to the Pi: on its own supply, it joins the table Wi-Fi, and takes each
# new firmware from the Pi over HTTPS when the Pi asks for it on the broker (firmware/src/ota.h). USB
# only once, for its first firmware, or for one from before the update over the Wi-Fi.
#
# The Pi's Wi-Fi becomes the table's access point, as the brief wants an isolated network: it leaves
# the Wi-Fi it was on, once, at step 8, after everything is downloaded. Said before the steps; and an
# SSH session over that Wi-Fi, which then drops, leaves the script to finish on its own.
#
# Its interface is infra/ui.sh, in French like the step-by-step (docs/INSTALLATION-PI.md): everything
# it needs (sudo, the Operator password) is asked first, then ten steps run on their own, the
# commands' output kept in ~/.local/share/sentinel-x/plug-and-play.log.
# The images are pulled from GHCR when the CI published them for this very code (infra/images.sh,
# .github/workflows/images.yml), and built on the Pi only otherwise: that is most of the time saved.
# The firmware's toolchain downloads meanwhile.
set -euo pipefail

cd "$(dirname "$0")/.."
secrets=infra/secrets

usage() { echo "Usage : infra/plug-and-play.sh [numéro de table] [--no-flash]   (le numéro, la première fois)" >&2; exit 1; }
table="" flash=true
for arg in "$@"; do
  case "$arg" in
    --no-flash) flash=false ;;
    *) [[ -z "$table" ]] || usage; table="$arg" ;;
  esac
done
# The table of the run before, when none is given.
if [[ -z "$table" ]]; then
  table="$(sed -n 's/^TABLE=//p' "$secrets/table.env" 2>/dev/null || true)"
  [[ -n "$table" ]] || usage
fi
if [[ ! "$table" =~ ^[0-9]{1,3}$ ]] || ((10#$table > 254)); then usage; fi
table=$((10#$table))

pi_ip="192.168.${table}.1"
sentinel_ip="192.168.${table}.10"
ssid="${WIFI_SSID:-SentinelX-$table}"
channel="${WIFI_CHANNEL:-6}"
country="${WIFI_COUNTRY:-FR}"
pio_venv="$HOME/.local/share/sentinel-x/platformio"
pio="$pio_venv/bin/pio"

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
# The access point as it should be, and as NetworkManager has it: the same, and up, it is left alone.
ap_wanted() { printf '%s\n' "$ssid" ap "$channel" "$passphrase" "$pi_ip/24"; }
ap_current() {
  local field
  for field in 802-11-wireless.ssid 802-11-wireless.mode 802-11-wireless.channel 802-11-wireless-security.psk ipv4.addresses; do
    sudo nmcli -s -g "$field" connection show sentinel-x-ap 2>/dev/null || true
  done
}
ap_ready() {
  nmcli -t -f NAME connection show --active 2>/dev/null | grep -qx sentinel-x-ap && [[ "$(ap_current)" == "$(ap_wanted)" ]]
}
# Whether this script runs in an SSH session that comes in through wlan0: the access point drops it.
ssh_over_wifi() {
  local server_ip
  [[ -n "${SSH_CONNECTION:-}" ]] || return 1
  server_ip="$(awk '{ print $3 }' <<<"$SSH_CONNECTION")"
  ip -o -4 addr show dev wlan0 2>/dev/null | grep -qF " $server_ip/"
}
# From here on, nothing to the terminal, which the SSH session takes with it when it drops: the steps
# go on, their lines in the log, the HDMI screen showing where the Command Post is.
detach() {
  trap '' HUP
  exec </dev/null >>"$UI_LOG" 2>&1
  UI_TTY=false
  C_RESET="" C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_YELLOW="" C_CYAN=""
}
# Writes the file $1 from stdin, as root, when it differs: true when it did.
write_if_changed() {
  local wanted
  wanted="$(cat)"
  if [[ -f "$1" && "$(cat "$1")" == "$wanted" ]]; then return 1; fi
  printf '%s\n' "$wanted" | sudo tee "$1" >/dev/null
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
# Restarted only when their configuration changed, or they do not run: the leases and the clients'
# time stay as they are otherwise.
serve_dhcp_and_time() {
  # DHCP only: no DNS, no gateway. sentinel-01 always gets .10, by the name it sends.
  if write_if_changed /etc/dnsmasq.d/sentinel-x.conf <<DNSMASQ || ! systemctl is-active --quiet dnsmasq; then
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
  fi
  # The table network has no Internet: the Pi gives the time, which stamps every reading.
  sudo mkdir -p /etc/chrony/conf.d
  if write_if_changed /etc/chrony/conf.d/sentinel-x.conf <<CHRONY || ! systemctl is-active --quiet chrony; then
# Serves the time to the table Wi-Fi. Made by infra/plug-and-play.sh.
allow 192.168.$table.0/24
local stratum 10
CHRONY
    sudo systemctl enable --quiet chrony
    sudo systemctl restart chrony
  fi
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
# The eye draws straight on the HDMI output: the groups that own it, whatever the user's are.
SupplementaryGroups=video render
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
open_firewall() {
  local rule
  for rule in 67/udp 123/udp 443/tcp 8883/tcp; do
    sudo ufw allow in on wlan0 to any port "${rule%/*}" proto "${rule#*/}"
  done
}
# Whether the Pi's TLS port $1 serves the certificate in $2. A container reads its certificate when it
# starts, and Compose sees no change in a mounted file: one made again since is not served until a
# restart. Up to 15 s for a container that just started to answer.
serves() {
  local wanted served="" _
  wanted="$(openssl x509 -in "$2" -noout -fingerprint -sha256)"
  for _ in $(seq 15); do
    served="$(timeout 5 openssl s_client -connect "127.0.0.1:$1" </dev/null 2>/dev/null \
      | openssl x509 -noout -fingerprint -sha256 2>/dev/null || true)"
    [[ -z "$served" ]] || break
    sleep 1
  done
  if [[ "$served" != "$wanted" ]]; then
    echo "port $1 : ${served:-pas de réponse}, attendu $wanted"
    return 1
  fi
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
# The broker, with the api's account, from inside its container: the first message on topic $1
# within $2 s, retained or not, on stdout; nothing when none came.
mqtt_read() {
  with_group docker docker compose exec -T mosquitto mosquitto_sub -h mosquitto -p 8883 \
    --cafile /mosquitto/config/certs/ca.crt -u api -P "$api_password" -t "$1" -C 1 -W "$2" 2>/dev/null || true
}
# Puts up $2 on topic $1, retained: the Sentinel reads it whenever it connects.
mqtt_retain() {
  with_group docker docker compose exec -T mosquitto mosquitto_pub -h mosquitto -p 8883 \
    --cafile /mosquitto/config/certs/ca.crt -u api -P "$api_password" -t "$1" -q 1 -r -m "$2"
}
sentinel_firmware() { mqtt_read sentinel/sentinel-01/firmware 60 >"$1"; }
first_snapshot() { mqtt_read sentinel/sentinel-01/telemetry 60 >"$1"; [[ -s "$1" ]]; }
json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" <<<"$2"; }
# The Sentinel on its new firmware, over the Wi-Fi. Up to 3 min: it may still be joining the access
# point, the download and the restart take some 30 s. Gives up after 1 min without any telemetry: it is
# not on the Wi-Fi, and takes the firmware by itself when it comes. The last state in $1.
wait_for_update() {
  local start=$SECONDS said before
  before="$(mqtt_read sentinel/sentinel-01/firmware 3)"
  while ((SECONDS - start < 180)); do
    said="$(mqtt_read sentinel/sentinel-01/firmware 3)"
    if [[ "$(json_field version "$said")" == "$firmware_version" ]]; then echo updated >"$1"; return 0; fi
    # A new message with an error: the Sentinel tried and failed.
    if [[ "$said" != "$before" && -n "$(json_field error "$said")" ]]; then printf 'failed %s\n' "$(json_field error "$said")" >"$1"; return 1; fi
    if ((SECONDS - start > 60)) && [[ -z "$(mqtt_read sentinel/sentinel-01/telemetry 5)" ]]; then echo offline >"$1"; return 1; fi
    sleep 3
  done
  echo timeout >"$1"
  return 1
}
# The step 6 toolchain, which downloads in the background since step 1.
wait_for_toolchain() {
  while kill -0 "$1" 2>/dev/null; do sleep 1; done
  cat "$2"
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
# The Pi's Wi-Fi becomes the table's: said now, not when it happens.
wifi_client="$(nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null | sed -n 's/:wlan0$//p' | head -n 1 || true)"
if [[ -n "$wifi_client" && "$wifi_client" != sentinel-x-ap ]]; then
  ui_warn "à l'étape 8, le Wi-Fi du Pi quitte « $wifi_client » et devient $ssid, le réseau isolé de la table. Tout ce qui se télécharge l'est avant ; garde l'Ethernet pour Internet."
  if ssh_over_wifi; then
    ui_warn "cette session SSH passe par « $wifi_client » : elle tombera à l'étape 8, le script finira seul (écran HDMI, journal). Par l'Ethernet, elle tiendrait."
  fi
  if [[ -t 0 ]]; then
    read -rp " $C_CYAN$G_ASK$C_RESET On continue ? [O/n] " answer || answer=""
    [[ ! "$answer" =~ ^[nN] ]] || { printf '\n Rien n'"'"'a été changé.\n\n'; exit 0; }
  fi
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
# The eye of the HDMI screen (infra/eye.py): without them the screen keeps its status, as text.
eye_missing=()
for package in python3-pygame fonts-dejavu-core; do
  dpkg -s "$package" >/dev/null 2>&1 || eye_missing+=("$package")
done
if ((${#eye_missing[@]})); then
  if $online; then
    ui_run "installation de ${eye_missing[*]}" install_packages "${eye_missing[@]}"
  else
    ui_note "sans Internet, l'écran HDMI reste en texte : relance avec l'Ethernet pour l'œil (${eye_missing[*]})."
  fi
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
# For the ESP32 on USB, now: no sudo after the access point, which may have taken the terminal.
id -nG | grep -qw dialout || sudo usermod -aG dialout "$USER"
if [[ ! -x "$pio" ]]; then
  $online || ui_fail "PlatformIO manque : branche l'Ethernet, puis relance."
  ui_run "installation de PlatformIO" install_platformio
fi
ui_detail "Docker, PlatformIO, dnsmasq (DHCP), chrony (heure)"
ui_done

# The firmware's toolchain and libraries download while the images do: step 6 only waits for the rest.
toolchain="" toolchain_log="$(mktemp)"
if $online; then
  "$pio" pkg install -d firmware >"$toolchain_log" 2>&1 &
  toolchain=$!
fi

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
# The table, for the next run without its number.
(umask 077 && printf 'TABLE=%s\n' "$table" >"$secrets/table.env")
[[ "$passphrase" =~ ^[[:print:]]{8,63}$ ]] || ui_fail "la phrase de passe Wi-Fi doit faire 8 à 63 caractères imprimables."
(umask 077 && printf 'WIFI_SSID=%s\nWIFI_PASSPHRASE=%s\n' "$ssid" "$passphrase" >"$secrets/wifi.env")

# A broker certificate made before the ESP32 fix, or for another table: made again.
broker_crt="$secrets/mosquitto/broker.crt"
if [[ -f "$broker_crt" ]] && ! openssl x509 -in "$broker_crt" -noout -text 2>/dev/null | grep -q "DNS:$pi_ip"; then
  sudo rm -f "$broker_crt" "$secrets/mosquitto/broker.key"
fi
# A proxy certificate made before the dashboard had a name, or before the Sentinel fetched its firmware
# there (by IP, its TLS stack reads the DNS entries only): made again, by the same CA, so the Operator
# laptop has nothing to import again.
if [[ -f "$secrets/caddy/proxy.crt" ]]; then
  proxy_text="$(openssl x509 -in "$secrets/caddy/proxy.crt" -noout -text 2>/dev/null || true)"
  if ! grep -q "IP Address:$pi_ip" <<<"$proxy_text"; then
    ui_note "le certificat HTTPS est celui d'une autre table : sudo rm infra/secrets/caddy/proxy.*, puis relance."
  elif ! grep -q "DNS:sentinel-x.local" <<<"$proxy_text" || ! grep -q "DNS:$pi_ip," <<<"$proxy_text"; then
    sudo rm -f "$secrets/caddy/proxy.crt" "$secrets/caddy/proxy.key"
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
firmware_token="$(sed -n 's/^FIRMWARE_TOKEN=//p' "$secrets/firmware.env")"
[[ -n "$sentinel_password" && -n "$api_password" && -n "$firmware_token" ]] || ui_fail "pas de mots de passe MQTT dans infra/secrets : sudo rm -rf infra/secrets, puis relance."
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
# The COMPOSE_FILE lines this step writes: with the webcam, with its servo or its stepper, with both.
# And PAN_STEPPER=true, which the stepper once needed to be given.
sed -i -e '\|^COMPOSE_FILE=docker-compose\.yml\(:docker-compose\.camera\.yml\)\?\(:docker-compose\.pan\.yml\)\?\(:docker-compose\.stepper\.yml\)\?$|d' \
  -e '/^CAMERA_DEVICE=/d' -e '/^PAN_PWM_CHANNEL=/d' -e '/^PAN_GID=/d' -e '/^PAN_GPIO_GID=/d' -e '/^PAN_STEPPER=true$/d' .env
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
# The motor that turns it is the stepper, wired to the Pi's header: the GPIO chip is always there and
# does not say whether a board is wired to it, so it goes to vision whenever it is, with the group
# that owns it, like the webcam's node. What .env says comes first: PAN_DRIVE=none, a camera left
# fixed; DETECTOR=motion, which a camera that turns cannot use; PAN_DRIVE=pwm, the servo the stepper
# replaced, once infra/servo.sh gave the Pi its PWM channel.
motor="" fixed="pas de GPIO sur cette machine"
pan_drive="$(sed -n 's/^PAN_DRIVE=//p' .env | tail -n 1)"
pwm_channel=/sys/class/pwm/pwmchip0/pwm0
if [[ "$pan_drive" == none ]]; then
  fixed="PAN_DRIVE=none dans .env"
elif grep -qx 'DETECTOR=motion' .env; then
  fixed="DETECTOR=motion dans .env"
elif [[ "$pan_drive" == pwm ]]; then
  fixed="pas de canal PWM, infra/servo.sh pour l'installer"
  if [[ -e "$pwm_channel/duty_cycle" ]]; then
    compose_files+=:docker-compose.pan.yml
    printf 'PAN_PWM_CHANNEL=%s\nPAN_GID=%s\n' "$(readlink -f "$pwm_channel")" "$(stat -c %g "$pwm_channel/duty_cycle")" >>.env
    motor="servo"
    ui_detail "servo de la caméra sur GPIO 18, donné à vision"
  fi
elif [[ -c /dev/gpiochip0 ]]; then
  # Never the root group, which a chip no rule gave to `gpio` is left to.
  gpio_gid="$(stat -c %g /dev/gpiochip0)"
  if ((gpio_gid == 0)); then
    fixed="/dev/gpiochip0 n'est ouvert qu'à root"
    ui_note "/dev/gpiochip0 n'est ouvert qu'à root : la caméra restera fixe. Sur Raspberry Pi OS, il est au groupe gpio."
  else
    # One motor turns the camera: the servo's PWM channel is no longer exported at boot.
    if systemctl is-enabled --quiet sentinel-x-servo.service 2>/dev/null; then
      ui_run "retrait du servo, son canal PWM n'est plus préparé au démarrage" sudo systemctl disable --quiet sentinel-x-servo.service
    fi
    compose_files+=:docker-compose.stepper.yml
    printf 'PAN_GPIO_GID=%s\n' "$gpio_gid" >>.env
    motor="moteur pas à pas"
    stepper_pins="$(sed -n 's/^PAN_STEPPER_PINS=//p' .env | tail -n 1)"
    ui_detail "moteur pas à pas de la caméra sur GPIO ${stepper_pins:-6,13,19,26}, donné à vision"
  fi
fi
[[ "$compose_files" == docker-compose.yml ]] || printf 'COMPOSE_FILE=%s\n' "$compose_files" >>.env
ui_done

# --- 5. The stack, on the images of step 2 -------------------------------------------------------
ui_step "Démarrage de la stack"
ui_task "démarrage des conteneurs" with_group docker docker compose up -d
((UI_RC == 0)) || ui_fail "la stack ne démarre pas : la fin du journal dit pourquoi."
# A certificate made again is asked of the port itself, not remembered from step 3: a run that stopped
# before this step would have made one that nothing restarted its container for.
ui_task "vérification du certificat que sert le broker" serves 8883 "$secrets/mosquitto/broker.crt"
if ((UI_RC != 0)) || $screen_account_new; then
  ui_run "redémarrage du broker" with_group docker docker compose restart mosquitto
else
  # A broker that was already running reads its ACL again: setup.sh copies it each run.
  ui_task "relecture des droits du broker" with_group docker docker compose kill -s SIGHUP mosquitto
fi
ui_task "vérification du certificat que sert le proxy" serves 443 "$secrets/caddy/proxy.crt"
if ((UI_RC != 0)); then
  ui_run "redémarrage du proxy, qui ne sert pas son certificat" with_group docker docker compose restart reverse-proxy
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
#define FIRMWARE_TOKEN "$firmware_token"
static const char CA_CERT[] = R"PEM(
$(cat "$secrets/ca.crt")
)PEM";
SECRETS
)
if [[ -n "$toolchain" ]]; then
  ui_task "outils du firmware, téléchargés pendant les images" wait_for_toolchain "$toolchain" "$toolchain_log"
  wait "$toolchain" 2>/dev/null || true
fi
rm -f "$toolchain_log"
# Its version: its sources and the secrets it is built with. The same code gives the same version,
# which the Sentinel says it runs: it is sent again only when it changed.
firmware_version="$(find firmware/platformio.ini firmware/include firmware/src -type f -print0 | LC_ALL=C sort -z \
  | xargs -0 sha256sum | sha256sum | cut -c1-12)"
export PLATFORMIO_BUILD_FLAGS="-DFIRMWARE_VERSION=\\\"$firmware_version\\\""
ui_task "compilation" "$pio" run -d firmware -s
((UI_RC == 0)) || ui_fail "le firmware ne compile pas (la première fois, il faut Internet)."
# Where the reverse proxy serves it to the Sentinel, behind its token (infra/caddy/Caddyfile).
firmware_bin="$secrets/firmware/sentinel-01.bin"
install -m 644 firmware/.pio/build/sentinel/firmware.bin "$firmware_bin"
firmware_md5="$(md5sum "$firmware_bin" | cut -d' ' -f1)"
ui_detail "version $firmware_version, compilée avec les secrets de ce Pi"
ui_done

# --- 7. The status screen, on the Pi's HDMI ----------------------------------------------------
# Before the Wi-Fi: it shows how the rest goes, should the terminal be gone with it.
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

# --- 8. The table network: from here on, the Pi's Wi-Fi is the access point --------------------
ui_step "Wi-Fi de la table"
systemctl is-active --quiet NetworkManager || ui_fail "NetworkManager ne tourne pas : réinstalle un Raspberry Pi OS (64-bit) récent."
# DHCP, time and firewall first: the access point is what may take the terminal away.
ui_run "DHCP et serveur d'heure" serve_dhcp_and_time
if sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  ui_run "pare-feu : DHCP, heure, HTTPS et MQTTS ouverts sur le Wi-Fi de la table" open_firewall
fi
if ap_ready; then
  ui_detail "$ssid déjà en place sur $pi_ip, inchangé · le Sentinel en $sentinel_ip"
else
  if ip route get 1.1.1.1 2>/dev/null | grep -q "dev wlan0"; then
    ui_note "le Pi passait par son Wi-Fi pour Internet : ce lien tombe maintenant (tout est déjà téléchargé)."
  fi
  if ssh_over_wifi; then
    printf '\n'
    ui_box "$C_YELLOW" "Le Pi passe sur le Wi-Fi de la table : cette session va tomber" \
      "La suite continue seule : l'écran HDMI montre où elle en est." \
      "Pour revenir : connecte ce PC au Wi-Fi $ssid" \
      "  (phrase de passe : $passphrase)," \
      "puis ssh $USER@$pi_ip et : tail -f $(_ui_home "$UI_LOG")"
    printf '\n'
    detach
  fi
  ui_run "point d'accès $ssid" start_access_point
  ui_detail "$ssid sur $pi_ip · 2,4 GHz, WPA2, sans Internet · le Sentinel en $sentinel_ip"
fi
ui_done

# --- 9. The Sentinel's firmware: over USB when it is plugged in, over the Wi-Fi otherwise --------
ui_step "Firmware sur le Sentinel"
if ! $flash; then
  ui_skip "ignoré (--no-flash)"
else
  port="${ESP32_PORT:-}"
  for candidate in /dev/ttyUSB* /dev/ttyACM*; do
    if [[ -z "$port" && -e "$candidate" ]]; then port="$candidate"; fi
  done
  # The firmware the Sentinel should run, retained on the broker: it takes it whenever it connects,
  # now or later, and leaves it when it already runs it. Put up after a USB flash too, which then
  # leaves it nothing to do.
  ui_task "nouveau firmware annoncé au Sentinel" mqtt_retain command/sentinel-01/firmware \
    "{\"version\":\"$firmware_version\",\"md5\":\"$firmware_md5\"}"
  ((UI_RC == 0)) || ui_note "le broker n'a pas pris l'annonce du firmware : la mise à jour par le Wi-Fi attendra la prochaine fois."
  if [[ -n "$port" ]]; then
    ui_task "envoi par USB sur $port" with_group dialout "$pio" run -d firmware -s -t upload --upload-port "$port"
    ((UI_RC == 0)) || ui_fail "le flash a échoué : maintiens le bouton BOOT de l'ESP32 au début de l'envoi, puis relance."
    ui_detail "flashé par USB sur $port : il peut maintenant vivre sur sa propre alimentation, les mises à jour passeront par le Wi-Fi"
  else
    # The firmware it runs: retained, or said as soon as it connects, which it may still be doing
    # on an access point that just came up.
    said_file="$(mktemp)"
    ui_task "attente du Sentinel sur le Wi-Fi (1 min au plus)" sentinel_firmware "$said_file"
    running="$(json_field version "$(cat "$said_file")")"
    rm -f "$said_file"
  fi
fi
if $flash && [[ -z "$port" ]]; then
  if [[ "$running" == "$firmware_version" ]]; then
    ui_skip "déjà à jour (version $firmware_version), rien à envoyer"
  elif [[ -z "$running" ]]; then
    # No Sentinel has said which firmware it runs: none is connected, or its firmware is from before
    # the update over the Wi-Fi. Either way, nothing to wait for.
    if [[ -n "$(mqtt_read sentinel/sentinel-01/telemetry 5)" ]]; then
      ui_note "le Sentinel répond, mais son firmware date d'avant la mise à jour par le Wi-Fi : une dernière fois par USB (branche-le sur le Pi, puis relance). Ensuite, plus besoin de câble."
    else
      ui_note "pas de Sentinel, ni en USB ni sur le Wi-Fi. La première fois, branche l'ESP32 sur le Pi avec un câble de données, puis relance : ensuite, plus besoin de câble."
    fi
  else
    update_state="$(mktemp)"
    ui_task "envoi par le Wi-Fi : le Sentinel le télécharge sur le Pi (3 min au plus)" wait_for_update "$update_state"
    state="$(cat "$update_state")"
    rm -f "$update_state"
    case "$state" in
      updated) ui_detail "mis à jour par le Wi-Fi : version $firmware_version" ;;
      failed*) ui_note "le Sentinel n'a pas pu prendre le nouveau firmware (${state#failed }) : il garde l'ancien. Relance ; sinon, une fois par USB." ;;
      offline) ui_note "le Sentinel n'est pas sur le Wi-Fi : s'il s'y connecte avant que le Pi redémarre, il prend le nouveau firmware tout seul ; sinon, relance." ;;
      *) ui_note "le Sentinel n'a pas encore pris le nouveau firmware : « $pio device monitor -d firmware », en USB, dit pourquoi." ;;
    esac
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
    ui_note "pas encore de mesure : « $pio device monitor -d firmware », en USB, dit ce qu'il attend."
  fi
  rm -f "$snapshot_file"
else
  ui_note "le Sentinel n'est pas encore sur le Wi-Fi : vérifie qu'il est alimenté (un chargeur USB suffit) ; « $pio device monitor -d firmware », en USB, dit ce qu'il attend."
fi
ui_done

# --- The summary -------------------------------------------------------------------------------
summary=(
  "Wi-Fi        $ssid"
  "Passphrase   $passphrase"
  "Dashboard    https://$pi_ip/"
  "Sentinel     $($sentinel_ok && echo "$G_OK $sentinel_ip" || echo "$G_FAIL pas encore sur le Wi-Fi")"
  "Firmware     $firmware_version"
  "Webcam       $($camera_ok && echo "$G_OK donnée à vision" || echo "$G_FAIL absente")"
  "Moteur       $([[ -n "$motor" ]] && echo "$G_OK $motor, donné à vision" || echo "sans : caméra fixe ($fixed)")"
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
next+=("Le Sentinel n'a pas besoin du Pi pour son courant : un chargeur USB ou une batterie suffit. Chaque nouveau firmware lui arrive par le Wi-Fi, en relançant simplement :" "infra/plug-and-play.sh")
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
