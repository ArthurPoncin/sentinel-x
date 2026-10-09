#!/usr/bin/env bash
# Readies the Operator laptop (Linux or macOS) for the dashboard, once, on the table Wi-Fi:
#   - fetches the team CA from the Pi (scp) and trusts it: the system's store, and the browsers
#     that keep their own list (Chrome, Chromium and Firefox on Linux);
#   - gives the Pi its name in /etc/hosts: the table Wi-Fi has no DNS.
# After it, https://sentinel-x.local/ opens with no warning. Windows: infra/operator.ps1.
#   infra/operator.sh <table number> <your user on the Pi> [the repo's directory on the Pi]
#   e.g. infra/operator.sh 4 arthur
# It can be run again at will: after a new CA on the Pi, it replaces the old one.
set -euo pipefail

table="${1:-}"
pi_user="${2:-}"
pi_dir="${3:-sentinel-x}"
if [[ ! "$table" =~ ^[0-9]{1,3}$ ]] || ((table > 254)) || [[ -z "$pi_user" ]]; then
  echo "Usage : infra/operator.sh <numéro de table> <ton utilisateur sur le Pi> [dossier du dépôt sur le Pi]" >&2
  exit 1
fi
pi_ip="192.168.${table}.1"
pi_name=sentinel-x.local
ca_name="Sentinel-X Team CA"

step() { printf '\n%s\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
note() { printf '  ! %s\n' "$1"; }
die() {
  printf '  ✗ %s\n' "$1" >&2
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
ca="$work/ca.crt"

step "1. Le certificat de l'équipe, pris sur le Pi ($pi_ip)"
# ssh's errors are kept, for scp to say why it fails: its warnings only are left out.
scp -o LogLevel=ERROR "$pi_user@$pi_ip:$pi_dir/infra/secrets/ca.crt" "$ca" \
  || die "scp n'a pas pris le certificat sur le Pi, sa raison est juste au-dessus. « timed out » : ce PC n'est pas sur le Wi-Fi SentinelX-$table, ou le Pi est durci et SSH ne répond qu'au PC Opérateur. « Permission denied » : l'utilisateur du Pi ou son mot de passe. « No such file » : le dépôt n'est pas dans ~/$pi_dir sur le Pi, donne son dossier en 3e argument."
openssl x509 -in "$ca" -noout -subject 2>/dev/null | grep -q "$ca_name" \
  || die "ce fichier n'est pas le certificat de l'équipe ($ca_name)."
ok "$(openssl x509 -in "$ca" -noout -fingerprint -sha256 | sed 's/.*=/empreinte SHA-256 /')"

step "2. Autorité de confiance sur ce PC (sudo demande ton mot de passe)"
# Adds the CA to a browser's own list (NSS), in place of one of the same name.
trust_in_nss() {
  local db="$1"
  certutil -d "sql:$db" -D -n "$ca_name" >/dev/null 2>&1 || true
  certutil -d "sql:$db" -A -t "C,," -n "$ca_name" -i "$ca"
}
if [[ "$(uname)" == Darwin ]]; then
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$ca"
  ok "trousseau Système : Safari, Chrome et Firefox"
else
  if command -v update-ca-certificates >/dev/null; then
    sudo install -m 644 "$ca" /usr/local/share/ca-certificates/sentinel-x.crt
    sudo update-ca-certificates >/dev/null
  elif command -v trust >/dev/null; then
    sudo trust anchor --store "$ca"
  else
    die "ni update-ca-certificates ni trust sur ce PC : importe le certificat à la main (docs/INSTALLATION-PI.md, étape 8)."
  fi
  ok "magasin du système"
  if command -v certutil >/dev/null; then
    # Chrome and Chromium read ~/.pki/nssdb, Firefox one database per profile.
    if [[ ! -f "$HOME/.pki/nssdb/cert9.db" ]]; then
      mkdir -p "$HOME/.pki/nssdb"
      certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password
    fi
    trust_in_nss "$HOME/.pki/nssdb"
    browsers="Chrome, Chromium"
    for profile in "$HOME"/.mozilla/firefox/*/ "$HOME"/snap/firefox/common/.mozilla/firefox/*/ \
      "$HOME"/.var/app/org.mozilla.firefox/.mozilla/firefox/*/; do
      [[ -f "$profile/cert9.db" ]] || continue
      trust_in_nss "$profile"
      browsers="Chrome, Chromium, Firefox"
    done
    ok "navigateurs : $browsers"
  else
    note "sans certutil (paquet nss sur Arch, libnss3-tools sur Debian et Ubuntu, nss-tools sur Fedora), Chrome et Firefox gardent leur avertissement : installe-le, puis relance."
  fi
fi

step "3. Le nom du Pi dans /etc/hosts"
if grep -qE "^${pi_ip}[[:space:]]+${pi_name}\$" /etc/hosts; then
  ok "$pi_ip $pi_name (déjà là)"
else
  # Without the line of another table, if there is one.
  hosts="$(grep -vE "[[:space:]]$pi_name\$" /etc/hosts || true)"
  printf '%s\n%s %s\n' "$hosts" "$pi_ip" "$pi_name" | sudo tee /etc/hosts >/dev/null
  ok "$pi_ip $pi_name"
fi

step "4. Le dashboard"
if curl -fsS --max-time 5 --cacert "$ca" -o /dev/null "https://$pi_name/"; then
  ok "https://$pi_name/ répond, avec un certificat reconnu"
else
  note "https://$pi_name/ ne répond pas encore : la stack tourne-t-elle sur le Pi (docker compose ps) ?"
fi
printf '\nFerme et rouvre le navigateur, puis ouvre https://%s/\n' "$pi_name"
