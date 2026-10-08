# The stack's own images onto the Pi, for infra/plug-and-play.sh and infra/update.sh — sourced, not
# run, from the repo root.

# Runs a command with a group the user just joined, without logging out and in again.
with_group() {
  local group="$1"; shift
  if id -nG | grep -qw "$group"; then "$@"; else sg "$group" -c "$(printf '%q ' "$@")"; fi
}

# Pulls, all at once, each image whose key matches the checkout (infra/images.sh), and names it as
# docker-compose.yml does. One line per service in $1: "<service> pulled|private|missing|changed".
pull_images() {
  local service
  for service in $(infra/images.sh list); do
    (
      if infra/images.sh dirty "$service"; then echo "$service changed" >>"$1"; exit 0; fi
      remote="$(infra/images.sh remote "$service")"
      if with_group docker docker pull "$remote" 2>&1 | tee "$1.$service"; [[ ${PIPESTATUS[0]} -eq 0 ]]; then
        with_group docker docker tag "$remote" "sentinel-x/$service"
        echo "$service pulled" >>"$1"
      elif grep -qiE 'denied|unauthorized' "$1.$service"; then
        echo "$service private" >>"$1"
      else
        echo "$service missing" >>"$1"
      fi
    ) &
  done
  wait
}

build_image() {
  local context
  context="$(infra/images.sh context "$1")"
  with_group docker docker build -t "sentinel-x/$1" -f "$context/$(infra/images.sh dockerfile "$1")" "$context"
}
