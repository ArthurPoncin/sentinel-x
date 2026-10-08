#!/usr/bin/env bash
# The stepper motor that turns the webcam, in place of the servo: a 28BYJ-48 on its ULN2003 board. Run it
# once on the Pi, from the repo root, as your usual user, with the board wired:
#   infra/stepper.sh
# then run infra/plug-and-play.sh <table> --no-flash: it gives vision the Pi's GPIO chip
# (docker-compose.stepper.yml).
#
# Wiring, the Pi off: the board's IN1, IN2, IN3, IN4 on GPIO 6, 13, 19, 26 (pins 31, 33, 35, 37), its −
# on the ground next to them (pin 39), its + on 5 V (pin 4), the motor in its white socket. It draws some
# 200 mA, steadily: the Pi's 5 V gives that, where a servo that stalls asks for more. Other GPIOs:
# PAN_STEPPER_PINS=IN1,IN2,IN3,IN4 in .env. Before each start, turn the camera by hand to look straight
# ahead: the motor says nothing of where it is, and takes itself to start there.
set -euo pipefail

[[ "$(uname -s)" == Linux ]] || { echo "Lance ce script sur le Raspberry Pi, pas sur un ordinateur." >&2; exit 1; }
[[ -e /dev/gpiochip0 ]] || { echo "Pas de /dev/gpiochip0 : ce n'est pas un Raspberry Pi." >&2; exit 1; }
cd "$(dirname "$0")/.."

# One motor turns the camera: the servo's PWM channel is no longer exported at boot.
if systemctl is-enabled --quiet sentinel-x-servo.service 2>/dev/null; then
  sudo systemctl disable --quiet sentinel-x-servo.service
  echo "✓ Servo retiré : son canal PWM n'est plus préparé au démarrage."
fi

touch .env
if grep -qx 'PAN_STEPPER=true' .env; then
  echo "✓ Moteur pas à pas déjà déclaré dans .env."
else
  printf 'PAN_STEPPER=true\n' >>.env
  echo "✓ Moteur pas à pas déclaré dans .env (PAN_STEPPER=true)."
fi

echo
echo "Tourne la caméra à la main pour qu'elle regarde droit devant, puis lance :"
echo "  infra/plug-and-play.sh <numéro de table> --no-flash"
