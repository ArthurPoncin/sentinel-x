#include "display.h"

#include <Adafruit_ST7735.h>

#include "config.h"
#include "pins.h"
#include "uplink.h"

namespace {

// 160×128 in landscape, 6×8 px characters: 26 columns.
Adafruit_ST7735 tft(PIN_TFT_CS, PIN_TFT_DC, PIN_TFT_RST);
constexpr int COLUMNS = 26;
Severity shownStatus = Severity::Critical;  // forces the first header

// Writes a whole line, padded, over the previous one: no flicker, no leftovers.
void line(int y, uint16_t color, const char *format, ...) {
  char text[COLUMNS + 1];
  va_list args;
  va_start(args, format);
  vsnprintf(text, sizeof text, format, args);
  va_end(args);
  tft.setCursor(2, y);
  tft.setTextColor(color, ST77XX_BLACK);
  tft.printf("%-*s", COLUMNS, text);
}

void header(Severity worst) {
  if (worst == shownStatus) return;
  shownStatus = worst;
  uint16_t color = worst == Severity::Critical ? ST77XX_RED : worst >= Severity::Warning ? ST77XX_ORANGE : 0x0400;
  const char *status = worst == Severity::Critical ? "CRITIQUE" : worst >= Severity::Warning ? "ALERTE" : "NOMINAL";
  tft.fillRect(0, 0, 160, 16, color);
  tft.setTextColor(ST77XX_WHITE);
  tft.setCursor(4, 4);
  tft.print(SENTINEL_ID);
  tft.setCursor(156 - 6 * strlen(status), 4);
  tft.print(status);
}

}  // namespace

namespace display {

void begin() {
  tft.initR(INITR_BLACKTAB);  // colors or edges wrong: try INITR_GREENTAB
  tft.setRotation(1);
  tft.fillScreen(ST77XX_BLACK);
  tft.setTextSize(1);
  tft.setTextWrap(false);
  header(Severity::None);
}

void show(const Readings &r, uint32_t now) {
  header(alerts::worst());

  line(22, uplink::wifiUp() ? ST77XX_WHITE : ST77XX_YELLOW, "Wi-Fi %s", uplink::wifiUp() ? uplink::ip().c_str() : "...");
  if (!uplink::brokerUp()) line(32, ST77XX_YELLOW, "%s", uplink::problem());
  else if (!uplink::timeKnown()) line(32, ST77XX_YELLOW, "Heure du Pi...");
  else line(32, ST77XX_GREEN, "Command Post OK");

  if (isnan(r.temp)) line(50, ST77XX_YELLOW, "Temp  DHT22 ?");
  else line(50, ST77XX_WHITE, "Temp  %.1f C   Hum %.0f %%", r.temp, r.humidity);
  line(62, ST77XX_WHITE, "Gaz   %d%s", r.air, now < GAS_WARMUP_MS ? "  (chauffe)" : "");
  line(74, ST77XX_WHITE, "PIR   %s%s", r.pir ? "presence" : "-", now < PIR_WARMUP_MS ? "  (chauffe)" : "");
  line(86, ST77XX_WHITE, "Son   %.2f", r.sound);

  char active[COLUMNS + 1];
  alerts::describe(active, sizeof active);
  line(108, active[0] ? ST77XX_RED : ST77XX_GREEN, "%s", active[0] ? active : "Aucune alerte");
}

}  // namespace display
