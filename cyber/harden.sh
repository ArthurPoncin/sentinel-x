#!/usr/bin/env bash
# Hardens the Command Post for the cross-team pentest: SSH by key only, a firewall that lets in what
# the table needs and nothing else, Docker's published ports kept to the table Wi-Fi, unused
# services off — the checklist of cyber/README.md. Run it on the Pi, from the repo root, as your
# usual user (it asks for sudo), once infra/plug-and-play.sh is done, from the Operator laptop over
# SSH on the table Wi-Fi:
#   cyber/harden.sh <table number>               e.g. cyber/harden.sh 4 → the Pi is 192.168.4.1
# Run it again as often as needed: it ends in the same state. Step by step: docs/DURCISSEMENT-PI.md.
#   --operator <ip>   the Operator laptop on the table Wi-Fi, the only address SSH answers to
#                     (default: where this SSH session comes from)
#   --admin <user>    the only account SSH lets in (default: you)
#   --dry-run         says what it would do, and changes nothing
#   --check           changes nothing: lists what is hardened and what is not (exit 1 if something is not)
set -euo pipefail

usage() {
  echo "Usage: cyber/harden.sh <table number> [--operator <ip>] [--admin <user>] [--dry-run | --check]" >&2
  exit 1
}
table="" operator_ip="" admin="" mode=apply
while (($#)); do
  case "$1" in
    --operator) (($# > 1)) || usage; operator_ip="$2"; shift ;;
    --admin) (($# > 1)) || usage; admin="$2"; shift ;;
    --dry-run) mode=dry-run ;;
    --check) mode=check ;;
    -*) usage ;;
    *) [[ -z "$table" ]] || usage; table="$1" ;;
  esac
  shift
