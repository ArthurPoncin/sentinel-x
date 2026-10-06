#!/usr/bin/env bash
# The Command Post's own images: what each is built from, and the key that names a build of it. One
# source for the CI that builds them for the Pi and publishes them (.github/workflows/images.yml) and
# for infra/plug-and-play.sh, which pulls the one that matches its checkout instead of building it:
#   infra/images.sh list                     the services that have an image of their own
#   infra/images.sh key <service>            the key of the checked-out code (its git trees: commits only)
#   infra/images.sh remote <service>         ghcr.io/<owner>/sentinel-x-<service>:<key>
#   infra/images.sh context <service>        as docker-compose.yml builds it, from the repo root
#   infra/images.sh dockerfile <service>     the same, from the context (docker build -f wants both joined)
#   infra/images.sh dirty <service>          exit 0 when the working copy changed what it is built from
# IMAGES_REGISTRY overrides ghcr.io/arthurponcin, for a fork.
#
# A service's paths must hold everything its Dockerfile copies, its .dockerignore and the Dockerfile
# itself: a path left out would let an image built from other code through. One too many is harmless:
# the key changes more often, which costs a build. The CI checks context and Dockerfile against
# docker-compose.yml.
set -euo pipefail

registry="${IMAGES_REGISTRY:-ghcr.io/arthurponcin}"
services=(reverse-proxy api dashboard vision predictive)

# <service> → context, Dockerfile from the context, then the paths its image is built from.
describe() {
  case "$1" in
    reverse-proxy) echo "infra/caddy Dockerfile infra/caddy" ;;
    api) echo "backend Dockerfile backend" ;;
    dashboard) echo ". dashboard/Dockerfile dashboard backend/src/contract.ts" ;;
    vision) echo "ai vision/Dockerfile ai/vision ai/common ai/.dockerignore" ;;
    predictive) echo "ai predictive/Dockerfile ai/predictive ai/common ai/.dockerignore" ;;
  esac
}

sha256() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }

cd "$(dirname "$0")/.."
command="${1:-}"
if [[ "$command" == list ]]; then
  printf '%s\n' "${services[@]}"
  exit 0
fi
[[ $# -eq 2 ]] || { echo "Usage: infra/images.sh list | key|remote|context|dockerfile|dirty <service>" >&2; exit 2; }
[[ " ${services[*]} " == *" $2 "* ]] || { echo "Unknown service $2: expected one of ${services[*]}" >&2; exit 2; }
read -r context dockerfile paths <<<"$(describe "$2")"
read -ra paths <<<"$paths"

# The ids of the trees and files it is built from: the same content gives the same key, on the CI as on
# the Pi, whatever the commit.
key() { git rev-parse "${paths[@]/#/HEAD:}" | sha256 | cut -c1-16; }

case "$command" in
  key) key ;;
  remote) echo "$registry/sentinel-x-$2:$(key)" ;;
  context) echo "$context" ;;
  dockerfile) echo "$dockerfile" ;;
  dirty) [[ -n "$(git status --porcelain -- "${paths[@]}")" ]] ;;
  *) echo "Unknown command $command" >&2; exit 2 ;;
esac
