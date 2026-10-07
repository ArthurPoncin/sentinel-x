#include "speaker.h"

#include "config.h"
#include "pins.h"

namespace {

// The tracks of the card's mp3/ folder: track N is mp3/000N.mp3, made by firmware/sd/sounds.py.
enum Track : uint16_t { NONE = 0, SIREN = 1, STEADY = 2, BEEP = 3 };
// The siren and the steady tone last 30 s: played again just before their end, they never stop.
constexpr uint32_t LOOP_MS = 29500;

// The DFPlayer's serial protocol, 9600 baud, 10 bytes a frame either way:
// 7E FF 06 <command> <ack wanted> <param high> <param low> <checksum high> <checksum low> EF.
constexpr uint8_t CMD_VOLUME = 0x06, CMD_RESET = 0x0C, CMD_PLAY_MP3 = 0x12, CMD_STOP = 0x16, CMD_QUERY_DEVICE = 0x3F;
constexpr uint8_t MSG_CARD_IN = 0x3A, MSG_CARD_OUT = 0x3B, MSG_ONLINE = 0x3F, MSG_ERROR = 0x40;
constexpr uint16_t DEVICE_CARD = 0x02;  // in MSG_ONLINE's param, one bit per storage it reads
constexpr uint32_t GAP_MS = 100;        // between two commands: closer, the DFPlayer drops one
constexpr uint32_t STARTUP_MS = 3000;   // its reset takes a second or two; then it is played to blind

HardwareSerial &player = Serial2;
uint8_t frame[10];
size_t received = 0;
uint32_t resetAt = 0, lastSent = 0, startedAt = 0;
bool ready = false, volumeSet = false, beepOwed = false, card = false;
Track playing = NONE;

enum class Operator { None, On, Siren, Silenced };
Operator fromOperator = Operator::None;
bool localCritical = false;

uint16_t checksum(const uint8_t *bytes) {
  uint16_t sum = 0;
  for (int i = 1; i < 7; i++) sum += bytes[i];
  return uint16_t(0 - sum);
}

void sendCommand(uint8_t command, uint16_t param) {
  uint8_t out[10] = {0x7E, 0xFF, 0x06, command, 0x00, uint8_t(param >> 8), uint8_t(param), 0, 0, 0xEF};
  uint16_t sum = checksum(out);
  out[7] = sum >> 8;
  out[8] = sum;
  player.write(out, sizeof out);
  lastSent = millis();
}

// It takes commands from now on: the volume first, then a beep that shows the speaker is wired. Ready
// again, it restarted on its own (a dip in its 5 V): its volume and its track are gone.
void becomeReady() {
  if (!ready) beepOwed = true;
  ready = true;
  volumeSet = false;
  playing = NONE;
}

void onMessage(uint8_t type, uint16_t param) {
  switch (type) {
    case MSG_ONLINE:
      card = param & DEVICE_CARD;
      Serial.printf("[speaker] DFPlayer ready, %s\n", card ? "microSD card read" : "no microSD card");
      becomeReady();
      break;
    case MSG_CARD_IN:
      card = true;
      Serial.println("[speaker] microSD card in");
      break;
    case MSG_CARD_OUT:
      card = false;
      Serial.println("[speaker] microSD card out");
      break;
    case MSG_ERROR:
      // 5 and 6: no such track on the card.
      Serial.printf("[speaker] DFPlayer error %u%s\n", param,
                    param == 5 || param == 6 ? ": a sound is missing, copy firmware/sd/mp3 to the card" : "");
      break;
  }
}

void readMessages() {
  while (player.available()) {
    uint8_t incoming = player.read();
    if (received == 0 && incoming != 0x7E) continue;  // back in step with the frames
    frame[received++] = incoming;
    if (received < sizeof frame) continue;
    received = 0;
    if (frame[9] == 0xEF && (frame[7] << 8 | frame[8]) == checksum(frame)) onMessage(frame[3], frame[5] << 8 | frame[6]);
  }
}

Track wanted() {
  if (fromOperator == Operator::On) return STEADY;
  if (fromOperator == Operator::Siren || (localCritical && fromOperator == Operator::None)) return SIREN;
  return beepOwed ? BEEP : NONE;
}

}  // namespace

namespace speaker {

void begin() {
  player.begin(9600, SERIAL_8N1, PIN_MP3_RX, PIN_MP3_TX);
  // Reset, whether it was just powered or not: it then says when it is ready and what it reads.
  sendCommand(CMD_RESET, 0);
  resetAt = millis();
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
  readMessages();
  if (!ready) {
    if (now - resetAt < STARTUP_MS) return;
    // No word from it: its TX may not reach IO16. Asked again, and played to anyway.
    Serial.println("[speaker] no word from the DFPlayer: check its TX on IO16. Playing anyway");
    sendCommand(CMD_QUERY_DEVICE, 0);
    becomeReady();
    return;
  }
  if (now - lastSent < GAP_MS) return;
  if (!volumeSet) {
    sendCommand(CMD_VOLUME, ALARM_VOLUME);
    volumeSet = true;
    return;
  }
  Track want = wanted();
  if (want == playing && (want == NONE || now - startedAt < LOOP_MS)) return;
  if (want != NONE) {
    sendCommand(CMD_PLAY_MP3, want);
    beepOwed = false;  // any sound shows the speaker is wired
  } else if (playing != BEEP) {
    sendCommand(CMD_STOP, 0);  // the beep stops on its own
  }
  playing = want;
  startedAt = now;
}

bool cardSeen() { return card; }

}  // namespace speaker
