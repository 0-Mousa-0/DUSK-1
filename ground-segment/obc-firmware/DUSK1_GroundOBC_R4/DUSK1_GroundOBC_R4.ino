/* =============================================================================
   DUSK-1 · Ground OBC (decoder) on the Arduino UNO R4 WiFi
   Team Dusk · فريق الغسق · Tuwaiq Academy Space Science Bootcamp · CanSat 2026
   =============================================================================

   JOB
     antenna -> Holybro SiK ground radio -> THIS BOARD -> Wi-Fi -> team laptops
     * reads every line the CanSat sends (57600 baud from the ground radio)
     * checks the packets: lost lines (pkt gaps), damaged picture pieces
     * shares everything over its own Wi-Fi network with up to 3 laptops
       (TCP port 5760) and over USB, unchanged, so the laptop backend
       (dusk1_backend.py) saves telemetry and rebuilds the pictures
     * passes commands from the laptops up to the CanSat
     * adds its own status line every 5 s:  DUSK1-GS:> status | up 125 | ...
     * LED matrix: tick = LIVE, X = no data, moving dots = waiting,
       top-right dot = each telemetry line, bottom row = picture progress

   WIRING  (4 jumper wires, no extra parts)
     radio GND -> R4 GND
     radio TX  -> R4 D0 (RX)    the CanSat's lines come in
     radio RX  <- R4 D1 (TX)    commands go up
     radio 5V  -> R4 5V
     radio RTS, CTS -> not connected
     Power the R4 by its USB-C cable from a laptop or a power bank.
     * D1 sends 5 V into the radio's RX: fine, the radio's Si1000-family chip
       accepts 5 V on its inputs.
     * D0 receives the radio's 3.3 V: real R4 boards switch at about 3.0-3.2 V,
       so it works with a small margin. Check it once: Serial Monitor shows
       clean lines and "bad_pieces" stays 0 for 5 minutes. If not, add a
       3.3 V <-> 5 V level shifter on that wire, or plug the ground radio
       straight into a laptop by USB (start_ground_station.bat -> 3).

   ARDUINO IDE
     Boards Manager: install "Arduino UNO R4 Boards"
     Board    : "Arduino UNO R4 WiFi"       Libraries: none (all built in)
     Upload   : plug in by USB-C, select its port, Upload.
     Monitor  : 115200 baud - you see the same stream the laptops get.

   LAPTOPS
     Join Wi-Fi  DUSK1-GROUND  (password dusk2026), then run
       python dusk1_backend.py --tcp 192.168.4.1:5760
     and open  http://localhost:8080
     More than 3 laptops: run one backend with --host 0.0.0.0 and let the
     others open http://<that laptop's IP>:8080
   ============================================================================= */

#include <WiFiS3.h>
#include "Arduino_LED_Matrix.h"

#if !defined(ARDUINO_UNOWIFIR4) && !defined(ARDUINO_UNOR4_WIFI)
#error "WRONG BOARD: choose  Arduino UNO R4 WiFi  in the board box"
#endif

// ------------------------------ SETTINGS -------------------------------------
#define RADIO           Serial1    // D0 = RX, D1 = TX (through the level shifter)
#define RADIO_BAUD      57600      // = SiK SERIAL_SPEED (factory 57600)
#define USB_BAUD        115200
#define WIFI_AP_SSID    "DUSK1-GROUND"
#define WIFI_AP_PASS    "dusk2026" // 8 characters or more
#define WIFI_JOIN_SSID  ""         // fill in to join an existing Wi-Fi instead
#define WIFI_JOIN_PASS  ""
#define TCP_PORT        5760
#define MAX_CLIENTS     3          // the R4's Wi-Fi link carries about 3 streams
#define OUT_BUF         2048       // bytes waiting per laptop
#define WRITE_CHUNK     512        // bytes per Wi-Fi write (keeps the radio buffer safe)
#define STATUS_MS       5000
#define STALE_MS        5000       // no telemetry for 5 s = NO DATA

// =============================== STATE ========================================
ArduinoLEDMatrix matrix;
WiFiServer server(TCP_PORT);

struct Laptop {
  WiFiClient c;
  bool used = false;
  char out[OUT_BUF];
  uint16_t len = 0;
  char in[160];
  uint8_t inLen = 0;
  uint32_t dropped = 0;
  IPAddress ip;
};
static Laptop lap[MAX_CLIENTS];

static char lineBuf[1100];
static uint16_t lineLen = 0;
static char usbBuf[160];
static uint8_t usbLen = 0;

