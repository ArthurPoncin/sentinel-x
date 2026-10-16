#include "ota.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "secrets.h"

// infra/plug-and-play.sh builds with -DFIRMWARE_VERSION: a hash of the sources and of secrets.h.
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "dev"
#endif

namespace {

char wanted[41] = "";
char wantedMd5[33] = "";
char error[64] = "";
// The command is retained, and comes again at each connection: a download that keeps failing is
// tried this many times, then left until the next boot, rather than every few seconds.
constexpr int MAX_ATTEMPTS = 3;
int attempts = 0;

bool isMd5(const char *text) {
  if (strlen(text) != 32) return false;
  for (const char *c = text; *c; c++) {
    if (!isxdigit(static_cast<unsigned char>(*c))) return false;
  }
  return true;
}

void fail(const char *why) {
  snprintf(error, sizeof error, "%s", why);
  Serial.printf("[ota] failed: %s\n", why);
  wanted[0] = '\0';
}

}  // namespace

namespace ota {

const char *version() { return FIRMWARE_VERSION; }
const char *lastError() { return error; }
bool pending() { return wanted[0] != '\0'; }

void command(const char *payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println("[ota] not JSON, ignored");
    return;
  }
  const char *version = doc["version"] | "";
  const char *md5 = doc["md5"] | "";
  if (!*version || strlen(version) >= sizeof wanted || !isMd5(md5)) {
    Serial.println("[ota] no version or no md5, ignored");
    return;
  }
  if (strcmp(version, FIRMWARE_VERSION) == 0) return;
  if (attempts >= MAX_ATTEMPTS) {
    Serial.printf("[ota] %s failed %d times, left until the next boot\n", version, attempts);
    return;
  }
  snprintf(wanted, sizeof wanted, "%s", version);
  snprintf(wantedMd5, sizeof wantedMd5, "%s", md5);
  error[0] = '\0';
  Serial.printf("[ota] %s -> %s asked\n", FIRMWARE_VERSION, wanted);
}

void run() {
  // From the Pi alone, whatever the command said: the address and the CA are those of this build.
  char url[96];
  snprintf(url, sizeof url, "https://%s/firmware/%s.bin", BROKER_HOST, SENTINEL_ID);
  Serial.printf("[ota] downloading %s\n", url);
  attempts++;

  WiFiClientSecure tls;
  tls.setCACert(CA_CERT);
  tls.setHandshakeTimeout(15);
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(tls, url)) return fail("HTTPS: adresse");
  http.addHeader("Authorization", String("Bearer ") + FIRMWARE_TOKEN);
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    char why[48];
    snprintf(why, sizeof why, "HTTPS: %d", code);
    http.end();
    return fail(why);
  }
  int size = http.getSize();
  if (size <= 0 || !Update.begin(size)) {
    http.end();
    return fail("pas de place pour le firmware");
  }
  Update.setMD5(wantedMd5);
  size_t written = Update.writeStream(*http.getStreamPtr());
  http.end();
  // end() checks the MD5 and that the image is one the bootloader can start.
  if (written != static_cast<size_t>(size) || !Update.end()) {
    Update.abort();
    char why[64];
    snprintf(why, sizeof why, "ecriture: %s", Update.errorString());
    return fail(why);
  }
  Serial.printf("[ota] %s written, restarting\n", wanted);
  delay(200);
  ESP.restart();
}

}  // namespace ota
