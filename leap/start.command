#!/usr/bin/env bash
# The hand bridge on macOS, by a double click (or `./start.command` in a terminal, Linux included): installs
# what it needs the first time (Internet needed, so before joining the table Wi-Fi), then reads the sensor
# until this window is closed.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null; then
  echo "Node.js manque : installe la version 22 ou plus récente depuis https://nodejs.org, puis relance."
  read -r -p "Entrée pour fermer."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Première fois : installation, avec Internet..."
  if ! npm install --no-audit --no-fund; then
    echo "L'installation a échoué : il faut Internet la première fois. Relance une fois connecté."
    read -r -p "Entrée pour fermer."
    exit 1
  fi
fi

echo "Pont du capteur de main. Laisse cette fenêtre ouverte pendant la démo."
npm start
read -r -p "Entrée pour fermer."
