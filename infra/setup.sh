#!/usr/bin/env bash
# Makes the Command Post's secrets in infra/secrets/ (never committed), once:
#   - the team CA, and the certificates it signs for the broker and the reverse proxy;
#   - one MQTT account per client (sentinel-01, api, predictive, screen) and the broker's ACL;
#   - one bearer token per AI service (vision, predictive);
#   - the Operator's password hash;
#   - the AI services' own files, vision.env and predictive.env: the same tokens and MQTT password;
#   - screen.env, the MQTT password of the status screen on the Pi's HDMI (infra/screen.py).
# Run it on the Pi, from the repo root, before the first `docker compose up`:
#   infra/setup.sh <table number>          e.g. infra/setup.sh 4  → the Pi is 192.168.4.1
# What exists already is kept: delete a file (sudo: some belong to the containers) to make it again.
# OPERATOR_PASSWORD in the environment skips the prompt. EXTRA_SAN adds names to the proxy
# certificate, e.g. EXTRA_SAN=IP:10.0.0.12 to reach the Pi on its Ethernet address too. API_IMAGE
# names an api image already there for this checkout, which hashes the password instead of a new build.
set -euo pipefail

table="${1:-}"
if [[ ! "$table" =~ ^[0-9]{1,3}$ ]] || ((table > 254)); then
  echo "Usage: infra/setup.sh <table number>   (the Pi is then 192.168.<table>.1)" >&2
  exit 1
fi
pi_ip="192.168.${table}.1"

cd "$(dirname "$0")"
secrets="$PWD/secrets"
mkdir -p "$secrets/mosquitto" "$secrets/caddy"
chmod 700 "$secrets"

MOSQUITTO_IMAGE=eclipse-mosquitto:2.0
# Runs a command as root in a throwaway container, with the secrets mounted: to hash the MQTT
# passwords and hand files over to the users the containers run as.
in_container() {
  docker run --rm -v "$secrets:/secrets" -v "$PWD/mosquitto/acl:/acl:ro" "$MOSQUITTO_IMAGE" sh -c "$1"
}
# The end of this script hands mosquitto/ and caddy/ to the users the containers run as: a later run
# that makes a certificate again (infra/plug-and-play.sh deletes one that is outdated) could no
# longer write there. Back to us while this runs, handed over again at the end.
in_container "chown $(id -u):$(id -g) /secrets/mosquitto /secrets/caddy"
# A certificate that was missing when its container started is an empty directory since: Docker makes
# one in place of a file it mounts and does not find (a run that stopped after deleting it, then a
# reboot). Removed, for the file to be made below; one that is not empty is not ours to remove.
in_container 'set -e; for path in /secrets/ca.crt /secrets/caddy/proxy.crt /secrets/caddy/proxy.key; do
  if [ -d "$path" ]; then rmdir "$path"; fi; done'
made() { echo "  made $1"; }
kept() { echo "  kept $1 (already there)"; }
# openssl's chatter is left out, not what it says when it fails.
quietly() {
  local said
  said="$("$@" 2>&1)" || { printf '%s\n' "$said" >&2; return 1; }
}

echo "Team CA and certificates (Pi: $pi_ip)"
if [[ ! -f "$secrets/ca.crt" ]]; then
  quietly openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 \
    -subj "/CN=Sentinel-X Team CA" \
    -addext "basicConstraints=critical,CA:true" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout "$secrets/ca.key" -out "$secrets/ca.crt"
  chmod 600 "$secrets/ca.key"
  made ca.crt
else
  kept ca.crt
fi

