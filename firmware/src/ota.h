#pragma once

#include <Arduino.h>

// The Sentinel's new firmware over the table Wi-Fi: no cable once the first one is in. The Pi asks
// for it over MQTTS (command/<id>/firmware); it comes over HTTPS from the Pi alone, its certificate
// checked against the team CA, behind a token, and its MD5 checked before it is booted.
namespace ota {

// What this firmware was built as: FIRMWARE_VERSION, given by infra/plug-and-play.sh.
const char *version();
// A command on command/<id>/firmware, retained: { "version": "...", "md5": "<32 hex>" }. Kept when
// the version differs from this one; the download waits for the loop.
void command(const char *payload, size_t length);
// Whether a download waits. The uplink lets go of the broker before it: TLS needs the memory.
bool pending();
// Downloads, writes and restarts on the new firmware. Returns only when it failed: why, in lastError().
void run();
const char *lastError();

}  // namespace ota
