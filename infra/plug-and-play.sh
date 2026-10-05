#!/usr/bin/env bash
# Plug and play: turns a Raspberry Pi 4 into the Command Post and flashes the Sentinel plugged
# into one of its USB ports. Run it on the Pi, from the repo root, as your usual user (it asks
# for sudo), the first time while the Pi has Internet through Ethernet:
#   infra/plug-and-play.sh <table number>        e.g. infra/plug-and-play.sh 4 → the Pi is 192.168.4.1
# It then works offline: run it again after a git pull, or to reflash, it keeps what exists.
#   --no-flash   leaves the ESP32 alone
# From the environment, all optional: WIFI_PASSPHRASE (else made once, kept in
# infra/secrets/wifi.env), WIFI_SSID (SentinelX-<table>), WIFI_CHANNEL (6), WIFI_COUNTRY (FR),
# OPERATOR_PASSWORD (else infra/setup.sh asks), ESP32_PORT (else the first /dev/ttyUSB*).
set -euo pipefail

usage() { echo "Usage: infra/plug-and-play.sh <table number> [--no-flash]" >&2; exit 1; }
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

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

# Runs a command with a group the user just joined, without logging out and in again.
with_group() {
  local group="$1"; shift
  if id -nG | grep -qw "$group"; then "$@"; else sg "$group" -c "$(printf '%q ' "$@")"; fi
}

[[ "$(uname -s)" == Linux ]] || die "run this on the Raspberry Pi, not on a laptop."
grep -qs "Raspberry Pi" /proc/device-tree/model || warn "this does not look like a Raspberry Pi: going on anyway."
online=false
curl -fsS --max-time 5 -o /dev/null https://download.docker.com && online=true
if $online; then ok "Internet reachable: missing pieces get downloaded"; else warn "no Internet: only what is already installed will be used"; fi

# --- 1. Software, while there is Internet ---------------------------------------------------
step "Software: Docker, dnsmasq (DHCP), chrony (time), PlatformIO"
missing=()
for package in dnsmasq chrony python3-venv openssl curl; do
  dpkg -s "$package" >/dev/null 2>&1 || missing+=("$package")
