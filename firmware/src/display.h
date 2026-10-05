#pragma once

#include "alerts.h"
#include "probes.h"

// The LCD, readable through the Enclosure: link state, Status, readings, active Alerts.
namespace display {

void begin();
void show(const Readings &readings, uint32_t now);

}  // namespace display
