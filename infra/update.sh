#!/usr/bin/env bash
# The Command Post's update, once infra/plug-and-play.sh has installed it: the code, its images, the
# containers whose image changed, and nothing else. Run it on the Pi, as your usual user, with
# Internet through Ethernet:
#   infra/update.sh
# No sudo, no table number: the table Wi-Fi, the secrets, the status screen and the ESP32 stay as
# they are, so an SSH session over the Wi-Fi holds. What the pull brought that only
# infra/plug-and-play.sh or cyber/harden.sh applies (the firmware, the broker's accounts and ACL,
# the Pi's own setup), it says at the end.
#
# Its interface is infra/ui.sh, as for infra/plug-and-play.sh; the commands' output is kept in
# ~/.local/share/sentinel-x/update.log.
set -euo pipefail

[[ $# -eq 0 ]] || { echo "Usage : infra/update.sh" >&2; exit 1; }
cd "$(dirname "$0")/.."

# --- The code, then this script again as the pull left it ---------------------------------------
# In braces, so that bash reads it whole before the pull rewrites the file under it.
if [[ -z "${UPDATE_FROM:-}" ]]; then {
  [[ -f infra/secrets/api.env ]] || { echo "Ce Pi n'est pas encore installé : infra/plug-and-play.sh <numéro de table> d'abord." >&2; exit 1; }
  from="$(git rev-parse HEAD)"
  git pull --ff-only || { echo "git pull a échoué : branche l'Ethernet, ou regarde ce que git dit ci-dessus, puis relance." >&2; exit 1; }
  UPDATE_FROM="$from" exec infra/update.sh
}; fi

# shellcheck source=infra/ui.sh
source infra/ui.sh
# shellcheck source=infra/pull.sh
source infra/pull.sh

commits="$(git rev-list --count "$UPDATE_FROM..HEAD")"
if ((commits)); then
  plural=""
  ((commits > 1)) && plural=s
  code="$(git rev-parse --short "$UPDATE_FROM") → $(git rev-parse --short HEAD) ($commits commit$plural)"
else
  code="déjà à jour ($(git rev-parse --short HEAD))"
fi
# What changed, among what this script leaves alone.
changed() { [[ -n "$(git diff --name-only "$UPDATE_FROM" HEAD -- "$@")" ]]; }

ui_init 2 "$HOME/.local/share/sentinel-x/update.log" "infra/update.sh"
ui_banner "SENTINEL-X · Mise à jour" "Code $code"

# --- 1. The images: pulled when the CI built them for this code, built here otherwise -----------
ui_step "Images Docker"
results="$(mktemp)"
pulled=() built=()
ui_task "téléchargement des images préconstruites" pull_images "$results"
for service in $(infra/images.sh list); do
  if grep -qx "$service pulled" "$results"; then pulled+=("$service"); continue; fi
  ui_task "construction de $service sur le Pi" build_image "$service"
  ((UI_RC == 0)) || ui_fail "l'image $service ne se télécharge pas et ne se construit pas : la fin du journal dit pourquoi."
  built+=("$service")
done
rm -f "$results" "$results".*
images=""
if ((${#pulled[@]})); then images="téléchargées : ${pulled[*]}"; fi
if ((${#built[@]})); then
  images+="${images:+ · }construites ici : ${built[*]}"
  ui_note "pas d'image préconstruite à télécharger pour ce code (${built[*]}) : la CI de GitHub la construit peut-être encore, ou le paquet est encore privé. Construite ici, c'est plus long."
fi
ui_detail "$images"
ui_done

# --- 2. The stack: only the containers whose image or settings changed are made again -----------
ui_step "Redémarrage de la stack"
ui_task "remplacement des conteneurs qui ont changé" with_group docker docker compose up -d
((UI_RC == 0)) || ui_fail "la stack ne démarre pas : la fin du journal dit pourquoi."
# The broker reads its configuration when it starts, and Compose sees no change in a mounted file.
if changed infra/mosquitto/mosquitto.conf; then
  ui_run "redémarrage du broker, sa configuration a changé" with_group docker docker compose restart mosquitto
fi
ui_detail "en marche : $(with_group docker docker compose ps --format '{{.Service}}' | tr '\n' ' ')"
ui_done

# --- The summary -------------------------------------------------------------------------------
summary=("Code         $code")
if ((${#pulled[@]})); then summary+=("Téléchargé   ${pulled[*]}"); fi
if ((${#built[@]})); then summary+=("Construit    ${built[*]}"); fi
summary+=(
  "Durée        $(_ui_duration "$SECONDS")"
  "Journal      $(_ui_home "$UI_LOG")"
)
printf '\n'
if ((${#UI_ALL_NOTES[@]})); then
  ui_box "$C_YELLOW" "Command Post à jour, avec des remarques" "${summary[@]}"
else
  ui_box "$C_GREEN" "Command Post à jour" "${summary[@]}"
fi

# What the pull brought that this script does not apply: each with the command that does.
next=()
if changed firmware; then
  next+=("Le firmware du Sentinel a changé : branche l'ESP32 sur le Pi, puis infra/plug-and-play.sh <numéro de table>")
elif changed infra/setup.sh infra/mosquitto/acl infra/plug-and-play.sh infra/screen.py docker-compose.pan.yml; then
  next+=("L'installation du Pi a changé (comptes du broker, Wi-Fi, écran, moteur de la caméra…) : infra/plug-and-play.sh <numéro de table> --no-flash")
fi
if changed cyber/harden.sh; then
  next+=("Le durcissement a changé : cyber/harden.sh <numéro de table>, après plug-and-play.sh s'il est à relancer")
fi
if ((${#next[@]})); then
  printf "\n %sÀ faire aussi, ce script ne s'en charge pas :%s\n" "$C_BOLD" "$C_RESET"
  for line in "${next[@]}"; do
    _ui_wrap $((UI_WIDTH - 5)) "$line"
    printf '   %s%s%s %s\n' "$C_YELLOW" "$G_WARN" "$C_RESET" "${UI_WRAPPED[0]}"
    for rest in "${UI_WRAPPED[@]:1}"; do printf '     %s\n' "$rest"; done
  done
fi
printf '\n'
