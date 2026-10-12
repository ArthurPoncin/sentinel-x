#!/bin/sh
# Fetches the voice control's recognition model into public/voice/, where the dashboard serves it as a static
# file: Vosk's small French model, checked against its checksum and repacked as the gzipped tar the engine
# reads. Run once on a development machine (`npm run voice:model`), and by the image's build. The archive is
# not in git: forty megabytes.
set -eu

MODEL=vosk-model-small-fr-0.22
SHA256=cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad
OUT="$(dirname "$0")/../public/voice/$MODEL.tar.gz"

if [ -f "$OUT" ]; then
  echo "voice model: already there ($OUT)"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

curl -fsSL -o "$WORK/model.zip" "https://alphacephei.com/vosk/models/$MODEL.zip"
echo "$SHA256  $WORK/model.zip" | sha256sum -c - >/dev/null
unzip -q "$WORK/model.zip" -d "$WORK"
# The engine takes the folder inside the archive, whatever its name: `model`, as its documentation has it.
mv "$WORK/$MODEL" "$WORK/model"
mkdir -p "$(dirname "$OUT")"
tar -czf "$OUT" -C "$WORK" model
echo "voice model: $OUT"
