#include "probes.h"

#include <DHT.h>
#include <esp_adc_cal.h>
#include <esp_timer.h>

#include "config.h"
#include "pins.h"

namespace {

DHT dht(PIN_DHT, DHT22);

// The CZN-15E only says "above its threshold" or not, and chatters with the sound wave while it
// is. It is sampled every millisecond, not caught on an edge: the Wi-Fi's current draw puts
// glitches of a few microseconds on the wire, which an edge interrupt took for sound.
constexpr int SOUND_ACTIVE = SOUND_ACTIVE_LOW ? LOW : HIGH;
uint32_t samples = 0, heard = 0;    // this window's, on the esp_timer task only
uint32_t loudWindows = 0, windows = 0;
portMUX_TYPE soundMux = portMUX_INITIALIZER_UNLOCKED;
esp_timer_handle_t sampleTimer;

// Every millisecond, from the esp_timer task: whatever the main loop is busy with.
void onSample(void *) {
  if (digitalRead(PIN_SOUND) == SOUND_ACTIVE) heard++;
  if (++samples < SOUND_WINDOW_MS) return;
  portENTER_CRITICAL(&soundMux);
  windows++;
  if (heard >= SOUND_MIN_MS) loudWindows++;
  portEXIT_CRITICAL(&soundMux);
  samples = heard = 0;
}

// The share of 400 ms that `pin` spends at `level`.
float shareAt(int pin, int level) {
  int at = 0;
  for (int i = 0; i < 200; i++) {
    at += digitalRead(pin) == level;
    delay(2);
  }
  return at / 200.0f;
}

// The MQ-2 rests at a few hundred millivolts in clean air, at the bottom of the ADC: its 0–3.1 V
// range reads 0 under about 0.15 V. The 0–1 V range reaches down to about 75 mV, four times finer:
// the MQ-2 is read on it, and on the wide one only when it is above it.
esp_adc_cal_characteristics_t fineRange, wideRange;

uint32_t averageRaw(adc_attenuation_t attenuation) {
  analogSetPinAttenuation(PIN_MQ2_AO, attenuation);
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(PIN_MQ2_AO);
  return sum / 16;
}

int readAir() {
  uint32_t raw = averageRaw(ADC_0db);
  uint32_t mv = raw ? esp_adc_cal_raw_to_voltage(raw, &fineRange) : 0;
  if (mv > 900) mv = esp_adc_cal_raw_to_voltage(averageRaw(ADC_11db), &wideRange);
  return mv;
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
  esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_0, ADC_WIDTH_BIT_12, 1100, &fineRange);
  esp_adc_cal_characterize(ADC_UNIT_1, ADC_ATTEN_DB_11, ADC_WIDTH_BIT_12, 1100, &wideRange);
  dht.begin();

  // In a quiet room the module should not hear anything: set too sensitive, it hears all the time.
  if (shareAt(PIN_SOUND, SOUND_ACTIVE) > 0.5f) {
    Serial.println("[probes] the sound sensor hears sound all the time: turn its screw until its LED goes out in "
                   "silence. LED already out: set SOUND_ACTIVE_LOW to false in config.h");
  }

  esp_timer_create_args_t args = {};
  args.callback = onSample;
  args.name = "sound-sample";
  esp_timer_create(&args, &sampleTimer);
  esp_timer_start_periodic(sampleTimer, 1000);
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
