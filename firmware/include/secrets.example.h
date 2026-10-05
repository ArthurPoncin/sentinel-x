#pragma once

// Copy to secrets.h (git-ignored) and fill it in, or let infra/plug-and-play.sh write it on the
// Pi from infra/secrets/: the credentials then never leave the Command Post.

#define WIFI_SSID "SentinelX-4"
#define WIFI_PASSPHRASE "the table Wi-Fi passphrase"
#define BROKER_HOST "192.168.4.1"  // the Pi: its broker certificate names this address
#define BROKER_PORT 8883
#define MQTT_USER "sentinel-01"
#define MQTT_PASSWORD "sentinel-01's password, from infra/secrets/handover.txt"
#define NTP_SERVER "192.168.4.1"   // chrony on the Pi: the table network has no Internet

// infra/secrets/ca.crt: the team CA that signed the broker's certificate.
static const char CA_CERT[] = R"PEM(
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
)PEM";