done
if [[ ! "$table" =~ ^[0-9]{1,3}$ ]] || ((10#$table > 254)); then usage; fi
table=$((10#$table))

pi_ip="192.168.${table}.1"
sentinel_ip="192.168.${table}.10"
subnet="192.168.${table}.0/24"
wifi=wlan0
# What docker-compose.yml publishes: the reverse proxy and the broker.
published_ports=(443 8883)
# Nothing on the Command Post uses them. Without avahi, sentinel-x.local no longer answers: the Pi
# is reached at its address.
unused_units=(
  bluetooth.service hciuart.service avahi-daemon.socket avahi-daemon.service
  triggerhappy.socket triggerhappy.service ModemManager.service
)
sshd_dropin=/etc/ssh/sshd_config.d/00-sentinel-x.conf
filter=/usr/local/sbin/sentinel-x-docker-filter
filter_unit=sentinel-x-docker-filter.service
reservation=/etc/dnsmasq.d/sentinel-x-operator.conf
# What the last run applied, for --check to compare with. No secret in it.
state=/etc/sentinel-x-hardening.conf

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }
# A line of the checklist that does not hold.
problems=0
bad() { printf '    \033[31m✗\033[0m %s\n' "$*"; problems=$((problems + 1)); }

as_root() { if ((EUID == 0)); then "$@"; else sudo "$@"; fi; }
# Runs what changes the system, its chatter dropped and its errors shown; on a dry run, only says it.
change() {
  if [[ "$mode" == dry-run ]]; then printf '    would run: %s\n' "$*"; else as_root "$@" >/dev/null </dev/null; fi
}
# Writes its stdin to a file of root's, with this mode; on a dry run, shows it.
write() {
  local path="$1" file_mode="$2" content
  content="$(cat)"
  if [[ "$mode" == dry-run ]]; then
    printf '    would write %s (mode %s):\n' "$path" "$file_mode"
    printf '      | %s\n' "${content//$'\n'/$'\n'      | }"
  else
    printf '%s\n' "$content" | as_root install -m "$file_mode" /dev/stdin "$path"
  fi
}
installed() { systemctl list-unit-files "$1" --no-legend 2>/dev/null | grep -q .; }

# --- What "hardened" is, written once: applied below, and compared with by --check ------------

sshd_config() {
  cat <<SSHD
# Sentinel-X hardening: keys only (ed25519), no root, one account. Made by cyber/harden.sh.
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PubkeyAcceptedAlgorithms ssh-ed25519
AuthenticationMethods publickey
PermitRootLogin no
AllowUsers $admin
X11Forwarding no
SSHD
}

# What UFW lets in, as `ufw show added` lists it. Everything else that comes in is denied.
firewall_rules() {
  cat <<RULES
allow in on $wifi from $operator_ip to any port 22 proto tcp
allow in on $wifi to any port 67 proto udp
allow in on $wifi to any port 123 proto udp
RULES
}

# Docker publishes its ports with rules of its own, which UFW never sees: this chain, called from
# DOCKER-USER, is where they are filtered. A packet for a container is let through when it answers
# something already let in, when it comes from the table Wi-Fi for a port the Pi publishes, or when
# it comes from a container; whatever else enters the Pi for a container is dropped, on any interface.
filter_rules() {
  echo "-m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
  local port
  for port in "${published_ports[@]}"; do
    echo "-i $wifi -s $subnet -p tcp -m conntrack --ctstate NEW --ctorigdst $pi_ip --ctorigdstport $port -j RETURN"
  done
  echo "-i docker0 -j RETURN"
  echo "-i br-+ -j RETURN"
  echo "-j DROP"
}

filter_script() {
  cat <<FILTER
#!/bin/sh
# Keeps the ports Docker publishes to the table Wi-Fi ($subnet on $wifi): Docker's own rules go
# past UFW. Made by cyber/harden.sh; run by $filter_unit at boot, before Docker starts.
set -eu
iptables -w -N DOCKER-USER 2>/dev/null || true
iptables -w -N SENTINEL-X 2>/dev/null || true
iptables -w -F SENTINEL-X
$(filter_rules | sed 's/^/iptables -w -A SENTINEL-X /')
iptables -w -C DOCKER-USER -j SENTINEL-X 2>/dev/null || iptables -w -I DOCKER-USER 1 -j SENTINEL-X
FILTER
}

filter_unit_file() {
  cat <<UNIT
# Made by cyber/harden.sh.
[Unit]
Description=Sentinel-X: keep the ports Docker publishes to the table Wi-Fi
Before=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$filter

[Install]
WantedBy=multi-user.target docker.service
UNIT
}

# --- Where it runs, for whom ----------------------------------------------------------------

[[ "$(uname -s)" == Linux ]] || die "run this on the Raspberry Pi, not on a laptop."
grep -qs "Raspberry Pi" /proc/device-tree/model || warn "this does not look like a Raspberry Pi: going on anyway."

saved() { sed -n "s/^$1=//p" "$state" 2>/dev/null | head -n 1; }
session_ip=""
if [[ "$mode" == check ]]; then
  [[ -f "$state" ]] || die "this Pi has not been hardened yet: run cyber/harden.sh $table"
  admin="${admin:-$(saved ADMIN)}"
  operator_ip="${operator_ip:-$(saved OPERATOR_IP)}"
else
  admin="${admin:-${SUDO_USER:-$(id -un)}}"
  if [[ -n "${SSH_CONNECTION:-}" ]]; then session_ip="${SSH_CONNECTION%% *}"; fi
  operator_ip="${operator_ip:-$session_ip}"
  [[ -n "$operator_ip" ]] || die "which laptop is the Operator's? Run this from it, over SSH on the table Wi-Fi, or pass --operator <its address>."
fi

if [[ ! "$operator_ip" =~ ^192\.168\.${table}\.([0-9]{1,3})$ ]] || ((10#${BASH_REMATCH[1]} < 2 || 10#${BASH_REMATCH[1]} > 254)); then
  die "$operator_ip is not on the table Wi-Fi ($subnet). Once hardened, SSH answers the Operator laptop there and nowhere else: connect it to the table Wi-Fi and ssh to $pi_ip, or pass --operator <its address there>."
fi
[[ "$operator_ip" != "$sentinel_ip" ]] || die "$operator_ip is the Sentinel's address, not a laptop's."
id "$admin" >/dev/null 2>&1 || die "no account named $admin on this Pi."
[[ "$admin" != root ]] || die "root never logs in over SSH: run this as your own user, or pass --admin <user>."
admin_keys="$(getent passwd "$admin" | cut -d: -f6)/.ssh/authorized_keys"
step "Table $table: the Pi is $pi_ip · Operator laptop: $operator_ip · SSH account: $admin"
# Asked for once, here, rather than in the middle of a step.
((EUID == 0)) || sudo -v || die "sudo is needed, to read the Pi's configuration and to change it."

# --- The checklist ---------------------------------------------------------------------------

# The value sshd gives a keyword when $admin comes in from the Operator laptop, every drop-in applied.
sshd_setting() {
  as_root sshd -T -C "user=$admin,host=$pi_ip,addr=$operator_ip" 2>/dev/null </dev/null \
    | awk -v key="$1" '$1 == key { sub(/^[^ ]+ /, ""); print }' | paste -sd ' '
}
has_ed25519_key() { as_root grep -qsE '(^|[[:space:]])ssh-ed25519[[:space:]]+AAAA' "$admin_keys"; }

check_ssh() {
  step "SSH: keys only (ed25519), no root, $admin alone"
  local keyword expected actual
  while read -r keyword expected; do
    actual="$(sshd_setting "$keyword" || true)"
    if [[ "$actual" == "$expected" ]]; then ok "$keyword $actual"; else bad "$keyword is \"$actual\", expected \"$expected\""; fi
  done <<EXPECTED
passwordauthentication no
kbdinteractiveauthentication no
pubkeyauthentication yes
pubkeyacceptedalgorithms ssh-ed25519
authenticationmethods publickey
permitrootlogin no
allowusers $admin
EXPECTED
  if has_ed25519_key; then ok "$admin has an ed25519 key in $admin_keys"; else bad "$admin has no ed25519 key in $admin_keys"; fi
}

check_firewall() {
  step "Firewall (UFW): everything coming in is denied, but SSH from $operator_ip, DHCP and NTP on $wifi"
  local status added rule
  status="$(as_root ufw status verbose 2>/dev/null || true)"
  if grep -q '^Status: active' <<<"$status"; then ok "UFW is active"; else bad "UFW is not active"; fi
  if grep -q '^Default: deny (incoming)' <<<"$status"; then ok "incoming: denied by default"; else bad "incoming is not denied by default"; fi
  added="$(as_root ufw show added 2>/dev/null | sed -n 's/^ufw //p' || true)"
  while read -r rule; do
    if grep -qxF "$rule" <<<"$added"; then ok "$rule"; else bad "missing: $rule"; fi
  done < <(firewall_rules)
  # infra/plug-and-play.sh opens these two when UFW is active. They let nothing more in: Docker's
  # published ports never go through UFW, and they are filtered below.
  while read -r rule; do
    [[ -n "$rule" ]] || continue
    grep -qxF "$rule" < <(firewall_rules) && continue
    case "$rule" in
      "allow in on $wifi to any port 443 proto tcp" | "allow in on $wifi to any port 8883 proto tcp") ;;
      *) bad "not in the checklist: $rule" ;;
    esac
  done <<<"$added"
}

check_filter() {
  step "Docker's published ports (${published_ports[*]}): the table Wi-Fi only"
  local rule count=0 expected=0
  local -a spec
  while read -r rule; do
    expected=$((expected + 1))
    read -ra spec <<<"$rule"
    if as_root iptables -w -C SENTINEL-X "${spec[@]}" 2>/dev/null; then ok "$rule"; else bad "missing: $rule"; fi
  done < <(filter_rules)
  count="$(as_root iptables -w -S SENTINEL-X 2>/dev/null | grep -c '^-A' || true)"
  ((count == expected)) || bad "the SENTINEL-X chain holds $count rules, expected $expected"
  if [[ "$(as_root iptables -w -S DOCKER-USER 2>/dev/null | sed -n '2p')" == "-A DOCKER-USER -j SENTINEL-X" ]]; then
    ok "DOCKER-USER goes through it first"
  else
    bad "DOCKER-USER does not go through SENTINEL-X first"
  fi
  if [[ "$(systemctl is-enabled "$filter_unit" 2>/dev/null || true)" == enabled ]]; then
    ok "$filter_unit puts it back at every boot"
  else
    bad "$filter_unit is not enabled: the filter would be gone after a reboot"
  fi
}

check_services() {
  step "Services nothing uses: off"
  local unit
  for unit in "${unused_units[@]}"; do
    if ! installed "$unit"; then
      ok "$unit: not installed"
    elif systemctl is-active --quiet "$unit" || [[ "$(systemctl is-enabled "$unit" 2>/dev/null || true)" == enabled ]]; then
      bad "$unit is still on"
    else
      ok "$unit: off"
    fi
  done
}

# The rest of cyber/README.md's checklist, which other scripts set up: looked at, never changed here.
look_around() {
  step "Also in the checklist (set up elsewhere, only looked at here)"
  local wifi_security containers
  if [[ "$(as_root passwd -S pi 2>/dev/null | awk '{ print $2 }')" == P ]]; then
    warn "the default account pi exists, with a password: remove it (sudo deluser --remove-home pi)"
  else
    ok "no default account pi with a password"
  fi
  wifi_security="$(as_root nmcli -g 802-11-wireless-security.key-mgmt,802-11-wireless-security.proto,802-11-wireless-security.pairwise connection show sentinel-x-ap 2>/dev/null | paste -sd ' ' || true)"
  if [[ "$wifi_security" == "wpa-psk rsn ccmp" ]]; then
    ok "table Wi-Fi: WPA2-PSK, AES (CCMP) only"
  else
    warn "table Wi-Fi security is \"$wifi_security\", expected \"wpa-psk rsn ccmp\": run infra/plug-and-play.sh $table again"
  fi
  if containers="$(as_root docker ps -q 2>/dev/null)" && [[ -n "$containers" ]]; then
    # shellcheck disable=SC2086  # one id per word
    if as_root docker inspect --format '{{ .Name }} {{ .HostConfig.Privileged }} {{ range .Mounts }}{{ .Source }} {{ end }}' $containers \
      | grep -E ' true |docker\.sock'; then
      warn "the containers above are privileged, or hold the Docker socket"
    else
      ok "no container is privileged or holds the Docker socket"
    fi
  else
    warn "no container runs: start the stack (docker compose up -d) and check again"
  fi
  echo "    What listens on the Pi (for the security matrix):"
  as_root ss -H -tuln 2>/dev/null | awk '{ print "      " $1, $5 }' | sort -u || true
}

checklist() {
  check_ssh
  check_firewall
  check_filter
  check_services
  look_around
}

if [[ "$mode" == check ]]; then
  checklist
  if ((problems)); then die "$problems line(s) of the checklist do not hold: run cyber/harden.sh $table"; fi
  printf '\nHardened: every line of the checklist holds.\n'
  exit 0
fi

# --- 1. Nobody gets locked out ----------------------------------------------------------------
step "Before anything changes: $admin can still get in afterwards"
has_ed25519_key || die "$admin has no ed25519 key in $admin_keys, and passwords are about to stop working. On the Operator laptop: ssh-keygen -t ed25519, then ssh-copy-id $admin@$pi_ip, log in again and run this again."
ok "$admin has an ed25519 key"
if [[ -n "$session_ip" ]]; then
  if [[ "$session_ip" != "$operator_ip" ]]; then
    warn "this session comes from $session_ip, SSH will only answer $operator_ip: it is the last one from here."
  fi
  # How this very session logged in, from sshd's journal: with a password, the key above may not be the laptop's.
  read -r _ session_port _ <<<"$SSH_CONNECTION"
  logged_in="$(as_root journalctl -b -u ssh -u sshd --no-pager -o cat 2>/dev/null \
    | sed -n "s/^Accepted \([a-z-]*\) for $admin from $session_ip port $session_port .*/\1/p" | tail -n 1 || true)"
  case "$logged_in" in
    publickey) ok "this session logged in with a key" ;;
    "") warn "could not tell how this session logged in: check the key in a second terminal before closing this one." ;;
    *) die "this session logged in with a $logged_in, not a key. Log in with the key first (ssh-copy-id $admin@$pi_ip from the laptop, then ssh again), and run this again." ;;
  esac
