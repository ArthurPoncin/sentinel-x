#pragma once

#include <Arduino.h>

// The Alarm: a speaker, driven by the ESP32 through an NPN transistor. It sounds on its own while
// an Alert is critical, Command Post or not; the Operator can also sound it or silence it with a
// command.
namespace speaker {

void begin();
void beep(uint32_t ms);  // blocking, at boot: shows the speaker is wired
// Some Alert is critical. A new critical lifts the Operator's silence.
void setLocal(bool critical);
// From command/<id>/actuator: action on | off | pattern.
void command(const char *action);
// Call it often: it plays the siren.
void update(uint32_t now);

}  // namespace speaker
