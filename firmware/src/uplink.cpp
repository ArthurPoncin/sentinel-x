#include "uplink.h"

#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "config.h"
#include "secrets.h"

namespace {

constexpr uint32_t RETRY_MS = 5000;

WiFiClientSecure tls;
PubSubClient mqtt(tls);
uplink::OnCommand commandHandler;
uplink::OnConnect connectHandler;
char commandTopic[64];
bool clockStarted = false;
uint32_t lastAttempt = 0;
const char *why = "Wi-Fi...";

void onMessage(char *, uint8_t *payload, unsigned int length) {
  commandHandler(reinterpret_cast<const char *>(payload), length);
}

// What PubSubClient's state means, to fix it from the LCD.
const char *explain(int state) {
  switch (state) {
    case MQTT_CONNECT_BAD_CREDENTIALS:
    case MQTT_CONNECT_UNAUTHORIZED: return "MQTT: mot de passe";
    case MQTT_CONNECTION_TIMEOUT: return "MQTT: pas de reponse";
    default: return "MQTT: TLS/reseau";
  }
}

void connectBroker() {
  Serial.printf("[uplink] MQTTS %s:%d as %s\n", BROKER_HOST, BROKER_PORT, MQTT_USER);
  if (mqtt.connect(SENTINEL_ID, MQTT_USER, MQTT_PASSWORD)) {
    why = "";
    mqtt.subscribe(commandTopic, 1);
    Serial.println("[uplink] broker connected");
    connectHandler();
    return;
  }
  char tlsError[96] = "";
  tls.lastError(tlsError, sizeof tlsError);
  Serial.printf("[uplink] broker refused: state %d, TLS: %s\n", mqtt.state(), tlsError);
  why = explain(mqtt.state());
}

}  // namespace

namespace uplink {

void begin(OnCommand onCommand, OnConnect onConnect) {
  commandHandler = onCommand;
  connectHandler = onConnect;
  snprintf(commandTopic, sizeof commandTopic, "command/%s/actuator", SENTINEL_ID);

  // Before mode(): the name is applied when the station starts. The Pi's DHCP gives sentinel-01
  // its reserved address by this name.
  WiFi.setHostname(SENTINEL_ID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSPHRASE);
  Serial.printf("[uplink] Wi-Fi %s, MAC %s\n", WIFI_SSID, WiFi.macAddress().c_str());

  tls.setCACert(CA_CERT);  // never setInsecure(): the broker must prove it is ours
  tls.setHandshakeTimeout(15);
  mqtt.setServer(BROKER_HOST, BROKER_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(15);
}

void update(uint32_t now) {
  if (!wifiUp()) {
    why = "Wi-Fi...";
    return;
  }
  if (!clockStarted) {
    configTime(0, 0, NTP_SERVER);
    clockStarted = true;
  }
  if (mqtt.connected()) {
    mqtt.loop();
    return;
  }
  if (lastAttempt && now - lastAttempt < RETRY_MS) return;
  lastAttempt = now;
  connectBroker();
}

bool publish(const char *topic, const char *payload) { return mqtt.connected() && mqtt.publish(topic, payload); }

bool wifiUp() { return WiFi.status() == WL_CONNECTED; }
bool timeKnown() { return time(nullptr) > 1700000000; }
bool brokerUp() { return mqtt.connected(); }
String ip() { return wifiUp() ? WiFi.localIP().toString() : String("-"); }
const char *problem() { return mqtt.connected() ? "" : why; }

bool isoNow(char *out, size_t size) {
  if (!timeKnown()) return false;
  time_t now = time(nullptr);
  struct tm utc;
  gmtime_r(&now, &utc);
  strftime(out, size, "%Y-%m-%dT%H:%M:%SZ", &utc);
  return true;
}

}  // namespace uplink
