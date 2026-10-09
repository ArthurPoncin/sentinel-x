#include "speaker.h"

#include <esp_timer.h>

#include <atomic>

#include "pins.h"

namespace {

// A square wave on IO25: the speaker (through its resistor) or the buzzer, between the pin and GND, plays it.
constexpr int CHANNEL = 0;
constexpr uint32_t STEADY_HZ = 2600;

// The siren is a tune: the "Axel F" riff (Crazy Frog), one voice, an octave up so a bare speaker
// carries it. A step is a sixteenth note at 138 bpm. The riff is staccato: its rests are written
// out, and each note is cut a little short, as the synth plays it.
constexpr uint32_t SIREN_STEP_MS = 109, SIREN_GAP_MS = 25;
constexpr uint64_t TICK_US = 5000;  // the tune's resolution
constexpr uint16_t REST = 0, C5 = 523, EB5 = 622, F5 = 698, G5 = 784, AB5 = 831, BB5 = 932, C6 = 1047,
                   DB6 = 1109, F6 = 1397;
struct Note {
  uint16_t hz;
  uint8_t steps;
};
constexpr Note SIREN[] = {
    {F5, 2}, {REST, 2}, {AB5, 3}, {F5, 1}, {REST, 1}, {F5, 1}, {BB5, 2}, {F5, 2}, {EB5, 2},
    {F5, 2}, {REST, 2}, {C6, 3},  {F5, 1}, {REST, 1}, {F5, 1}, {DB6, 2}, {C6, 2}, {AB5, 2},
    {F5, 2}, {C6, 2}, {F6, 2}, {F5, 1}, {EB5, 1}, {REST, 1}, {EB5, 1}, {C5, 2}, {G5, 2}, {F5, 8}, {REST, 10},
};
constexpr size_t SIREN_NOTES = sizeof(SIREN) / sizeof(SIREN[0]);

// Set from the main loop, read by the tick.
enum class Operator { None, On, Siren, Silenced };
std::atomic<Operator> fromOperator{Operator::None};
std::atomic<bool> localCritical{false};

// The tick's own.
esp_timer_handle_t tickTimer;
uint32_t playing = 0;  // the frequency on the pin, 0 when quiet
bool sirenOn = false;
size_t sirenNote = 0;        // the note of the tune being played
uint32_t sirenNoteAt = 0;    // when it began

void play(uint32_t hz) {
  if (hz == playing) return;
  ledcWriteTone(CHANNEL, hz);
  playing = hz;
}

// The tune from its first note each time the siren starts, then round and round.
void playSiren(uint32_t now) {
  if (!sirenOn) {
    sirenOn = true;
    sirenNote = 0;
    sirenNoteAt = now;
  }
  uint32_t length = SIREN[sirenNote].steps * SIREN_STEP_MS;
  while (now - sirenNoteAt >= length) {
    sirenNoteAt += length;
    sirenNote = (sirenNote + 1) % SIREN_NOTES;
    length = SIREN[sirenNote].steps * SIREN_STEP_MS;
  }
  play(now - sirenNoteAt < length - SIREN_GAP_MS ? SIREN[sirenNote].hz : REST);
}

// Every 5 ms, from the esp_timer task: a TLS handshake that holds the main loop for seconds would
// otherwise hold a note as long, then skip half the tune.
void onTick(void *) {
  uint32_t now = millis();
  Operator op = fromOperator;
  bool siren = op == Operator::Siren || (localCritical && op == Operator::None);
  if (!siren || op == Operator::On) sirenOn = false;
  if (op == Operator::On) play(STEADY_HZ);
  else if (siren) playSiren(now);
  else play(0);
}

}  // namespace

namespace speaker {

void begin() {
  ledcSetup(CHANNEL, STEADY_HZ, 8);
  ledcAttachPin(PIN_SPEAKER, CHANNEL);
  play(0);

  esp_timer_create_args_t args = {};
  args.callback = onTick;
  args.name = "speaker";
  esp_timer_create(&args, &tickTimer);
  esp_timer_start_periodic(tickTimer, TICK_US);
}

void beep(uint32_t ms) {
  fromOperator = Operator::On;
  delay(ms);
  fromOperator = Operator::None;
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

}  // namespace speaker
