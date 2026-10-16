#!/usr/bin/env bash
# Exports every part to stl/, as it prints, and the previews to apercu/.
# Needs OpenSCAD 2024 or later (the Manifold backend): brew install --cask openscad@snapshot
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p stl apercu

parts=(
  "command-post shell"
  "command-post base"
  "command-post bezel"
  "command-post tower"
  "sentinel base"
  "sentinel lid"
  "leap-stand stand"
  "screw-test plate"
)

for p in "${parts[@]}"; do
  read -r file part <<<"$p"
  out="stl/$file-$part.stl"
  log=$(openscad --backend=manifold --export-format=binstl -D "part=\"$part\"" -o "$out" "$file.scad" 2>&1)
  if grep -qE "^(WARNING|ERROR)" <<<"$log" || ! grep -q "Status: *NoError" <<<"$log"; then
    echo "$log" >&2
    echo "✗ $out" >&2
    exit 1
  fi
  echo "✓ $out"
done

# Previews: each enclosure put together, with what goes inside in colour.
shot() {  # file part camera png
  openscad -D "part=\"$2\"" --camera="$3" --projection=p --imgsize=1600,1200 --colorscheme=Tomorrow \
    -o "apercu/$4.png" "$1.scad" >/dev/null 2>&1
  echo "✓ apercu/$4.png"
}
shot command-post assembly "72,62,118,62,0,32,900" poste-de-commande
shot command-post assembly "72,62,118,62,0,212,900" poste-de-commande-arriere
shot command-post inside "72,62,38,52,0,212,520" poste-de-commande-interieur
shot sentinel assembly "63,66,25,58,0,22,420" sentinel
shot sentinel inside "63,68,10,18,0,0,360" sentinel-interieur
shot leap-stand assembly "0,0,6,55,0,25,220" support-leap