static uint32_t lastTeleMs = 0, lastLineMs = 0, linesRx = 0, teleRx = 0, lost = 0, badPieces = 0;
static long lastPkt = -1;
static uint32_t imgId = 0, imgGot = 0, imgTotal = 0, imgDone = 0;
static bool imgActive = false;
static uint32_t blinkUntil = 0;
static bool apMode = true, wifiOk = false;
static char ipText[20] = "-";

// =============================== RADIO INPUT ==================================
static void handleLine(char* s, size_t n);

// Reads everything the radio has sent so far. Called often: the R4 only
// buffers 512 bytes of serial input.
static void pump() {
  while (RADIO.available()) {
    char c = (char)RADIO.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (lineLen) { lineBuf[lineLen] = 0; handleLine(lineBuf, lineLen); lineLen = 0; }
    } else if (lineLen < sizeof(lineBuf) - 1) {
      lineBuf[lineLen++] = c;
    } else {                                       // over-long line (noise): pass it on
      lineBuf[lineLen] = 0; handleLine(lineBuf, lineLen); lineLen = 0;
    }
  }
}

// =============================== OUTPUT =======================================
static int laptopCount() {
  int n = 0;
  for (int i = 0; i < MAX_CLIENTS; i++) if (lap[i].used) n++;
  return n;
}

// Queues one line for every laptop and sends it to USB straight away.
static void broadcast(const char* s, size_t n) {
  if (Serial) { Serial.write((const uint8_t*)s, n); Serial.write('\n'); }
  for (int i = 0; i < MAX_CLIENTS; i++) {
    Laptop& L = lap[i];
    if (!L.used) continue;
    if (L.len + n + 1 > OUT_BUF) { L.dropped++; continue; }   // laptop too slow: drop line
    memcpy(L.out + L.len, s, n);
    L.len += n;
    L.out[L.len++] = '\n';
  }
}

static void gsLine(const char* fmt, ...) {
  char b[220];
  int p = snprintf(b, sizeof(b), "DUSK1-GS:> ");
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(b + p, sizeof(b) - p, fmt, ap);
  va_end(ap);
  broadcast(b, strlen(b));
}

// Sends queued data to the laptops, one small piece each, reading the radio in between.
static void flushLaptops() {
  for (int i = 0; i < MAX_CLIENTS; i++) {
    Laptop& L = lap[i];
    if (!L.used || L.len == 0) continue;
    uint16_t k = L.len > WRITE_CHUNK ? WRITE_CHUNK : L.len;
    size_t w = L.c.write((const uint8_t*)L.out, k);
    pump();
    if (w == 0) {                                  // write failed: laptop has gone
      L.c.stop(); L.used = false; L.len = 0;
      gsLine("laptop left | %d connected", laptopCount());
      continue;
    }
    memmove(L.out, L.out + k, L.len - k);
    L.len -= k;
  }
}

// =============================== DECODER ======================================
static char tT[10] = "--", tRH[10] = "--", tA[10] = "--", tPkt[10] = "--";

static void copyField(char* dst, size_t cap, const char* v) {
  size_t i = 0;
  while (v[i] && v[i] != ' ' && i < cap - 1) { dst[i] = v[i]; i++; }
  dst[i] = 0;
}

static void parseTelemetry(const char* body) {   // body starts at "pkt "
  char tmp[400];
  strncpy(tmp, body, sizeof(tmp) - 1);
  tmp[sizeof(tmp) - 1] = 0;
  // fields are separated by " | " (the name "|a|" itself contains '|')
  for (char* part = tmp; part; ) {
    char* next = strstr(part, " | ");
    if (next) { *next = 0; next += 3; }
    char* sp = strchr(part, ' ');
    if (sp) {
      *sp = 0;
      const char* v = sp + 1;
      if      (!strcmp(part, "pkt")) copyField(tPkt, sizeof(tPkt), v);
      else if (!strcmp(part, "T"))   copyField(tT, sizeof(tT), v);
      else if (!strcmp(part, "RH"))  copyField(tRH, sizeof(tRH), v);
      else if (!strcmp(part, "|a|")) copyField(tA, sizeof(tA), v);
    }
    part = next;
  }
  long p = atol(tPkt);
  if (lastPkt >= 0 && p > lastPkt + 1) {
    lost += p - lastPkt - 1;
    gsLine("lost | %ld line(s) before pkt %ld", p - lastPkt - 1, p);
  }
  lastPkt = p;
  lastTeleMs = millis();
  teleRx++;
  blinkUntil = millis() + 120;
}

