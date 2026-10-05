#include "probes.h"

#include <DHT.h>
#include <esp_timer.h>

#include "config.h"
#include "pins.h"

namespace {

DHT dht(PIN_DHT, DHT22);

// The CZN-15E only says "above its threshold" or not, and chatters with the sound wave while it
// is. Its idle level is read at boot, so the active one is whichever it is not.
int soundActiveLevel = LOW;
volatile bool heard = false;
uint32_t loudWindows = 0, windows = 0;
portMUX_TYPE soundMux = portMUX_INITIALIZER_UNLOCKED;
esp_timer_handle_t windowTimer;

void IRAM_ATTR onSoundEdge() { heard = true; }

// Every SOUND_WINDOW_MS, from the esp_timer task: whatever the main loop is busy with.
void onWindow(void *) {
  bool loud = heard || digitalRead(PIN_SOUND) == soundActiveLevel;
  heard = false;
  portENTER_CRITICAL(&soundMux);
  windows++;
  if (loud) loudWindows++;
  portEXIT_CRITICAL(&soundMux);
}

int idleLevelOf(int pin) {
  int high = 0;
  for (int i = 0; i < 200; i++) {
    high += digitalRead(pin);
    delay(2);
  }
  return high > 100 ? HIGH : LOW;
}

int readAir() {
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(PIN_MQ2_AO);
  return sum / 16;
}

float takeSoundShare() {
  portENTER_CRITICAL(&soundMux);
  float share = windows ? float(loudWindows) / windows : 0;
  loudWindows = windows = 0;
  portEXIT_CRITICAL(&soundMux);
  return share;
}

}  // namespace

namespace probes {

void begin() {
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_SOUND, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_MQ2_AO, ADC_11db);  // 0–3.3 V range
  dht.begin();

  soundActiveLevel = idleLevelOf(PIN_SOUND) == HIGH ? LOW : HIGH;
  Serial.printf("[probes] sound sensor active %s\n", soundActiveLevel == LOW ? "LOW" : "HIGH");
  attachInterrupt(digitalPinToInterrupt(PIN_SOUND), onSoundEdge, soundActiveLevel == LOW ? FALLING : RISING);

  esp_timer_create_args_t args = {};
  args.callback = onWindow;
  args.name = "sound-window";
  esp_timer_create(&args, &windowTimer);
  esp_timer_start_periodic(windowTimer, SOUND_WINDOW_MS * 1000);
}

void read(Readings &readings) {
  float temp = dht.readTemperature();
  float humidity = dht.readHumidity();
  if (!isnan(temp) && !isnan(humidity)) {
    readings.temp = temp;
    readings.humidity = humidity;
  }
  readings.air = readAir();
  readings.pir = digitalRead(PIN_PIR) == HIGH;
  readings.sound = takeSoundShare();
}

}  // namespace probes
