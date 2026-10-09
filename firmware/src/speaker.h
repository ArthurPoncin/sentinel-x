#pragma once

#include <Arduino.h>

// The Alarm: a speaker through 100 ohms, or the buzzer, between IO25 and GND. It sounds on its own
// while an Alert is critical, Command Post or not; the Operator can also sound it or silence it with
// a command. It plays from its own timer, whatever the main loop is busy with.
namespace speaker {

void begin();
void beep(uint32_t ms);  // blocking, at boot: shows the speaker is wired
// Some Alert is critical. A new critical lifts the Operator's silence.
void setLocal(bool critical);
// From command/<id>/actuator: action on | off | pattern.
void command(const char *action);

}  // namespace speaker