# certificate <dir> <common name> <subjectAltName>
certificate() {
  local dir="$1" name="$2" san="$3"
  if [[ -f "$dir/$name.crt" ]]; then kept "$name.crt"; return; fi
  # The key of a certificate deleted alone is its container's, not ours to write over: out of the way.
  rm -f "$dir/$name.key"
  quietly openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=$name" \
    -keyout "$dir/$name.key" -out "$dir/$name.csr"
  quietly openssl x509 -req -in "$dir/$name.csr" -CA "$secrets/ca.crt" -CAkey "$secrets/ca.key" -CAcreateserial \
    -days 365 -out "$dir/$name.crt" \
    -extfile <(printf 'basicConstraints=CA:false\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=%s\n' "$san")
  rm "$dir/$name.csr"
  made "$name.crt ($san)"
}
# The ESP32 reaches the broker by IP, the api and predictive by its Compose name. The IP is also
# a DNS entry: the ESP32's TLS stack (mbedTLS 2.x) only matches the name against DNS entries.
certificate "$secrets/mosquitto" broker "IP:$pi_ip,DNS:$pi_ip,DNS:mosquitto"
# 127.0.0.1 and localhost: to check the stack from the Pi itself. sentinel-x.local: the dashboard
# by its name, which the Operator laptop resolves from its hosts file (the table Wi-Fi has no DNS).
certificate "$secrets/caddy" proxy "IP:$pi_ip,IP:127.0.0.1,DNS:localhost,DNS:sentinel-x.local${EXTRA_SAN:+,$EXTRA_SAN}"

echo "Credentials: MQTT accounts, service tokens, Operator password"
# The api's MQTT password goes in both files: they are made together or not at all.
passwd_made=false
if [[ -f "$secrets/mosquitto/passwd" && -f "$secrets/api.env" ]]; then
  kept "passwd and api.env"
elif [[ -f "$secrets/mosquitto/passwd" || -f "$secrets/api.env" ]]; then
  echo "  Only one of secrets/mosquitto/passwd and secrets/api.env exists: delete it (sudo) and run again." >&2
  exit 1
else
  if [[ -z "${OPERATOR_PASSWORD:-}" ]]; then
    read -rsp "  Operator password (12 characters or more): " OPERATOR_PASSWORD; echo
    read -rsp "  Again: " again; echo
    [[ "$OPERATOR_PASSWORD" == "$again" ]] || { echo "  The two do not match." >&2; exit 1; }
  fi
  # The API's own code hashes it: the api image infra/plug-and-play.sh made ready for this checkout
  # (API_IMAGE), or else one built here.
  api_image="${API_IMAGE:-}"
  if [[ -z "$api_image" ]] || ! docker image inspect "$api_image" >/dev/null 2>&1; then
    echo "  building the api image, to hash the password with the API's own code…"
    docker build -q -t sentinel-x/api ../backend >/dev/null
    api_image=sentinel-x/api
  fi
  hash="$(printf %s "$OPERATOR_PASSWORD" | docker run --rm -i "$api_image" node dist/hash-password.js)"

  password() { openssl rand -hex 24; }
  sentinel_password="$(password)"; api_password="$(password)"; predictive_password="$(password)"
  vision_token="$(openssl rand -hex 32)"; predictive_token="$(openssl rand -hex 32)"

  in_container "touch /secrets/mosquitto/passwd && chmod 600 /secrets/mosquitto/passwd \
    && mosquitto_passwd -b /secrets/mosquitto/passwd sentinel-01 '$sentinel_password' \
    && mosquitto_passwd -b /secrets/mosquitto/passwd api '$api_password' \
    && mosquitto_passwd -b /secrets/mosquitto/passwd predictive '$predictive_password'" 2>/dev/null
  passwd_made=true

  cat > "$secrets/api.env" <<API
# Read by the api service (docker-compose.yml). Made by infra/setup.sh.
MQTT_PASSWORD=$api_password
OPERATOR_PASSWORD_HASH=$hash
VISION_TOKEN=$vision_token
PREDICTIVE_TOKEN=$predictive_token
API
  chmod 600 "$secrets/api.env"

  cat > "$secrets/handover.txt" <<HANDOVER
# Sentinel-X — credentials to hand over, out of band. Never commit, never paste in a chat.

Firmware (ESP32):  broker mqtts://$pi_ip:8883, user sentinel-01, password $sentinel_password
                   verify the broker with the CA certificate infra/secrets/ca.crt
Vision (AI):       POST http://api:8080/api/v1/alerts, from the Compose network
                   Authorization: Bearer $vision_token
Predictive (AI):   broker mqtts://mosquitto:8883, user predictive, password $predictive_password
                   POST http://api:8080/api/v1/alerts with Authorization: Bearer $predictive_token
HANDOVER
  made "passwd (sentinel-01, api, predictive), api.env, handover.txt"
fi

[[ -f "$secrets/handover.txt" ]] && chmod 600 "$secrets/handover.txt"