else
  warn "not run over SSH: make sure the Operator laptop ($operator_ip) holds the key before you leave the keyboard."
fi

# --- 2. Software -----------------------------------------------------------------------------
step "Software: UFW"
if ! dpkg -s ufw >/dev/null 2>&1; then
  if curl -fsS --max-time 5 -o /dev/null https://deb.debian.org; then
    change apt-get update -qq
    change env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw
  else
    die "UFW is missing and there is no Internet: plug the Pi into Ethernet and run it again."
  fi
fi
command -v iptables >/dev/null || [[ -x /usr/sbin/iptables ]] || die "iptables is missing: it comes with Docker, run infra/plug-and-play.sh $table first."
ok "packages"

# --- 3. Services nothing uses ------------------------------------------------------------------
step "Services nothing uses: off"
turned_off=()
for unit in "${unused_units[@]}"; do
  if installed "$unit"; then
    change systemctl disable --now --quiet "$unit"
    turned_off+=("$unit")
  fi
done
command -v rfkill >/dev/null && change rfkill block bluetooth
ok "off: ${turned_off[*]:-none of them is installed}"
warn "sentinel-x.local no longer answers (avahi is off): reach the Pi at $pi_ip."

# --- 4. Docker's published ports ----------------------------------------------------------------
step "Docker's published ports (${published_ports[*]}): the table Wi-Fi only"
filter_script | write "$filter" 755
filter_unit_file | write "/etc/systemd/system/$filter_unit" 644
change systemctl daemon-reload
change systemctl enable --quiet "$filter_unit"
change systemctl restart "$filter_unit"
ok "filtered in DOCKER-USER, again at every boot"

