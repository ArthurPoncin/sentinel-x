#pragma once

#include <Arduino.h>

// The Sentinel's link to the Command Post: the table Wi-Fi, the time from the Pi, and MQTTS
// to the broker, its certificate checked against the team CA.
namespace uplink {

using OnCommand = void (*)(const char *payload, size_t length);
using OnConnect = void (*)();

// onCommand: command/<id>/actuator; onFirmware: command/<id>/firmware (src/ota.h).
void begin(OnCommand onCommand, OnCommand onFirmware, OnConnect onConnect);
// Call it often: keeps the connections up, one attempt every few seconds, and reads commands.
void update(uint32_t now);
bool publish(const char *topic, const char *payload, bool retained = false);
// Lets go of the broker, for the firmware's download: update() connects again afterwards.
void stop();

bool wifiUp();
bool timeKnown();
bool brokerUp();
// Why the broker is not reached, in a few words for the serial monitor; empty when it is.
const char *problem();
// UTC now as 2026-10-05T14:23:00Z; false until the Pi gave the time.
bool isoNow(char *out, size_t size);

}  // namespace uplink