static void handleLine(char* s, size_t n) {
  linesRx++;
  lastLineMs = millis();
  broadcast(s, n);                               // laptops get every line, unchanged

  if (!strncmp(s, "Dusk1-img:> ", 12)) {         // picture piece: check it
    char* star = strrchr(s, '*');
    unsigned long id = 0, seq = 0;
    if (star && sscanf(s + 12, "%lu %lu", &id, &seq) == 2) {
      uint8_t x = 0;
      for (char* q = s; q < star; q++) x ^= (uint8_t)*q;
      if ((uint8_t)strtoul(star + 1, nullptr, 16) == x) { if (id == imgId) imgGot++; }
      else badPieces++;
    }
    return;
  }
  if (strncmp(s, "Dusk1-", 6) != 0) return;
  char* body = strstr(s, ":> ");
  if (!body) return;
  body += 3;
  if (!strncmp(body, "pkt ", 4)) { parseTelemetry(body); return; }
  unsigned long id, w, h, bytes, chunks;
  if (sscanf(body, "img %lu start | %lux%lu | %lu bytes | %lu chunks", &id, &w, &h, &bytes, &chunks) == 5) {
    imgId = id; imgTotal = chunks; imgGot = 0; imgActive = true;
    return;
  }
  if (sscanf(body, "img %lu end", &id) == 1) {
    imgActive = false;
    if (id == imgId && imgGot == imgTotal) imgDone++;
    return;
  }
  if (!strncmp(body, "boot", 4)) lastPkt = -1;
}

// =============================== LAPTOP INPUT =================================
// A command from a laptop: send it up to the CanSat and tell every laptop.
static void uplink(const char* cmd, const char* from) {
  RADIO.print(cmd);
  RADIO.print('\n');
  gsLine("uplink | %s | from %s", cmd, from);
}

static void acceptLaptops() {
  WiFiClient nc = server.accept();
  pump();
  if (!nc) return;
  for (int i = 0; i < MAX_CLIENTS; i++) {
    if (!lap[i].used) {
      lap[i].c = nc; lap[i].used = true; lap[i].len = 0; lap[i].inLen = 0; lap[i].dropped = 0;
      lap[i].ip = nc.remoteIP();
      gsLine("laptop connected | %d.%d.%d.%d | %d connected", lap[i].ip[0], lap[i].ip[1], lap[i].ip[2],
             lap[i].ip[3], laptopCount());
      return;
    }
  }
  nc.print("DUSK1-GS:> busy | 3 laptops already connected\n");
  nc.stop();
}

static void readLaptops() {
  for (int i = 0; i < MAX_CLIENTS; i++) {
    Laptop& L = lap[i];
    if (!L.used) continue;
    int n = L.c.available();
    pump();
    while (n-- > 0) {
      int c = L.c.read();
      if (c < 0) break;
      if (c == '\r') continue;
      if (c == '\n') {
        if (L.inLen) {
          L.in[L.inLen] = 0;
          char from[20];
          snprintf(from, sizeof(from), "%d.%d.%d.%d", L.ip[0], L.ip[1], L.ip[2], L.ip[3]);
          uplink(L.in, from);
          L.inLen = 0;
        }
      } else if (L.inLen < sizeof(L.in) - 1) {
        L.in[L.inLen++] = (char)c;
      }
    }
  }
}

static void checkLaptopsAlive() {
  for (int i = 0; i < MAX_CLIENTS; i++) {
    if (!lap[i].used) continue;
    bool alive = lap[i].c.connected();
    pump();
    if (!alive) {
      lap[i].c.stop(); lap[i].used = false; lap[i].len = 0;
      gsLine("laptop left | %d connected", laptopCount());
    }
  }
}

static void readUsb() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { if (usbLen) { usbBuf[usbLen] = 0; uplink(usbBuf, "USB"); usbLen = 0; } }
    else if (usbLen < sizeof(usbBuf) - 1) usbBuf[usbLen++] = c;
  }
}

// =============================== LED MATRIX ===================================
static const uint8_t ICON_TICK[7][12] = {
  {0,0,0,0,0,0,0,0,0,0,0,0},
  {0,0,0,0,0,0,0,0,0,1,0,0},
  {0,0,0,0,0,0,0,0,1,0,0,0},
  {0,0,1,0,0,0,0,1,0,0,0,0},
  {0,0,0,1,0,0,1,0,0,0,0,0},
  {0,0,0,0,1,1,0,0,0,0,0,0},
  {0,0,0,0,0,0,0,0,0,0,0,0}};
