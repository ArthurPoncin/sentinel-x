#!/usr/bin/env bash
# The servo that turns the webcam: gives the Pi a hardware PWM channel on GPIO 18 (pin 12) and
# exports it at each boot, for the vision service to write the servo's pulse to. Run it once on
# the Pi, from the repo root, as your usual user, with the servo wired:
#   infra/servo.sh
# then reboot if it says so, and run infra/plug-and-play.sh <table> --no-flash: it finds the
# channel and gives it to vision (docker-compose.pan.yml).
#
# Wiring: the servo's signal on GPIO 18 (pin 12), its ground on one of the Pi's (pin 14), its
# 5 V on a supply of its own with the grounds joined — a servo that stalls draws more than the
# Pi's 5 V pin gives, and the Pi restarts.
set -euo pipefail

overlay="dtoverlay=pwm,pin=18,func=2"
config=/boot/firmware/config.txt
chip=/sys/class/pwm/pwmchip0
unit=sentinel-x-servo.service

[[ "$(uname -s)" == Linux ]] || { echo "Lance ce script sur le Raspberry Pi, pas sur un ordinateur." >&2; exit 1; }
[[ -f "$config" ]] || { echo "Pas de $config : ce n'est pas un Raspberry Pi OS (Bookworm)." >&2; exit 1; }
getent group gpio >/dev/null || { echo "Pas de groupe gpio sur ce système." >&2; exit 1; }

reboot=false
if grep -qxF "$overlay" "$config"; then
  echo "✓ PWM matériel déjà activé sur GPIO 18."
else
  printf '\n# Sentinel-X: the camera servo, hardware PWM on GPIO 18 (infra/servo.sh).\n%s\n' "$overlay" | sudo tee -a "$config" >/dev/null
  reboot=true
  echo "✓ PWM matériel activé sur GPIO 18 dans $config."
fi

# The channel does not outlive a reboot: exported again at each one, before Docker starts vision,
# whose container needs the channel's directory to be there. Its three files go to the gpio group,
# which the container is given.
sudo tee "/etc/systemd/system/$unit" >/dev/null <<UNIT
# The PWM channel of the camera's servo, for the vision service. Made by infra/servo.sh.
[Unit]
Description=Sentinel-X camera servo (PWM channel on GPIO 18)
Before=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
# The PWM driver comes with the overlay, a moment after the boot starts.
ExecStartPre=/bin/sh -c 'for i in 1 2 3 4 5 6 7 8 9 10; do [ -d $chip ] && exit 0; sleep 1; done; exit 1'
ExecStart=/bin/sh -c '[ -d $chip/pwm0 ] || echo 0 > $chip/export'
ExecStart=/bin/sh -c 'cd $chip/pwm0 && chgrp gpio period duty_cycle enable && chmod g+w period duty_cycle enable'

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --quiet "$unit"
echo "✓ Canal PWM exporté à chaque démarrage ($unit)."

if $reboot; then
  echo
  echo "Redémarre le Pi (sudo reboot), puis lance : infra/plug-and-play.sh <numéro de table> --no-flash"
elif sudo systemctl restart "$unit" && [[ -e "$chip/pwm0/duty_cycle" ]]; then
  echo "✓ Canal prêt : $chip/pwm0"
  echo
  echo "Lance maintenant : infra/plug-and-play.sh <numéro de table> --no-flash"
else
  echo "Le canal PWM n'apparaît pas : systemctl status $unit dit pourquoi (un redémarrage peut suffire)." >&2
  exit 1
fi