echo "AI services: vision.env, predictive.env"
# The same values as api.env and the broker's passwd, or the api refuses their Alerts and the broker
# their login. An install made before them gets them from what it has, nothing else is made again.
from_api_env() {
  local value
  value="$(sed -n "s/^$1=//p" "$secrets/api.env")"
  [[ -n "$value" ]] || { echo "  No $1 in secrets/api.env: delete it and secrets/mosquitto/passwd (sudo) and run again." >&2; exit 1; }
  printf %s "$value"
}
broker_reload=false
if [[ -f "$secrets/vision.env" ]]; then
  kept vision.env
else
  vision_token="$(from_api_env VISION_TOKEN)"
  (umask 077 && cat > "$secrets/vision.env" <<VISION
# Read by the vision service (docker-compose.yml). Made by infra/setup.sh: VISION_TOKEN as in api.env.
VISION_TOKEN=$vision_token
VISION
  )
  made vision.env
fi
if [[ -f "$secrets/predictive.env" ]]; then
  kept predictive.env
else
  predictive_token="$(from_api_env PREDICTIVE_TOKEN)"
  # Made just above, or else handed over at the time: passwd only keeps its hash.
  if [[ -z "${predictive_password:-}" && -f "$secrets/handover.txt" ]]; then
    predictive_password="$(sed -n 's/.*user predictive, password \([0-9a-f]*\).*/\1/p' "$secrets/handover.txt")"
  fi
  if [[ -z "${predictive_password:-}" ]]; then
    # Lost: a new one, in place of the old one in passwd. The other accounts are left as they are.
    predictive_password="$(openssl rand -hex 24)"
    in_container "mosquitto_passwd -b /secrets/mosquitto/passwd predictive '$predictive_password'" 2>/dev/null
    broker_reload=true
    echo "  new MQTT password for predictive (none in handover.txt), in passwd"
  fi
  (umask 077 && cat > "$secrets/predictive.env" <<PREDICTIVE
# Read by the predictive service (docker-compose.yml). Made by infra/setup.sh: its MQTT password as
# in the broker's passwd, PREDICTIVE_TOKEN as in api.env.
MQTT_PASSWORD=$predictive_password
PREDICTIVE_TOKEN=$predictive_token
PREDICTIVE
  )
  made predictive.env
fi

echo "Status screen: screen.env"
# Its own account, added to passwd when it is not there yet: an install made before it gets it too.
if [[ -f "$secrets/screen.env" ]]; then
  kept screen.env
else
  screen_password="$(openssl rand -hex 24)"
  in_container "mosquitto_passwd -b /secrets/mosquitto/passwd screen '$screen_password'" 2>/dev/null
  # Made in this very run, passwd is not in the broker's hands yet.
  $passwd_made || broker_reload=true
  (umask 077 && cat > "$secrets/screen.env" <<SCREEN
# Read by infra/screen.py, the status screen on the Pi's HDMI. Made by infra/setup.sh: its MQTT
# password, as in the broker's passwd. The account may only read the Sentinels' topics.
MQTT_PASSWORD=$screen_password
SCREEN
  )
  made "screen.env, and the screen account in passwd"
fi

# The ACL, from infra/mosquitto/acl, each run. The broker runs as 1883 and the reverse proxy as
# 65534: each reads its own files, nobody else.
in_container "cp /acl /secrets/mosquitto/acl && chown -R 1883:1883 /secrets/mosquitto && chmod 600 /secrets/mosquitto/* \
  && chown -R 65534:65534 /secrets/caddy && chmod 600 /secrets/caddy/proxy.key && chmod 644 /secrets/caddy/proxy.crt \
  && chmod 644 /secrets/mosquitto/broker.crt"

echo
if $broker_reload; then
  echo "The broker's passwd changed: docker compose restart mosquitto first, if it runs already."
fi
echo "Done. Next: docker compose up -d --build   (from the repo root)"
echo "Then, on the Operator laptop: infra/operator.sh $table $USER (infra/operator.ps1 on Windows) trusts"
echo "infra/secrets/ca.crt and names the Pi. After it, open https://sentinel-x.local/ (or https://$pi_ip/)."
echo "Hand over infra/secrets/handover.txt to the firmware and AI teams, out of band."