static const uint8_t ICON_X[7][12] = {
  {0,0,0,0,0,0,0,0,0,0,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,0,0,1,0,0,1,0,0,0,0},
  {0,0,0,0,0,1,1,0,0,0,0,0},
  {0,0,0,0,1,0,0,1,0,0,0,0},
  {0,0,0,1,0,0,0,0,1,0,0,0},
  {0,0,0,0,0,0,0,0,0,0,0,0}};

static void drawMatrix() {
  static uint8_t f[8][12];
  uint32_t now = millis();
  memset(f, 0, sizeof(f));
  bool live = lastTeleMs && (now - lastTeleMs) < STALE_MS;
  if (live) memcpy(f, ICON_TICK, sizeof(ICON_TICK));
  else if (lastLineMs) memcpy(f, ICON_X, sizeof(ICON_X));
  else {                                          // waiting: three dots moving
    int step = (now / 300) % 4;
    for (int d = 0; d < step && d < 3; d++) { f[3][3 + 3 * d] = 1; f[4][3 + 3 * d] = 1; }
  }
  if (now < blinkUntil) f[0][11] = 1;             // each telemetry line
  int bar = imgActive && imgTotal ? (int)(imgGot * 12 / imgTotal) : 0;
  for (int c = 0; c < bar; c++) f[7][c] = 1;      // picture progress
  if (!wifiOk) f[0][0] = (now / 250) % 2;         // Wi-Fi not up yet: blink corner
  matrix.renderBitmap(f, 8, 12);
  digitalWrite(LED_BUILTIN, now < blinkUntil ? HIGH : LOW);
}

// =============================== WI-FI ========================================
static void startWifi() {
  if (WiFi.status() == WL_NO_MODULE) { wifiOk = false; return; }
  if (strlen(WIFI_JOIN_SSID)) {
    apMode = false;
    uint32_t t0 = millis();
    WiFi.begin(WIFI_JOIN_SSID, WIFI_JOIN_PASS);
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) { pump(); delay(100); }
    if (WiFi.status() != WL_CONNECTED) apMode = true;
  }
  if (apMode) {
    WiFi.config(IPAddress(192, 168, 4, 1));
    WiFi.beginAP(WIFI_AP_SSID, WIFI_AP_PASS);
  }
  delay(500);
  IPAddress ip = WiFi.localIP();
  snprintf(ipText, sizeof(ipText), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
  server.begin();
  wifiOk = true;
}

// =============================== SETUP / LOOP =================================
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(USB_BAUD);
  RADIO.begin(RADIO_BAUD);
  matrix.begin();
  drawMatrix();
  startWifi();
  gsLine("start | board UNO R4 WiFi | wifi %s %s | ip %s | tcp %d | radio %d baud", apMode ? "AP" : "joined",
         apMode ? WIFI_AP_SSID : WIFI_JOIN_SSID, ipText, TCP_PORT, RADIO_BAUD);
  if (!wifiOk) gsLine("error | Wi-Fi module not answering - laptops can still use USB");
}

void loop() {
  static uint32_t tFlush = 0, tAccept = 0, tRead = 0, tAlive = 0, tLed = 0, tStatus = 0;
  uint32_t now = millis();
  pump();
  readUsb();
  if (wifiOk) {
    if (now - tFlush >= 40)    { tFlush = now;  flushLaptops(); }
    if (now - tAccept >= 500)  { tAccept = now; acceptLaptops(); }
    if (now - tRead >= 250)    { tRead = now;   readLaptops(); }
    if (now - tAlive >= 3000)  { tAlive = now;  checkLaptopsAlive(); }
  }
  if (now - tLed >= 100) { tLed = now; drawMatrix(); }
  if (now - tStatus >= STATUS_MS) {
    tStatus = now;
    uint32_t drops = 0;
    for (int i = 0; i < MAX_CLIENTS; i++) drops += lap[i].dropped;
    gsLine("status | up %lu | wifi %s | ip %s | laptops %d | lines %lu | telemetry %lu | lost %lu | bad_pieces %lu | pictures %lu | wifi_drops %lu",
           (unsigned long)(now / 1000), apMode ? WIFI_AP_SSID : WIFI_JOIN_SSID, ipText, laptopCount(),
           (unsigned long)linesRx, (unsigned long)teleRx, (unsigned long)lost, (unsigned long)badPieces,
           (unsigned long)imgDone, (unsigned long)drops);
  }
}