# --- 5. The Operator laptop keeps its address ------------------------------------------------------
step "The Operator laptop keeps $operator_ip"
operator_mac="$(awk -v ip="$operator_ip" '$3 == ip { print $2; exit }' /var/lib/misc/dnsmasq.leases 2>/dev/null || true)"
if [[ -n "$operator_mac" ]]; then
  write "$reservation" 644 <<DNSMASQ
# The Operator laptop: SSH answers this address alone. Made by cyber/harden.sh.
dhcp-host=$operator_mac,$operator_ip
DNSMASQ
  change systemctl restart dnsmasq
  ok "DHCP always gives $operator_ip to $operator_mac"
else
  warn "no DHCP lease for $operator_ip: if the laptop's address changes, SSH stops answering it (run this again from the new one, at the Pi's keyboard if need be)."
fi

# --- 6. Firewall -------------------------------------------------------------------------------
step "Firewall (UFW): everything coming in is denied, but SSH from $operator_ip, DHCP and NTP on $wifi"
change ufw --force reset
change ufw default deny incoming
change ufw default allow outgoing
while read -ra rule; do change ufw "${rule[@]}"; done < <(firewall_rules)
change ufw --force enable
ok "UFW on"

# --- 7. SSH, last: until here, a password still got in ----------------------------------------------
step "SSH: keys only (ed25519), no root, $admin alone"
sshd_config | write "$sshd_dropin" 644
if [[ "$mode" != dry-run ]]; then
  if ! as_root sshd -t; then
    as_root rm -f "$sshd_dropin"
    die "sshd refuses its new configuration (above): nothing changed for SSH."
  fi
  if [[ "$(sshd_setting passwordauthentication)" != no ]]; then
    as_root rm -f "$sshd_dropin"
    die "another file in /etc/ssh/sshd_config.d comes before ${sshd_dropin##*/} and keeps passwords on: nothing changed for SSH."
  fi
fi
change systemctl reload ssh
ok "sshd reloaded: this session stays open, the next ones need the key"

write "$state" 644 <<STATE
# What cyber/harden.sh applied last. Made by it.
TABLE=$table
OPERATOR_IP=$operator_ip
ADMIN=$admin
STATE

if [[ "$mode" == dry-run ]]; then
  printf '\nDry run: nothing changed. Without --dry-run, the above is done.\n'
  exit 0
fi

printf '\n\033[1mDone. The checklist, as cyber/harden.sh %s --check gives it:\033[0m\n' "$table"
checklist
if ((problems)); then die "$problems line(s) of the checklist do not hold: read above."; fi

cat <<DONE

Command Post hardened.
  Before you close this session: in a second terminal on the Operator laptop,
      ssh $admin@$pi_ip
  must log in, with the key and without a password. If it does not, fix it from this session.
  SSH         $operator_ip only, on the table Wi-Fi ($pi_ip — sentinel-x.local is gone with avahi)
  Check       cyber/harden.sh $table --check
  From the laptop, the proof for the security matrix: docs/DURCISSEMENT-PI.md, step 5 (Nmap).
DONE
