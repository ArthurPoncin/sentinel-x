#include "speaker.h"

#include "pins.h"

namespace {

// A square wave on the transistor's base: the speaker, between the 5 V and the collector, plays it.
constexpr int CHANNEL = 0;
constexpr uint32_t STEADY_HZ = 2600;
constexpr uint32_t SIREN_LOW_HZ = 1800, SIREN_HIGH_HZ = 2600, SIREN_STEP_MS = 350;

enum class Operator { None, On, Siren, Silenced };
Operator fromOperator = Operator::None;
bool localCritical = false;
uint32_t playing = 0;  // the frequency on the pin, 0 when quiet

void play(uint32_t hz) {
  if (hz == playing) return;
  ledcWriteTone(CHANNEL, hz);
  playing = hz;
}

}  // namespace

namespace speaker {

void begin() {
  ledcSetup(CHANNEL, STEADY_HZ, 8);
  ledcAttachPin(PIN_SPEAKER, CHANNEL);
  play(0);
}

void beep(uint32_t ms) {
  play(STEADY_HZ);
  delay(ms);
  play(0);
}

void setLocal(bool critical) {
  if (critical && !localCritical && fromOperator == Operator::Silenced) fromOperator = Operator::None;
  localCritical = critical;
}

void command(const char *action) {
  if (strcmp(action, "on") == 0) fromOperator = Operator::On;
  else if (strcmp(action, "pattern") == 0) fromOperator = Operator::Siren;
  else if (strcmp(action, "off") == 0) fromOperator = localCritical ? Operator::Silenced : Operator::None;
}

void update(uint32_t now) {
  bool siren = fromOperator == Operator::Siren || (localCritical && fromOperator == Operator::None);
  if (fromOperator == Operator::On) play(STEADY_HZ);
  else if (siren) play((now / SIREN_STEP_MS) % 2 ? SIREN_HIGH_HZ : SIREN_LOW_HZ);
  else play(0);
}

}  // namespace speaker
