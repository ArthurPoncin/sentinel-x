#include "alerts.h"

#include "config.h"

const char *severityName(Severity severity) {
  switch (severity) {
    case Severity::Info: return "info";
    case Severity::Warning: return "warning";
    case Severity::Critical: return "critical";
    default: return "none";
  }
}

namespace {

struct Tracker {
  explicit Tracker(const char *kind) : kind(kind) {}
  const char *kind;
  Severity severity = Severity::None;
  char alertId[32] = "";
  float value = NAN;
  uint32_t calmSince = 0;  // presence and noise: when the reading last went calm
};

Tracker gas{"gas"}, thermal{"thermal"}, presence{"presence"}, noise{"noise"};
Tracker *const trackers[] = {&gas, &thermal, &presence, &noise};

// Tells this boot's alert_ids from the previous ones'.
char bootTag[5];
uint32_t serial = 0;

// The level of a reading against a warning and a critical threshold, with hysteresis: a level
// is kept until the reading drops below its threshold minus `hysteresis`.
template <typename T>
Severity levelOf(T value, T warning, T critical, T hysteresis, Severity current) {
  if (value >= critical || (current == Severity::Critical && value > critical - hysteresis)) return Severity::Critical;
  if (value >= warning || (current >= Severity::Warning && value > warning - hysteresis)) return Severity::Warning;
  return Severity::None;
}

void move(Tracker &tracker, Severity next, float value, alerts::Emit emit) {
  if (next == tracker.severity) return;
  AlertEvent event{tracker.kind, "", next, next != Severity::None, value};
  if (tracker.severity == Severity::None) {
    snprintf(tracker.alertId, sizeof tracker.alertId, "%s-%s-%lu", tracker.kind, bootTag, (unsigned long)++serial);
  }
  if (!event.raised) event.severity = tracker.severity;
  strlcpy(event.alertId, tracker.alertId, sizeof event.alertId);
  tracker.severity = next;
  tracker.value = value;
  emit(event);
}

}  // namespace

namespace alerts {

void begin() { snprintf(bootTag, sizeof bootTag, "%04lx", (unsigned long)(esp_random() & 0xffff)); }

void evaluate(const Readings &r, uint32_t now, Emit emit) {
  if (now >= GAS_WARMUP_MS) {
    move(gas, levelOf(r.air, GAS_WARNING, GAS_CRITICAL, GAS_HYSTERESIS, gas.severity), r.air, emit);
  }

  if (!isnan(r.temp)) {
    move(thermal, levelOf(r.temp, THERMAL_WARNING, THERMAL_CRITICAL, THERMAL_HYSTERESIS, thermal.severity), r.temp, emit);
  }

  if (now >= PIR_WARMUP_MS) {
    if (r.pir) {
      presence.calmSince = now;
      move(presence, Severity::Warning, NAN, emit);
    } else if (now - presence.calmSince >= PRESENCE_HOLD_MS) {
      move(presence, Severity::None, NAN, emit);
    }
  }

  if (r.sound >= NOISE_RAISE) {
    noise.calmSince = now;
    move(noise, Severity::Info, r.sound, emit);
  } else if (r.sound >= NOISE_QUIET) {
    noise.calmSince = now;
  } else if (now - noise.calmSince >= NOISE_HOLD_MS) {
    move(noise, Severity::None, r.sound, emit);
  }
}

void reemitActive(Emit emit) {
  for (Tracker *tracker : trackers) {
    if (tracker->severity == Severity::None) continue;
    AlertEvent event{tracker->kind, "", tracker->severity, true, tracker->value};
    strlcpy(event.alertId, tracker->alertId, sizeof event.alertId);
    emit(event);
  }
}

bool critical() { return worst() == Severity::Critical; }

Severity worst() {
  Severity worst = Severity::None;
  for (Tracker *tracker : trackers) worst = max(worst, tracker->severity);
  return worst;
}

}  // namespace alerts