done
if ((${#missing[@]})); then
  $online || die "missing packages (${missing[*]}): plug the Pi into Ethernet and run it again."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}" >/dev/null
fi
ok "packages"

if ! command -v docker >/dev/null; then
  $online || die "Docker is missing: plug the Pi into Ethernet and run it again."
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi
id -nG | grep -qw docker || sudo usermod -aG docker "$USER"
ok "Docker"

if [[ ! -x "$pio" ]]; then
  $online || die "PlatformIO is missing: plug the Pi into Ethernet and run it again."
  python3 -m venv "$pio_venv"
  "$pio_venv/bin/pip" install -q platformio
fi
ok "PlatformIO"

# --- 2. Secrets ------------------------------------------------------------------------------
step "Secrets: table Wi-Fi, certificates, MQTT accounts (infra/secrets, never committed)"
mkdir -p "$secrets" && chmod 700 "$secrets"
if [[ -n "${WIFI_PASSPHRASE:-}" ]]; then
  passphrase="$WIFI_PASSPHRASE"
elif [[ -f "$secrets/wifi.env" ]]; then
  passphrase="$(sed -n 's/^WIFI_PASSPHRASE=//p' "$secrets/wifi.env")"
else
  passphrase="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)"
fi
[[ "$passphrase" =~ ^[[:print:]]{8,63}$ ]] || die "the Wi-Fi passphrase needs 8 to 63 printable characters."
(umask 077 && printf 'WIFI_SSID=%s\nWIFI_PASSPHRASE=%s\n' "$ssid" "$passphrase" >"$secrets/wifi.env")

# A broker certificate made before the ESP32 fix, or for another table: made again.
broker_crt="$secrets/mosquitto/broker.crt"
broker_remade=false
if [[ -f "$broker_crt" ]] && ! openssl x509 -in "$broker_crt" -noout -text 2>/dev/null | grep -q "DNS:$pi_ip"; then
  sudo rm -f "$broker_crt" "$secrets/mosquitto/broker.key"
  broker_remade=true
fi
if [[ -f "$secrets/caddy/proxy.crt" ]] && ! openssl x509 -in "$secrets/caddy/proxy.crt" -noout -text 2>/dev/null | grep -q "IP Address:$pi_ip"; then
  warn "the HTTPS certificate is for another table: sudo rm infra/secrets/caddy/proxy.* and run it again."
fi
with_group docker infra/setup.sh "$table"

sentinel_password="$(sed -n 's/.*user sentinel-01, password \([0-9a-f]*\).*/\1/p' "$secrets/handover.txt")"
api_password="$(sed -n 's/^MQTT_PASSWORD=//p' "$secrets/api.env")"
[[ -n "$sentinel_password" && -n "$api_password" ]] || die "no MQTT passwords in infra/secrets: sudo rm -rf infra/secrets and run it again."

# --- 3. The stack ----------------------------------------------------------------------------
step "Command Post stack (docker compose)"
if $online; then with_group docker docker compose up -d --build; else with_group docker docker compose up -d; fi
$broker_remade && with_group docker docker compose restart mosquitto >/dev/null
ok "stack up: $(with_group docker docker compose ps --format '{{.Service}}' | tr '\n' ' ')"

# --- 4. The Sentinel's firmware, built with the secrets of this Pi -----------------------------
step "Sentinel firmware"
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
"$pio" run -d firmware -s || die "the firmware does not build (first time: it needs Internet)."
ok "firmware built"

# --- 5. The table network: from here on, the Pi's Wi-Fi is the access point --------------------
step "Table Wi-Fi $ssid on $pi_ip (2.4 GHz, WPA2, no route out)"
systemctl is-active --quiet NetworkManager || die "NetworkManager is not running: use Raspberry Pi OS Bookworm."
if ip route get 1.1.1.1 2>/dev/null | grep -q "dev wlan0"; then
  warn "the Pi reached the Internet through its Wi-Fi: that link drops now (everything is downloaded)."
fi
command -v raspi-config >/dev/null && sudo raspi-config nonint do_wifi_country "$country"
sudo rfkill unblock wifi || true

ap_settings=(
  802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel "$channel"
  wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.psk "$passphrase"
  ipv4.method manual ipv4.addresses "$pi_ip/24" ipv6.method disabled
  connection.autoconnect yes connection.autoconnect-priority 100
)
if nmcli -t -f NAME connection show | grep -qx sentinel-x-ap; then
  sudo nmcli connection modify sentinel-x-ap 802-11-wireless.ssid "$ssid" "${ap_settings[@]}"
else
  sudo nmcli connection add type wifi ifname wlan0 con-name sentinel-x-ap ssid "$ssid" "${ap_settings[@]}" >/dev/null
fi
sudo nmcli connection up sentinel-x-ap >/dev/null
ok "access point up"

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
sudo systemctl enable --quiet dnsmasq && sudo systemctl restart dnsmasq
ok "DHCP: Sentinel on $sentinel_ip, laptops from .100"

# The table network has no Internet: the Pi gives the time, which stamps every reading.
sudo mkdir -p /etc/chrony/conf.d
sudo tee /etc/chrony/conf.d/sentinel-x.conf >/dev/null <<CHRONY
# Serves the time to the table Wi-Fi. Made by infra/plug-and-play.sh.
allow 192.168.$table.0/24
local stratum 10
CHRONY
sudo systemctl enable --quiet chrony && sudo systemctl restart chrony
ok "time server for the table"

if sudo ufw status 2>/dev/null | grep -q "Status: active"; then
  for rule in 67/udp 123/udp 443/tcp 8883/tcp; do sudo ufw allow in on wlan0 to any port "${rule%/*}" proto "${rule#*/}" >/dev/null; done
  ok "firewall: DHCP, NTP, HTTPS and MQTTS open on the table Wi-Fi"
fi

# --- 6. Flash the Sentinel and wait for its first snapshot ------------------------------------
if $flash; then
  step "Flashing the Sentinel over USB"
  port="${ESP32_PORT:-}"
  for candidate in /dev/ttyUSB* /dev/ttyACM*; do
    if [[ -z "$port" && -e "$candidate" ]]; then port="$candidate"; fi
  done
  if [[ -z "$port" ]]; then
    warn "no ESP32 on USB: plug it into the Pi and run it again (or --no-flash)."
  else
    id -nG | grep -qw dialout || sudo usermod -aG dialout "$USER"
    with_group dialout "$pio" run -d firmware -s -t upload --upload-port "$port" \
      || die "flashing failed: hold the ESP32's BOOT button while it starts uploading, and run it again."
    ok "flashed on $port"
  fi
fi

step "Waiting for the Sentinel (up to 2 minutes)"
for _ in $(seq 60); do
  grep -qs " $sentinel_ip " /var/lib/misc/dnsmasq.leases && break
  sleep 2
done
if grep -qs " $sentinel_ip " /var/lib/misc/dnsmasq.leases; then
  ok "on the table Wi-Fi as $sentinel_ip"
  if snapshot="$(with_group docker docker compose exec -T mosquitto mosquitto_sub -h mosquitto -p 8883 \
      --cafile /mosquitto/config/certs/ca.crt -u api -P "$api_password" \
      -t sentinel/sentinel-01/telemetry -C 1 -W 60 2>/dev/null)"; then
    ok "first snapshot: $snapshot"
  else
    warn "no snapshot yet: its LCD and \`$pio device monitor -d firmware\` tell what it waits for."
  fi
else
  warn "not on the Wi-Fi yet: check it is powered, and its LCD."
fi

cat <<DONE

Command Post ready.
  Table Wi-Fi   $ssid   passphrase: $passphrase
  Dashboard     https://$pi_ip/   (import infra/secrets/ca.crt as a trusted CA on the laptop first)
  Logs          docker compose logs -f api mosquitto
Everything comes back on its own after a reboot of the Pi.
DONE
