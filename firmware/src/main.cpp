// The Sentinel: reads the Probes, decides its own Alerts, sounds the Alarm by itself, and streams
// a telemetry snapshot per cycle to the Command Post over MQTTS. Contract: docs/ARCHITECTURE.md.
#include <Arduino.h>
#include <ArduinoJson.h>

#include "alerts.h"
#include "config.h"
#include "probes.h"
#include "speaker.h"
#include "uplink.h"

namespace {

char telemetryTopic[64], alertTopic[64];
Readings readings;
uint32_t lastCycle = 0;

// Alert transitions wait here while the broker is out of reach; when full, the oldest goes.
struct Pending {
  AlertEvent event;
  char ts[24];  // when it happened; empty if the time was not known yet
};
constexpr size_t QUEUE_SIZE = 16;
Pending queue[QUEUE_SIZE];
size_t queued = 0;

double rounded(float value, int decimals) {
  double scale = pow(10, decimals);
  return round(value * scale) / scale;
}

void enqueue(const AlertEvent &event) {
  Serial.printf("[alert] %s %s %s (%s)\n", event.kind, event.raised ? "raised" : "cleared",
                severityName(event.severity), event.alertId);
  if (queued == QUEUE_SIZE) {
    memmove(queue, queue + 1, sizeof(Pending) * (QUEUE_SIZE - 1));
    queued--;
  }
  Pending &pending = queue[queued++];
  pending.event = event;
  if (!uplink::isoNow(pending.ts, sizeof pending.ts)) pending.ts[0] = '\0';
}

bool publishAlert(const Pending &pending) {
  const AlertEvent &event = pending.event;
  JsonDocument doc;
  doc["alert_id"] = event.alertId;
  doc["kind"] = event.kind;
  doc["severity"] = severityName(event.severity);
  doc["state"] = event.raised ? "raised" : "cleared";
  if (!isnan(event.value)) doc["value"] = rounded(event.value, 2);
  doc["detail"].to<JsonObject>();
  char now[24];
  if (pending.ts[0]) doc["ts"] = pending.ts;
  else if (uplink::isoNow(now, sizeof now)) doc["ts"] = now;
  else return false;
  char payload[256];
  serializeJson(doc, payload);
  return uplink::publish(alertTopic, payload);
}

void flushAlerts() {
  size_t sent = 0;
  while (sent < queued && publishAlert(queue[sent])) sent++;
  memmove(queue, queue + sent, sizeof(Pending) * (queued - sent));
  queued -= sent;
}

void publishTelemetry() {
  char ts[24];
  // The contract wants every reading and a real time: wait for the DHT22 and for the Pi's clock.
  if (isnan(readings.temp) || !uplink::isoNow(ts, sizeof ts)) return;
  JsonDocument doc;
  doc["ts"] = ts;
  JsonObject r = doc["readings"].to<JsonObject>();
  r["temp"] = rounded(readings.temp, 1);
  r["humidity"] = rounded(readings.humidity, 1);
  r["air"] = readings.air;
  r["pir"] = readings.pir;
  r["sound"] = rounded(readings.sound, 2);
  char payload[256];
  serializeJson(doc, payload);
  uplink::publish(telemetryTopic, payload);
}

void onCommand(const char *payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println("[command] not JSON, ignored");
    return;
  }
  const char *actuator = doc["actuator"] | "";
  const char *action = doc["action"] | "";
  Serial.printf("[command] %s %s\n", actuator, action);
  // The contract still calls the Alarm `buzzer`: it is the speaker now.
  if (strcmp(actuator, "buzzer") == 0) speaker::command(action);
}

// After a reconnection, the api may have missed transitions: it gets every raised Alert again.
void onBrokerConnect() {
  alerts::reemitActive(enqueue);
  flushAlerts();
}

void cycle(uint32_t now) {
  probes::read(readings);
  alerts::evaluate(readings, now, enqueue);
  speaker::setLocal(alerts::critical());
  if (uplink::brokerUp()) {
    flushAlerts();
    publishTelemetry();
  }
  Serial.printf("T=%.1f H=%.0f air=%d pir=%d son=%.2f | mp3=%d wifi=%d heure=%d broker=%d %s\n", readings.temp,
                readings.humidity, readings.air, readings.pir, readings.sound, speaker::cardSeen(), uplink::wifiUp(),
                uplink::timeKnown(), uplink::brokerUp(), uplink::problem());
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.printf("\n[sentinel] %s booting\n", SENTINEL_ID);
  snprintf(telemetryTopic, sizeof telemetryTopic, "sentinel/%s/telemetry", SENTINEL_ID);
  snprintf(alertTopic, sizeof alertTopic, "sentinel/%s/alert", SENTINEL_ID);

  speaker::begin();
  probes::begin();
  alerts::begin();
  uplink::begin(onCommand, onBrokerConnect);
}

void loop() {
  uint32_t now = millis();
  uplink::update(now);
  speaker::update(now);
  if (now - lastCycle >= CYCLE_MS) {
    lastCycle = now;
    cycle(now);
  }
}
