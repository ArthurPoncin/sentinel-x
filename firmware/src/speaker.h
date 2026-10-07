#pragma once

#include <Arduino.h>

// The Alarm: a DFPlayer Mini and its speaker, playing the sounds of its microSD card (firmware/sd/).
// It sounds on its own while an Alert is critical, Command Post or not; the Operator can also sound
// it or silence it with a command.
namespace speaker {

void begin();
// Some Alert is critical. A new critical lifts the Operator's silence.
void setLocal(bool critical);
// From command/<id>/actuator: action on | off | pattern.
void command(const char *action);
// Call it often: it talks to the DFPlayer and keeps the sound going.
void update(uint32_t now);
// The DFPlayer said it reads its microSD card. Without it, the Alarm still plays, blind.
bool cardSeen();

}  // namespace speaker
