/* =============================================================================
   DUSK-1 · Telemetry + camera: MPU-6050 + DHT22 + OV2640 + Holybro SiK radio
   Team Dusk · فريق الغسق · Tuwaiq Academy Space Science Bootcamp · CanSat 2026
   =============================================================================

   WHAT IT DOES
     Start-up checks (PASS / WARN / FAIL), one "boot" status line, then:
     * one telemetry line every 1.000 s (MPU = average of 100 readings):
         Dusk1-2026-10-20 16:41:04:> pkt 37 | T 23.5 | RH 29.2 | ax +0.27 | ... | n 100 | err 0
     * a camera picture every 15 s, sent between telemetry lines in pieces:
         Dusk1-2026-10-20 16:41:05:> img 3 start | 320x240 | 7412 bytes | 39 chunks
         Dusk1-img:> 3 0 /9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAoHCAkIBgoJ...*5A
         ...
         Dusk1-2026-10-20 16:41:09:> img 3 end | 39 chunks
       The ground station script (dusk1_ground_station.py) rebuilds the JPEG.
     Everything leaves UART0 at 57600 baud: to the laptop (USB) AND the radio.

   GRAVITY CORRECTION (no key needed)
       1. a fix saved with key z / 6 (measured flat + upside down: the exact one)
       2. otherwise Z is zeroed at every start-up while the board is still
       3. otherwise the code value ACC_Z_OFFSET_DEFAULT (-0.320 g)

   POWER: laptop USB only (ESP32-CAM on the ESP32-CAM-MB base).
     Camera + 500 mW radio can be more than one laptop USB port gives. If the
     boot line says "brownout", set the radio to 100 mW (ATS4=20) and add a
     470 µF capacitor across the radio's 5V and GND.

   WIRING - use a breadboard rail for 3V3 / GND
     MPU-6050: VCC +rail, GND -rail, SCL IO15, SDA IO14
     DHT22   : pin1 +rail, pin2 DATA IO13 (10 kΩ to +rail), pin4 -rail
     Camera  : OV2640 ribbon in the ESP32-CAM connector (latch closed)
     Radio   : GND -> GND, 5V -> 5V, RX -> U0T (IO1), TX not connected on the
               bench (TX -> U0R/IO3 only in flight, without the MB base),
               RTS / CTS not connected. Ground radio: USB into the laptop.
     Take the microSD card out (IO13, IO14, IO15 are also the card's pins).
     Connect or disconnect wires only with the USB cable unplugged.

   ARDUINO IDE
     Board   : "AI Thinker ESP32-CAM"      Libraries: none
     Upload  : unplug radio RX, jumper GPIO 0 -> GND, press RST, Upload.
               Remove jumper, plug radio RX back (USB unplugged), press RST.
     Monitor : 57600 baud
     Clock   : starts from the compile time. Type  2026-10-20 16:00:00  and Enter.
     Keys    : h help   k picture now   i picture interval   v picture size
               z gravity fix   6 six-position fix   0 clear saved fix
               c still test   d DHT22 check   s I2C scan   l live log
               p / a / g / e plots   x pause / resume   bps 1500 = radio budget
     Strange characters only at a reset are the ESP32 chip's own boot text,
     printed at 115200 baud before this sketch runs. Code cannot switch it off.
     The ground station script hides it.
   ============================================================================= */

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include "driver/gpio.h"
#include "esp_timer.h"
#include "esp_camera.h"
#include "esp_system.h"
#include "mbedtls/base64.h"
#include <atomic>

// Stop with a clear message if the wrong board is selected in the IDE.
#if !defined(ARDUINO_ARCH_ESP32)
#error "WRONG BOARD: click the board box at the top of the IDE and choose  AI Thinker ESP32-CAM  (needs 'esp32 by Espressif Systems' from Boards Manager)"
#elif defined(CONFIG_IDF_TARGET) && !defined(CONFIG_IDF_TARGET_ESP32)
#error "WRONG ESP32 TYPE: this is not an ESP32-CAM board. Choose  AI Thinker ESP32-CAM  in the board box"
#endif

// ------------------------------ SETTINGS -------------------------------------
#define SERIAL_BAUD    57600     // SiK radio factory speed (USB monitor uses the same)
#define PIN_SDA        14
#define PIN_SCL        15
#define PIN_DHT        13
#define I2C_HZ         400000
#define ACCEL_FS_SEL   3         // ±16 g (flight setting)
#define GYRO_FS_SEL    3         // ±2000 °/s (flight setting)
#define SAMPLE_MS      10        // MPU-6050 read at 100 Hz
#define LOG_MS         1000      // one log line every 1.000 s
#define PLOT_MS        50        // Serial Plotter lines at 20 Hz
#define DHT_MS         2000      // DHT22 can measure once every 2 s
#define DHT_STALE_MS   5000      // show "--" if no good DHT reading for 5 s
#define STILL_SAMPLES  300       // still test: 3 s
#define POSE_SAMPLES   200       // gravity fix: 2 s per position
#define PIN_LED        33        // small red LED on the back, active LOW
#define PIN_FLASH      4         // big white flash LED, kept OFF
#define G0             9.80665f  // standard gravity, m/s² per g
#define ACC_Z_OFFSET_DEFAULT -0.320f  // g. Our board: flat reads 0.680 g -> +0.320 g needed
#define SERIAL_TX_BUF  4096      // printing never stops the 100 Hz sensor reads

// Camera / pictures
#define IMG_PERIOD_S_DEFAULT 15  // automatic picture every 15 s (key i changes it)
#define IMG_QUALITY    12        // JPEG quality: 10 best .. 63 smallest
#define IMG_CHUNK_RAW  192       // JPEG bytes per radio line (= 256 base64 characters)
#define LINK_BPS_DEFAULT 2000    // bytes per second pictures may use on the radio
#define IMG_BUF_BYTES  (160 * 1024)

// AI-Thinker ESP32-CAM camera pins (fixed by the board)
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

// MPU-6050 datasheet tolerances
#define OFFSET_XY_SPEC 0.050f    // zero-g initial tolerance X, Y  (±50 mg)
#define OFFSET_Z_SPEC  0.080f    // zero-g initial tolerance Z     (±80 mg)
#define OFFSET_WARN    0.150f
#define SCALE_SPEC     0.03f     // sensitivity initial tolerance  (±3 %)
#define SCALE_WARN     0.10f

// MPU-6050 registers
#define REG_SMPLRT_DIV   0x19
#define REG_CONFIG       0x1A
#define REG_GYRO_CONFIG  0x1B
#define REG_ACCEL_CONFIG 0x1C
#define REG_ACCEL_XOUT_H 0x3B
#define REG_PWR_MGMT_1   0x6B
#define REG_WHO_AM_I     0x75

static const float ACC_LSB[] = {16384.0f, 8192.0f, 4096.0f, 2048.0f};
static const float GYR_LSB[] = {131.0f, 65.5f, 32.8f, 16.4f};
static const int   ACC_RANGE[] = {2, 4, 8, 16};
static const int   GYR_RANGE[] = {250, 500, 1000, 2000};

// ------------------------------- STATE ---------------------------------------
struct Sample { float a[3]; float g[3]; float tempC; };

enum View : uint8_t { VIEW_LOG, VIEW_PLOT_ANGLES, VIEW_PLOT_ACCEL, VIEW_PLOT_GYRO, VIEW_PLOT_ENV };
enum Res : uint8_t { R_PASS, R_WARN, R_FAIL, R_INFO };   // result of one check
enum DhtErr : uint8_t { DHT_OK, DHT_NO_RESPONSE, DHT_CUT_OFF, DHT_CHECKSUM, DHT_RANGE };

Preferences prefs;

static uint8_t  mpuAddr = 0x68;
static bool     mpuReady = false;
static bool     paused = false;
static View     view = VIEW_LOG;
static float    gyroBias[3] = {0, 0, 0};
static float    accOffset[3] = {0, 0, 0};       // gravity fix, saved on the board
static float    accScale[3] = {1, 1, 1};
static bool     accCalSet = false;
enum CalMode : uint8_t { CAL_DEFAULT, CAL_PAD, CAL_SAVED };
static CalMode  calMode = CAL_DEFAULT;
static const char* CAL_NAME[] = {"code default", "zeroed at start-up", "saved fix (key z/6)"};
static uint32_t pktCount = 1;
static const char* resetName = "?";

// Camera and picture sending
static bool     camOk = false;
static esp_err_t camErr = ESP_OK;
static uint8_t* imgBuf = nullptr;
static TaskHandle_t camTaskHandle = nullptr;
static std::atomic<bool> capDone(false);        // set by the camera task
static bool     capOk = false, capBusy = false, snapRequested = false;
static uint32_t imgPeriodS = IMG_PERIOD_S_DEFAULT, tLastImg = 0, linkBps = LINK_BPS_DEFAULT;
static framesize_t imgSize = FRAMESIZE_QVGA;
static float    tokens = 0;                     // radio byte budget
static uint32_t tokLast = 0;
struct Img { bool sending = false, headerSent = false; uint32_t id = 0, t0 = 0;
             uint16_t seq = 0, chunks = 0, w = 0, h = 0; size_t len = 0; };
static Img      img;
static float    roll = 0, pitch = 0;
static Sample   last;
static bool     haveLast = false;
static uint32_t i2cErrors = 0;
static uint16_t failsInRow = 0;
static uint32_t tNextSample = 0, tNextPrint = 0, tNextProbe = 0, tNextLog = 0, tNextDht = 0;
static int      passN = 0, warnN = 0, failN = 0;

struct Acc { double a[3], g[3], mag; uint16_t n; };
static Acc      acc = {};                       // MPU readings of the current second
static uint32_t errAtLog = 0;

struct Env { float t = NAN, h = NAN; uint32_t okAt = 0; bool ever = false; uint32_t fails = 0; };
static Env      env;

static bool     clockFromUser = false;
static char     inBuf[40];
static uint8_t  inLen = 0;
static uint32_t inLast = 0;

// ------------------------------- I2C -----------------------------------------
static bool writeReg(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool readRegs(uint8_t reg, uint8_t* buf, uint8_t n) {
  Wire.beginTransmission(mpuAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)mpuAddr, (int)n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static void startBus(uint32_t hz) {
  Wire.end();
  Wire.begin(PIN_SDA, PIN_SCL, hz);
  Wire.setTimeOut(20);
}

static bool i2cScan() {
  int found = 0;
  bool sawMpu = false;
  for (uint8_t a = 0x08; a < 0x78; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      found++;
      const char* what = (a == 0x68) ? "MPU-6050 (AD0 = GND)"
                       : (a == 0x69) ? "MPU-6050 (AD0 = 3V3)"
                       : "other device";
      Serial.printf("      found 0x%02X   %s\n", a, what);
      if ((a == 0x68 || a == 0x69) && !sawMpu) { mpuAddr = a; sawMpu = true; }
    }
  }
  if (found == 0) Serial.println("      nothing answered on the bus");
  return sawMpu;
}

// Quiet check used while waiting for the MPU-6050 to be connected.
static bool mpuAnswers() {
  for (uint8_t a = 0x68; a <= 0x69; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) return true;
  }
  return false;
}

// ----------------------------- RESULT LINES ----------------------------------
static void result(const char* name, const char* value, const char* limit, Res r) {
  const char* tag = (r == R_PASS) ? "PASS" : (r == R_WARN) ? "WARN" : (r == R_FAIL) ? "FAIL" : "";
  if (r == R_PASS) passN++;
  if (r == R_WARN) warnN++;
  if (r == R_FAIL) failN++;
  Serial.printf("      %-16s %-26s %-16s %s\n", name, value, limit, tag);
}

static void printMpuHelp() {
  Serial.println("      Check: MPU VCC on 3V3, GND on GND, SDA on IO14, SCL on IO15,");
  Serial.println("      GY-521 pins soldered, microSD card removed, GY-521 LED lit.");
  Serial.println("      The log keeps running and the MPU-6050 is retried every 3 s.");
}

static void printDhtHelp() {
  Serial.println("      Check: DHT22 pin 1 on 3V3, pin 2 DATA on IO13, pin 4 on GND,");
  Serial.println("      10 kΩ from DATA to 3V3 (bare 4-pin sensor only), microSD removed.");
}

// --------------------------- GRAVITY FIX STORAGE -----------------------------
static void setDefaultCal() {
  for (int k = 0; k < 3; k++) { accOffset[k] = 0; accScale[k] = 1; }
  accOffset[2] = ACC_Z_OFFSET_DEFAULT;
  calMode = CAL_DEFAULT;
}

static void loadCal() {
  prefs.begin("dusk-imu", true);
  bool ok = prefs.getBool("ok", false) && prefs.getUChar("fs", 255) == ACCEL_FS_SEL;
  if (ok) {
    accOffset[0] = prefs.getFloat("ox", 0); accOffset[1] = prefs.getFloat("oy", 0);
    accOffset[2] = prefs.getFloat("oz", 0);
    accScale[0] = prefs.getFloat("sx", 1); accScale[1] = prefs.getFloat("sy", 1);
    accScale[2] = prefs.getFloat("sz", 1);
    for (int k = 0; k < 3; k++) if (accScale[k] < 0.5f || accScale[k] > 1.5f) ok = false;
  }
  prefs.end();
  if (ok) {
    calMode = CAL_SAVED;
  } else {
    setDefaultCal();
  }
  accCalSet = true;
}

static void saveCal() {
  prefs.begin("dusk-imu", false);
  prefs.putBool("ok", true);
  prefs.putUChar("fs", ACCEL_FS_SEL);
  prefs.putFloat("ox", accOffset[0]); prefs.putFloat("oy", accOffset[1]);
  prefs.putFloat("oz", accOffset[2]);
  prefs.putFloat("sx", accScale[0]); prefs.putFloat("sy", accScale[1]);
  prefs.putFloat("sz", accScale[2]);
  prefs.end();
}

static void clearCal() {
  prefs.begin("dusk-imu", false);
  prefs.clear();
  prefs.end();
  setDefaultCal();
  accCalSet = true;
  Serial.println("\nSaved gravity fix cleared - back to the code default (type c to zero it again).\n");
}

static void printCalLine() {
  Serial.printf("      gravity correction: %s\n", CAL_NAME[calMode]);
  Serial.printf("      offset X %+.3f  Y %+.3f  Z %+.3f g   scale X %.3f  Y %.3f  Z %.3f\n",
                accOffset[0], accOffset[1], accOffset[2], accScale[0], accScale[1], accScale[2]);
}

// ------------------------------- SENSOR --------------------------------------
static void correctAccel(float a[3]) {
  if (!accCalSet) return;
  for (int k = 0; k < 3; k++) a[k] = (a[k] - accOffset[k]) / accScale[k];
}

// correct = true: apply the gravity fix and remove the gyro bias.
static bool readSample(Sample& s, bool correct) {
  uint8_t b[14];
  if (!readRegs(REG_ACCEL_XOUT_H, b, 14)) { i2cErrors++; return false; }
  for (int k = 0; k < 3; k++) {
    int16_t ra = (int16_t)((b[2 * k] << 8) | b[2 * k + 1]);
    int16_t rg = (int16_t)((b[8 + 2 * k] << 8) | b[9 + 2 * k]);
    s.a[k] = ra / ACC_LSB[ACCEL_FS_SEL];
    s.g[k] = rg / GYR_LSB[GYRO_FS_SEL] - (correct ? gyroBias[k] : 0.0f);
  }
  if (correct) correctAccel(s.a);
  int16_t rt = (int16_t)((b[6] << 8) | b[7]);
  s.tempC = rt / 340.0f + 36.53f;              // formula from the MPU-6050 register map
  return true;
}

static bool configure() {
  writeReg(REG_PWR_MGMT_1, 0x80);              // device reset
  delay(100);
  bool w = writeReg(REG_PWR_MGMT_1, 0x01)      // wake up, clock from gyro X PLL
        && writeReg(REG_SMPLRT_DIV, 0x09)      // 100 Hz
        && writeReg(REG_CONFIG, 0x03)          // low-pass filter 44 Hz
        && writeReg(REG_GYRO_CONFIG, GYRO_FS_SEL << 3)
        && writeReg(REG_ACCEL_CONFIG, ACCEL_FS_SEL << 3);
  delay(50);
  uint8_t r[3] = {0}, pm = 0xFF;
  bool rd = readRegs(REG_CONFIG, r, 3) && readRegs(REG_PWR_MGMT_1, &pm, 1);
  bool match = rd && (r[0] & 0x07) == 0x03 && (r[1] & 0x18) == (GYRO_FS_SEL << 3) &&
               (r[2] & 0x18) == (ACCEL_FS_SEL << 3) && (pm & 0x40) == 0;
  char v[40];
  snprintf(v, sizeof(v), "±%d g, ±%d °/s, 44 Hz", ACC_RANGE[ACCEL_FS_SEL], GYR_RANGE[GYRO_FS_SEL]);
  result("write+readback", v, match ? "matches" : "MISMATCH", (w && match) ? R_PASS : R_FAIL);
  return w && match;
}

static void resetAttitude(const Sample& s) {
  roll  = atan2f(s.a[1], s.a[2]) * RAD_TO_DEG;
  pitch = atan2f(-s.a[0], sqrtf(s.a[1] * s.a[1] + s.a[2] * s.a[2])) * RAD_TO_DEG;
}

// Complementary filter: gyro for fast motion, gravity to stop drift.
static void updateAttitude(const Sample& s, float dt) {
  float accRoll  = atan2f(s.a[1], s.a[2]) * RAD_TO_DEG;
  float accPitch = atan2f(-s.a[0], sqrtf(s.a[1] * s.a[1] + s.a[2] * s.a[2])) * RAD_TO_DEG;
  roll  = 0.98f * (roll  + s.g[0] * dt) + 0.02f * accRoll;
  pitch = 0.98f * (pitch + s.g[1] * dt) + 0.02f * accPitch;
}

// ------------------------------ STILL TEST -----------------------------------
static bool stillTest() {
  Serial.println("[4/6] Still test - do not touch the board or the table for 4 seconds");
  delay(1000);
  double sa[3] = {0}, sa2[3] = {0}, sg[3] = {0}, sg2[3] = {0}, smag = 0, stemp = 0;
  int good = 0, bad = 0;
  float first[3] = {0};
  bool frozen = true;
  uint32_t t0 = millis(), next = t0;
  for (int i = 0; i < STILL_SAMPLES; i++) {
    Sample s;
    if (readSample(s, false)) {                  // raw gyro: needed to measure its bias
      if (good == 0) memcpy(first, s.a, sizeof(first));
      else if (s.a[0] != first[0] || s.a[1] != first[1] || s.a[2] != first[2]) frozen = false;
      for (int k = 0; k < 3; k++) {                // raw accel: needed for the zeroing
        sa[k] += s.a[k]; sa2[k] += (double)s.a[k] * s.a[k];
        sg[k] += s.g[k]; sg2[k] += (double)s.g[k] * s.g[k];
      }
      smag += sqrtf(s.a[0] * s.a[0] + s.a[1] * s.a[1] + s.a[2] * s.a[2]);
      stemp += s.tempC;
      good++;
    } else {
      bad++;
    }
    next += SAMPLE_MS;
    while ((int32_t)(millis() - next) < 0) delay(1);
  }
  float secs = (millis() - t0) / 1000.0f;

  passN = warnN = failN = 0;
  char v[48];
  if (good < STILL_SAMPLES / 2) {
    snprintf(v, sizeof(v), "%d of %d reads OK", good, STILL_SAMPLES);
    result("reads", v, "> 50 %", R_FAIL);
    return false;
  }

  float meanA[3], meanG[3], sdA = 0, sdG = 0;
  for (int k = 0; k < 3; k++) {
    meanA[k] = sa[k] / good;
    meanG[k] = sg[k] / good;
    float va = sa2[k] / good - (double)meanA[k] * meanA[k];
    float vg = sg2[k] / good - (double)meanG[k] * meanG[k];
    sdA = max(sdA, sqrtf(max(va, 0.0f)));
    sdG = max(sdG, sqrtf(max(vg, 0.0f)));
  }
  float rawMag = smag / good, temp = stemp / good;
  float biasMax = max(fabsf(meanG[0]), max(fabsf(meanG[1]), fabsf(meanG[2])));
  bool still = sdG < 0.5f && sdA < 0.02f;

  // Zero Z at rest so the board reads exactly 1 g = 9.807 m/s², unless a fix
  // measured with key z / 6 is saved (that one also knows the scale).
  if (still && calMode != CAL_SAVED) {
    float zDef = meanA[2] - ACC_Z_OFFSET_DEFAULT;          // which way is Z pointing?
    float zTrue = sqrtf(max(0.0f, 1.0f - meanA[0] * meanA[0] - meanA[1] * meanA[1]));
    if (zDef < 0) zTrue = -zTrue;
    float off = meanA[2] - zTrue;
    if (fabsf(off) < 0.5f) {
      for (int k = 0; k < 3; k++) { accOffset[k] = 0; accScale[k] = 1; }
      accOffset[2] = off;
      calMode = CAL_PAD;
      accCalSet = true;
    }
  }
  float cm[3] = {(float)meanA[0], (float)meanA[1], (float)meanA[2]};
  correctAccel(cm);
  float mag = sqrtf(cm[0] * cm[0] + cm[1] * cm[1] + cm[2] * cm[2]);

  Serial.printf("      gravity correction: %s (Z offset %+.3f g)\n", CAL_NAME[calMode], accOffset[2]);
  Serial.println("      check            measured                   limit            result");
  snprintf(v, sizeof(v), "%.3f g = %.2f m/s²", rawMag, rawMag * G0);
  result("gravity raw", v, "", R_INFO);
  snprintf(v, sizeof(v), "%.3f g = %.3f m/s²", mag, mag * G0);
  bool gOk = (mag > 0.97f && mag < 1.03f);
  result("gravity corr.", v, "9.51 - 10.10", gOk ? R_PASS : R_FAIL);
  if (!gOk) Serial.println("      ^ type z for the 20-second gravity fix (flat + upside down)");

  snprintf(v, sizeof(v), "%.1f mg", sdA * 1000.0f);
  result("accel noise", v, "< 20 mg", frozen ? R_FAIL : (sdA < 0.020f ? R_PASS : R_WARN));
  if (frozen) Serial.println("      ^ every reading was identical: the sensor is asleep or not updating");

  snprintf(v, sizeof(v), "%+.2f %+.2f %+.2f °/s", meanG[0], meanG[1], meanG[2]);
  result("gyro bias", v, "< 20 °/s", biasMax < 20.0f ? (biasMax < 10.0f ? R_PASS : R_WARN) : R_FAIL);

  snprintf(v, sizeof(v), "%.3f °/s", sdG);
  result("gyro noise", v, "< 0.50 °/s", sdG < 0.5f ? R_PASS : R_WARN);

  snprintf(v, sizeof(v), "%.1f °C", temp);
  result("chip temp", v, "0 - 70 °C", (temp > 0.0f && temp < 70.0f) ? R_PASS : R_WARN);

  snprintf(v, sizeof(v), "%.0f reads/s, %d errors", good / secs, bad);
  result("I2C link", v, "0 errors", bad == 0 ? R_PASS : (bad < 5 ? R_WARN : R_FAIL));

  if (still && biasMax < 20.0f) {
    for (int k = 0; k < 3; k++) gyroBias[k] = meanG[k];
    Serial.println("      gyro bias saved: gx gy gz read 0.00 when still");
  } else {
    Serial.println("      ^ the board moved, gyro bias NOT saved (gx gy gz will not read 0) - type c to repeat");
  }
  Serial.println();
  return failN == 0;
}

// ----------------------------- DHT22 DRIVER ----------------------------------
// No library needed. The DHT22 talks on one wire: we pull it LOW for 1.1 ms,
// it answers 80 µs LOW + 80 µs HIGH, then sends 40 bits. Every bit is a ~50 µs
// LOW followed by a HIGH: ~27 µs means 0, ~70 µs means 1.
// Bytes: humidity x10 (2), temperature x10 (2, top bit = minus), checksum.
static const char* DHT_ERR_TEXT[] = {"ok", "no answer", "answer cut off", "checksum wrong",
                                     "value out of range"};
static portMUX_TYPE dhtMux = portMUX_INITIALIZER_UNLOCKED;
static DhtErr dhtLastErr = DHT_OK;

static void dhtPinInit() {
  pinMode(PIN_DHT, OUTPUT_OPEN_DRAIN | PULLUP);  // can pull LOW, and still read the line
  digitalWrite(PIN_DHT, HIGH);                   // released: the pull-up keeps it HIGH
}

// How long (µs) the line stays at 'level'. 0 = it never changed (timed out).
static inline uint32_t dhtPulse(int level, uint32_t timeoutUs) {
  uint32_t t0 = (uint32_t)esp_timer_get_time();
  while (gpio_get_level((gpio_num_t)PIN_DHT) == level) {
    if ((uint32_t)esp_timer_get_time() - t0 > timeoutUs) return 0;
  }
  uint32_t d = (uint32_t)esp_timer_get_time() - t0;
  return d ? d : 1;
}

// Turns the 40 measured bits into temperature (°C) and humidity (%).
static DhtErr dhtDecode(const uint16_t lowUs[40], const uint16_t highUs[40], float& t, float& h) {
  uint8_t d[5] = {0, 0, 0, 0, 0};
  for (int i = 0; i < 40; i++) {
    d[i / 8] <<= 1;
    if (highUs[i] > lowUs[i]) d[i / 8] |= 1;     // HIGH longer than the 50 µs LOW = 1
  }
  if ((uint8_t)(d[0] + d[1] + d[2] + d[3]) != d[4]) return DHT_CHECKSUM;
  h = ((d[0] << 8) | d[1]) * 0.1f;
  t = (((d[2] & 0x7F) << 8) | d[3]) * 0.1f;
  if (d[2] & 0x80) t = -t;
  if (h < 0.0f || h > 100.0f || t < -40.0f || t > 80.0f) return DHT_RANGE;
  return DHT_OK;
}

static DhtErr dhtReadRaw(float& t, float& h) {
  uint16_t lowUs[40], highUs[40];
  DhtErr err = DHT_OK;
  gpio_set_level((gpio_num_t)PIN_DHT, 0);        // start signal
  delayMicroseconds(1100);
  portENTER_CRITICAL(&dhtMux);                   // ~5 ms with interrupts off: exact timing
  gpio_set_level((gpio_num_t)PIN_DHT, 1);        // release, the sensor answers in 20-40 µs
  if (!dhtPulse(1, 200) || !dhtPulse(0, 200) || !dhtPulse(1, 200)) {
    err = DHT_NO_RESPONSE;
  } else {
    for (int i = 0; i < 40; i++) {
      uint32_t lo = dhtPulse(0, 200);
      uint32_t hi = lo ? dhtPulse(1, 200) : 0;
      if (!lo || !hi) { err = DHT_CUT_OFF; break; }
      lowUs[i] = lo;
      highUs[i] = hi;
    }
  }
  portEXIT_CRITICAL(&dhtMux);
  if (err != DHT_OK) return err;
  return dhtDecode(lowUs, highUs, t, h);
}

// Reads the DHT22 once. Returns true and updates env if the reading is valid.
static bool dhtRead() {
  float t = NAN, h = NAN;
  dhtLastErr = dhtReadRaw(t, h);
  bool ok = dhtLastErr == DHT_OK;
  if (ok) { env.t = t; env.h = h; env.okAt = millis(); env.ever = true; }
  else env.fails++;
  return ok;
}

static bool dhtCheck() {
  Serial.println("[5/6] DHT22 on IO13");
  passN = warnN = failN = 0;
  int tries = 0;
  bool ok = false;
  while (tries < 3 && !ok) {
    if (tries) delay(DHT_MS + 100);
    tries++;
    ok = dhtRead();
  }
  char v[48];
  snprintf(v, sizeof(v), "%s after %d of 3 tries", ok ? "OK" : DHT_ERR_TEXT[dhtLastErr], tries);
  result("DHT22 read", v, "valid reading", ok ? R_PASS : R_FAIL);
  if (!ok) {
    if (dhtLastErr == DHT_NO_RESPONSE) printDhtHelp();
    else Serial.println("      ^ the DHT22 answers but the data is damaged: check the 10 kΩ pull-up,\n"
                        "        push the wires in firmly, keep the DATA wire short");
    Serial.println();
    return false;
  }
  snprintf(v, sizeof(v), "%.1f °C", env.t);
  result("temperature", v, "-40 - 80 °C", R_PASS);
  snprintf(v, sizeof(v), "%.1f %%", env.h);
  result("humidity", v, "0 - 100 %", R_PASS);
  if (haveLast) {
    float d = env.t - last.tempC;
    snprintf(v, sizeof(v), "%+.1f °C vs MPU chip", d);
    result("cross-check", v, "within ±8 °C", fabsf(d) < 8.0f ? R_PASS : R_WARN);
    if (fabsf(d) >= 8.0f) Serial.println("      ^ big difference: is the DHT22 near something warm or cold?");
  }
  Serial.println();
  return true;
}

// --------------------------- GRAVITY FIX (z / 6) -----------------------------
struct Pose { const char* text; int axis; int sign; };
static const Pose POSES[6] = {
  {"Z UP     lay the GY-521 flat, chip side UP", 2, +1},
  {"Z DOWN   flat and upside down, chip side facing the table", 2, -1},
  {"X UP     stand it on an edge, printed X arrow pointing UP", 0, +1},
  {"X DOWN   printed X arrow pointing DOWN", 0, -1},
  {"Y UP     stand it on an edge, printed Y arrow pointing UP", 1, +1},
  {"Y DOWN   printed Y arrow pointing DOWN", 1, -1},
};

// Waits for the user to type something and press Enter. Returns false on 'q'.
static bool waitForKey() {
  delay(30);
  while (Serial.available()) Serial.read();
  while (!Serial.available()) delay(10);
  delay(50);
  char c = (char)Serial.read();
  while (Serial.available()) Serial.read();
  return tolower(c) != 'q';
}

// Averages raw acceleration over 2 s. Returns false if the board moved.
static bool measurePose(float out[3], float& sdMax) {
  double s[3] = {0}, s2[3] = {0};
  int good = 0;
  uint32_t next = millis();
  for (int i = 0; i < POSE_SAMPLES; i++) {
    Sample x;
    if (readSample(x, false)) {
      for (int k = 0; k < 3; k++) { s[k] += x.a[k]; s2[k] += (double)x.a[k] * x.a[k]; }
      good++;
    }
    next += SAMPLE_MS;
    while ((int32_t)(millis() - next) < 0) delay(1);
  }
  sdMax = 1.0f;
  if (good < POSE_SAMPLES * 3 / 4) return false;
  sdMax = 0;
  for (int k = 0; k < 3; k++) {
    out[k] = s[k] / good;
    float var = s2[k] / good - (double)out[k] * out[k];
    sdMax = max(sdMax, sqrtf(max(var, 0.0f)));
  }
  return sdMax < 0.03f;
}

// Asks for one position, measures it and checks it is the right one.
static bool collectPose(int p, int step, int steps, float out[3]) {
  for (;;) {
    Serial.printf("[%d/%d] %s  ->  type n + Enter\n", step, steps, POSES[p].text);
    if (!waitForKey()) { Serial.println("Stopped, nothing changed.\n"); return false; }
    Serial.println("      measuring 2 s, keep it still ...");
    float sd;
    if (!measurePose(out, sd)) {
      Serial.printf("      it moved (noise %.0f mg) - try again\n", sd * 1000.0f);
      continue;
    }
    int big = 0;
    for (int k = 1; k < 3; k++) if (fabsf(out[k]) > fabsf(out[big])) big = k;
    int sign = out[big] >= 0 ? +1 : -1;
    Serial.printf("      x=%+.3f  y=%+.3f  z=%+.3f g\n", out[0], out[1], out[2]);
    if (big != POSES[p].axis || sign != POSES[p].sign) {
      Serial.printf("      that looks like %c%c pointing up, not the position asked for - try again\n",
                    sign > 0 ? '+' : '-', "XYZ"[big]);
      continue;
    }
    return true;
  }
}

// Offset and scale of one axis from its up (+1 g) and down (-1 g) readings.
static bool reportAxis(int k, float up, float dn, float& off, float& sc) {
  off = (up + dn) / 2.0f;
  sc  = (up - dn) / 2.0f;
  char name[20], v[48], lim[24];
  snprintf(name, sizeof(name), "%c up / down", "XYZ"[k]);
  snprintf(v, sizeof(v), "%+.3f / %+.3f g", up, dn);
  result(name, v, "+1 / -1 g", R_INFO);
  float spec = (k == 2) ? OFFSET_Z_SPEC : OFFSET_XY_SPEC;
  snprintf(name, sizeof(name), "%c offset", "XYZ"[k]);
  snprintf(v, sizeof(v), "%+.3f g", off);
  snprintf(lim, sizeof(lim), "±%.3f g", spec);
  float ao = fabsf(off);
  result(name, v, lim, ao <= spec ? R_PASS : (ao <= OFFSET_WARN ? R_WARN : R_FAIL));
  snprintf(name, sizeof(name), "%c scale", "XYZ"[k]);
  snprintf(v, sizeof(v), "%.3f  (%+.1f %%)", sc, (sc - 1.0f) * 100.0f);
  snprintf(lim, sizeof(lim), "%.2f - %.2f", 1.0f - SCALE_SPEC, 1.0f + SCALE_SPEC);
  float as = fabsf(sc - 1.0f);
  result(name, v, lim, as <= SCALE_SPEC ? R_PASS : (as <= SCALE_WARN ? R_WARN : R_FAIL));
  return sc >= 0.5f && sc <= 1.5f;
}

static void finishFix(bool usable) {
  Serial.println();
  if (!usable) {
    Serial.println("RESULT: the sensor is too far off to correct - replace the GY-521.\n");
    loadCal();                                  // keep whatever was saved before
    return;
  }
  accCalSet = true;
  calMode = CAL_SAVED;
  saveCal();
  if (failN == 0 && warnN == 0) Serial.println("RESULT: inside the MPU-6050 datasheet.");
  else if (failN == 0)          Serial.println("RESULT: slightly outside the datasheet - corrected.");
  else Serial.println("RESULT: far outside the datasheet (typical of a clone or damaged chip) - corrected.");
  Serial.println("Gravity fix SAVED on the board (kept after reset and re-upload):");
  printCalLine();
  Serial.println("Lay it flat: az and |a| now read about 9.81 m/s². Type c to check.\n");
}

// Key z: Z axis only, 2 positions, about 20 s.
static void gravityFixZ() {
  Serial.println();
  Serial.println("==== Gravity fix, Z axis (2 positions, about 20 s) ====");
  Serial.println("Hold only the GY-521 (the wires let it move). Rest it on a flat table.");
  Serial.println("Type q to stop.\n");
  float m[2][3];
  for (int p = 0; p < 2; p++) if (!collectPose(p, p + 1, 2, m[p])) return;
  passN = warnN = failN = 0;
  Serial.println();
  Serial.println("      axis             reading                    limit            result");
  float off, sc;
  bool usable = reportAxis(2, m[0][2], m[1][2], off, sc);
  if (usable) { accOffset[2] = off; accScale[2] = sc; }
  finishFix(usable);
}

// Key 6: all three axes, 6 positions.
static void gravityFix6() {
  Serial.println();
  Serial.println("==== Gravity fix, all axes (6 positions, about 1 minute) ====");
  Serial.println("Hold only the GY-521. Rest it against a book or box edge so it is square");
  Serial.println("and still. Type q to stop.\n");
  float m[6][3];
  for (int p = 0; p < 6; p++) if (!collectPose(p, p + 1, 6, m[p])) return;
  float up[3], dn[3], off[3], sc[3];
  for (int p = 0; p < 6; p++) {
    int k = POSES[p].axis;
    if (POSES[p].sign > 0) up[k] = m[p][k]; else dn[k] = m[p][k];
  }
  passN = warnN = failN = 0;
  Serial.println();
  Serial.println("      axis             reading                    limit            result");
  bool usable = true;
  for (int k = 0; k < 3; k++) usable &= reportAxis(k, up[k], dn[k], off[k], sc[k]);
  if (usable) for (int k = 0; k < 3; k++) { accOffset[k] = off[k]; accScale[k] = sc[k]; }
  finishFix(usable);
}

// ------------------------------- BRING-UP ------------------------------------
static bool bringUpMpu() {
  Serial.println("[1/6] I2C scan on SDA=IO14, SCL=IO15");
  startBus(I2C_HZ);
  bool found = i2cScan();
  if (!found) {
    Serial.println("      retrying at 100 kHz ...");
    startBus(100000);
    found = i2cScan();
  }
  if (!found) {
    result("MPU-6050", "not found", "0x68 or 0x69", R_FAIL);
    printMpuHelp();
    Serial.println();
    return false;
  }

  Serial.println("[2/6] MPU-6050 chip ID");
  uint8_t who = 0;
  char v[40];
  if (!readRegs(REG_WHO_AM_I, &who, 1)) {
    result("WHO_AM_I", "read failed", "", R_FAIL);
    return false;
  }
  snprintf(v, sizeof(v), "0x%02X at address 0x%02X", who, mpuAddr);
  result("WHO_AM_I", v, "0x68", who == 0x68 ? R_PASS : R_WARN);
  if (who != 0x68) Serial.println("      ^ a compatible chip or clone - continuing");

  Serial.println("[3/6] Configure with the flight settings");
  if (!configure()) return false;

  stillTest();
  Sample s;
  if (readSample(s, true)) { last = s; haveLast = true; resetAttitude(s); }
  failsInRow = 0;
  return true;
}

// --------------------------------- CLOCK -------------------------------------
static void setClock(int Y, int M, int D, int h, int m, int sec) {
  struct tm t = {};
  t.tm_year = Y - 1900; t.tm_mon = M - 1; t.tm_mday = D;
  t.tm_hour = h; t.tm_min = m; t.tm_sec = sec; t.tm_isdst = 0;
  struct timeval tv = { mktime(&t), 0 };
  settimeofday(&tv, nullptr);
}

// Start the clock from the moment the sketch was compiled on the laptop.
static void setClockFromBuild() {
  static const char months[] = "JanFebMarAprMayJunJulAugSepOctNovDec";
  char mon[4] = {0};
  int d = 1, y = 2026, h = 0, mi = 0, sec = 0;
  sscanf(__DATE__, "%3s %d %d", mon, &d, &y);
  sscanf(__TIME__, "%d:%d:%d", &h, &mi, &sec);
  const char* f = strstr(months, mon);
  int M = f ? (int)(f - months) / 3 + 1 : 1;
  setClock(y, M, d, h, mi, sec);
}

static void clockString(char* out, size_t n) {
  time_t t = time(nullptr);
  struct tm tmv;
  localtime_r(&t, &tmv);
  strftime(out, n, "%Y-%m-%d %H:%M:%S", &tmv);
}

// --------------------------------- LOG ---------------------------------------
static void restartLog() {
  acc = {};
  errAtLog = i2cErrors;
  uint32_t now = millis();
  tNextSample = now;                            // exactly 100 readings per line
  tNextLog = now + LOG_MS;
}

static void addToLog(const Sample& s) {
  for (int k = 0; k < 3; k++) { acc.a[k] += s.a[k]; acc.g[k] += s.g[k]; }
  acc.mag += sqrtf(s.a[0] * s.a[0] + s.a[1] * s.a[1] + s.a[2] * s.a[2]);
  acc.n++;
}

static int addF(char* b, int p, int cap, const char* label, bool ok, float v, const char* fmt) {
  if (p >= cap - 1) return p;
  int n = snprintf(b + p, cap - p, "%s%s ", p ? " | " : "", label);
  if (n > 0) p = min(p + n, cap - 1);
  n = ok ? snprintf(b + p, cap - p, fmt, v) : snprintf(b + p, cap - p, "--");
  if (n > 0) p = min(p + n, cap - 1);
  return p;
}

// Dusk1-2026-10-20 16:03:55:> pkt 12 | T 25.7 | RH 39.9 | ax +0.03 | ... | n 100 | err 0
static void printLogLine() {
  char ts[24], b[240];
  clockString(ts, sizeof(ts));
  int head = snprintf(b, sizeof(b), "Dusk1-%s:> ", ts);
  char* d = b + head;
  int cap = sizeof(b) - head, p = 0;
  bool envOk = env.ever && (millis() - env.okAt) < DHT_STALE_MS;
  bool m = acc.n > 0;
  float n = m ? acc.n : 1;
  p += snprintf(d, cap, "pkt %lu", (unsigned long)pktCount++);
  p = addF(d, p, cap, "T", envOk, env.t, "%.1f");
  p = addF(d, p, cap, "RH", envOk, env.h, "%.1f");
  p = addF(d, p, cap, "ax", m, acc.a[0] / n * G0, "%+.2f");    // m/s²
  p = addF(d, p, cap, "ay", m, acc.a[1] / n * G0, "%+.2f");
  p = addF(d, p, cap, "az", m, acc.a[2] / n * G0, "%+.2f");
  p = addF(d, p, cap, "|a|", m, acc.mag / n * G0, "%.2f");
  p = addF(d, p, cap, "gx", m, acc.g[0] / n, "%+.2f");
  p = addF(d, p, cap, "gy", m, acc.g[1] / n, "%+.2f");
  p = addF(d, p, cap, "gz", m, acc.g[2] / n, "%+.2f");
  p = addF(d, p, cap, "roll", m, roll, "%+.1f");
  p = addF(d, p, cap, "pitch", m, pitch, "%+.1f");
  snprintf(d + p, cap - p, " | n %u | err %lu", acc.n, (unsigned long)(i2cErrors - errAtLog));
  Serial.println(b);
  tokens -= strlen(b) + 2;                       // telemetry shares the radio with pictures
  acc = {};
  errAtLog = i2cErrors;
}

// -------------------------------- CAMERA -------------------------------------
static const char* frameSizeName(framesize_t f) {
  switch (f) {
    case FRAMESIZE_QQVGA: return "160x120";
    case FRAMESIZE_QVGA:  return "320x240";
    case FRAMESIZE_VGA:   return "640x480";
    default:              return "?";
  }
}

static bool cameraStart() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM;
  c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_VGA;                  // buffers big enough for VGA (key v)
  c.jpeg_quality = IMG_QUALITY;
  c.fb_count = 2;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;              // always the newest picture
  if (!psramFound()) {
    c.frame_size = FRAMESIZE_QVGA;
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
    c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }
  camErr = esp_camera_init(&c);
  if (camErr != ESP_OK) return false;
  sensor_t* sens = esp_camera_sensor_get();
  sens->set_framesize(sens, imgSize);
  sens->set_quality(sens, IMG_QUALITY);
  return true;
}

// Runs on core 0: grabs a picture while loop() keeps reading the sensors on core 1.
static void camTaskFn(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    camera_fb_t* fb = esp_camera_fb_get();
    bool ok = fb && fb->format == PIXFORMAT_JPEG && fb->len > 0 && fb->len <= IMG_BUF_BYTES;
    if (ok) {
      memcpy(imgBuf, fb->buf, fb->len);
      img.len = fb->len;
      img.w = fb->width;
      img.h = fb->height;
    }
    if (fb) esp_camera_fb_return(fb);
    capOk = ok;
    capDone.store(true, std::memory_order_release);
  }
}

// Start-up check [6/6]: camera answers and gives a real JPEG picture.
static void cameraCheck() {
  Serial.println("[6/6] Camera OV2640");
  passN = warnN = failN = 0;
  char v[48];
  if (!camOk) {
    snprintf(v, sizeof(v), "%s (0x%x)", imgBuf ? "init failed" : "no memory", (unsigned)camErr);
    result("camera start", v, "ok", R_FAIL);
    Serial.println("      Check: ribbon cable pushed fully in and the latch closed,");
    Serial.println("      USB cable firm (the camera needs extra current). Telemetry continues.");
    Serial.println();
    return;
  }
  result("camera start", "ok", "ok", R_PASS);
  for (int i = 0; i < 3; i++) {                  // let auto-exposure settle
    camera_fb_t* fb = esp_camera_fb_get();
    if (fb) esp_camera_fb_return(fb);
  }
  uint32_t t0 = millis();
  camera_fb_t* fb = esp_camera_fb_get();
  uint32_t dt = millis() - t0;
  if (!fb) {
    result("test picture", "no picture", "JPEG", R_FAIL);
    Serial.println();
    return;
  }
  bool jpeg = fb->format == PIXFORMAT_JPEG && fb->len > 2 && fb->buf[0] == 0xFF && fb->buf[1] == 0xD8;
  snprintf(v, sizeof(v), "%ux%u, %u bytes, %lu ms", fb->width, fb->height, (unsigned)fb->len,
           (unsigned long)dt);
  result("test picture", v, "JPEG", jpeg ? R_PASS : R_FAIL);
  float secs = (fb->len * 4.0f / 3.0f + (fb->len / IMG_CHUNK_RAW + 1) * 30) / linkBps;
  snprintf(v, sizeof(v), "about %.0f s per picture", secs);
  result("radio time", v, "", R_INFO);
  esp_camera_fb_return(fb);
  Serial.println();
}

static void refillTokens(uint32_t now) {
  tokens += (float)(now - tokLast) * linkBps / 1000.0f;
  tokLast = now;
  if (tokens > 600.0f) tokens = 600.0f;
}

// Decides when to take a picture and collects it from the camera task.
static void imagingTask(uint32_t now) {
  if (!camOk) { snapRequested = false; return; }
  if (capBusy) {
    if (!capDone.load(std::memory_order_acquire)) return;
    capBusy = false;
    if (!capOk) { Serial.println("Camera: picture failed, trying again next time"); return; }
    img.id++;
    img.seq = 0;
    img.chunks = (img.len + IMG_CHUNK_RAW - 1) / IMG_CHUNK_RAW;
    img.headerSent = false;
    img.sending = true;
    img.t0 = now;
    return;
  }
  if (img.sending) return;
  bool autoDue = imgPeriodS > 0 && (now - tLastImg) >= imgPeriodS * 1000UL;
  if (!autoDue && !snapRequested) return;
  snapRequested = false;
  tLastImg = now;
  capDone.store(false, std::memory_order_relaxed);
  capBusy = true;
  xTaskNotifyGive(camTaskHandle);
}

// Sends at most one picture line per call, only when the radio budget allows.
static void imageSendTask() {
  if (!img.sending) return;
  char ts[24];
  if (!img.headerSent) {
    if (tokens < 90 || Serial.availableForWrite() < 120) return;
    clockString(ts, sizeof(ts));
    char b[120];
    snprintf(b, sizeof(b), "Dusk1-%s:> img %lu start | %ux%u | %u bytes | %u chunks", ts,
             (unsigned long)img.id, img.w, img.h, (unsigned)img.len, img.chunks);
    Serial.println(b);
    tokens -= strlen(b) + 2;
    img.headerSent = true;
    return;
  }
  if (img.seq < img.chunks) {
    static char b64[IMG_CHUNK_RAW * 4 / 3 + 8];
    static char line[IMG_CHUNK_RAW * 4 / 3 + 48];
    const int need = IMG_CHUNK_RAW * 4 / 3 + 32;
    if (tokens < need || Serial.availableForWrite() < need + 8) return;
    size_t off = (size_t)img.seq * IMG_CHUNK_RAW;
    size_t n = min((size_t)IMG_CHUNK_RAW, img.len - off);
    size_t olen = 0;
    mbedtls_base64_encode((unsigned char*)b64, sizeof(b64), &olen, imgBuf + off, n);
    b64[olen] = 0;
    int len = snprintf(line, sizeof(line), "Dusk1-img:> %lu %u %s", (unsigned long)img.id, img.seq, b64);
    uint8_t cs = 0;
    for (int i = 0; i < len; i++) cs ^= (uint8_t)line[i];
    snprintf(line + len, sizeof(line) - len, "*%02X", cs);
    Serial.println(line);
    tokens -= len + 5;
    img.seq++;
    return;
  }
  if (tokens < 60) return;
  clockString(ts, sizeof(ts));
  char b[100];
  snprintf(b, sizeof(b), "Dusk1-%s:> img %lu end | %u chunks | %.1f s", ts, (unsigned long)img.id,
           img.chunks, (millis() - img.t0) / 1000.0f);
  Serial.println(b);
  tokens -= strlen(b) + 2;
  img.sending = false;
}

static void cycleImageSize() {
  imgSize = (imgSize == FRAMESIZE_QVGA) ? FRAMESIZE_VGA
          : (imgSize == FRAMESIZE_VGA)  ? FRAMESIZE_QQVGA : FRAMESIZE_QVGA;
  if (!psramFound() && imgSize == FRAMESIZE_VGA) imgSize = FRAMESIZE_QQVGA;
  if (camOk) { sensor_t* sens = esp_camera_sensor_get(); sens->set_framesize(sens, imgSize); }
  Serial.printf("\nPicture size now %s (bigger = slower over the radio)\n\n", frameSizeName(imgSize));
}

static void cycleImagePeriod() {
  imgPeriodS = (imgPeriodS == 0) ? 10 : (imgPeriodS == 10) ? 15 : (imgPeriodS == 15) ? 30
             : (imgPeriodS == 30) ? 60 : 0;
  if (imgPeriodS) Serial.printf("\nAutomatic picture every %lu s\n\n", (unsigned long)imgPeriodS);
  else Serial.println("\nAutomatic pictures OFF - key k takes one\n");
}

static const char* resetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:  return "power-on";
    case ESP_RST_EXT:      return "reset pin";
    case ESP_RST_SW:       return "software";
    case ESP_RST_PANIC:    return "crash";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout";
    default:               return "other";
  }
}

// -------------------------------- OUTPUT -------------------------------------
static void printHelp() {
  Serial.println();
  Serial.println("Telemetry: one line per second, to the USB monitor AND the radio");
  Serial.println("  pkt = line number (a gap on the ground = a lost line)");
  Serial.println("  T °C, RH % from the DHT22 (it measures every 2 s, -- = no reading)");
  Serial.println("  ax ay az |a| in m/s², gx gy gz in °/s, roll pitch in ° = average of that second");
  Serial.println("  n = MPU readings in that second (100) · err = I2C errors in that second");
  Serial.println();
  Serial.println("Type in the Serial Monitor box, then Enter:");
  Serial.println("  2026-10-19 19:30:00  set date and time      19:30:00  set time only");
  Serial.println("  k  picture now             i  picture interval         v  picture size");
  Serial.println("  bps 1500  radio budget for pictures (lower it if pictures arrive with gaps)");
  Serial.println("  z  gravity fix (Z, 20 s)   6  gravity fix (all axes)   0  clear the fix");
  Serial.println("  c  still test              d  DHT22 check              s  I2C scan");
  Serial.println("  l  live log    p roll/pitch plot    a accel plot    g gyro plot    e T/RH plot");
  Serial.println("  h  this help               x  pause / resume");
  Serial.println("  Plots: close the Serial Monitor, open Tools > Serial Plotter.");
  Serial.printf("  Gravity correction: %s\n", CAL_NAME[calMode]);
  if (camOk) Serial.printf("  Pictures: %s every %lu s (0 = off), budget %lu bytes/s\n",
                           frameSizeName(imgSize), (unsigned long)imgPeriodS, (unsigned long)linkBps);
  if (!clockFromUser) Serial.println("  >> Clock started from the compile time: type the date and time to set it exactly");
  Serial.println();
}

static void printPlot() {
  const Sample& s = last;
  switch (view) {
    case VIEW_PLOT_ANGLES:
      Serial.printf("roll:%.1f,pitch:%.1f\n", roll, pitch);
      break;
    case VIEW_PLOT_ACCEL:
      Serial.printf("ax:%.2f,ay:%.2f,az:%.2f,mag:%.2f\n", s.a[0] * G0, s.a[1] * G0, s.a[2] * G0,
                    G0 * sqrtf(s.a[0] * s.a[0] + s.a[1] * s.a[1] + s.a[2] * s.a[2]));
      break;
    case VIEW_PLOT_GYRO:
      Serial.printf("gx:%.2f,gy:%.2f,gz:%.2f\n", s.g[0], s.g[1], s.g[2]);
      break;
    case VIEW_PLOT_ENV:
      if (env.ever) Serial.printf("T:%.1f,RH:%.1f\n", env.t, env.h);
      break;
    default:
      break;
  }
}

// ------------------------------- INPUT ---------------------------------------
static void runKey(char c) {
  switch (tolower(c)) {
    case 'h': printHelp(); break;
    case 's': Serial.println(); Serial.println("I2C scan:"); i2cScan(); Serial.println(); break;
    case 'c': if (mpuReady) { Serial.println(); stillTest(); } break;
    case 'd': Serial.println(); dhtCheck(); break;
    case 'z': if (mpuReady) gravityFixZ(); else Serial.println("MPU-6050 not connected"); break;
    case '6': if (mpuReady) gravityFix6(); else Serial.println("MPU-6050 not connected"); break;
    case '0': clearCal(); break;
    case 'k':
      if (!camOk) Serial.println("Camera not working - see check [6/6]");
      else { snapRequested = true; Serial.println(img.sending || capBusy ? "Picture queued" : "Picture coming"); }
      break;
    case 'i': cycleImagePeriod(); break;
    case 'v': cycleImageSize(); break;
    case 'l': view = VIEW_LOG; break;
    case 'p': view = VIEW_PLOT_ANGLES; break;
    case 'a': view = VIEW_PLOT_ACCEL; break;
    case 'g': view = VIEW_PLOT_GYRO; break;
    case 'e': view = VIEW_PLOT_ENV; break;
    case 'x':
      paused = !paused;
      Serial.println(paused ? "-- paused, type x to resume --" : "-- resumed --");
      break;
    default:
      Serial.printf("Unknown key '%c' - type h for help\n", c);
      break;
  }
  restartLog();                                  // tests take seconds: start a fresh second
}

static void processLine() {
  inBuf[inLen] = 0;
  inLen = 0;
  char* t = inBuf;
  while (*t == ' ') t++;
  size_t len = strlen(t);
  while (len && t[len - 1] == ' ') t[--len] = 0;
  if (len == 0) return;

  int Y, M, D, h, m, sec;
  unsigned bps;
  if (sscanf(t, "bps %u", &bps) == 1) {
    if (bps < 300 || bps > 5000) { Serial.println("bps must be 300 - 5000"); return; }
    linkBps = bps;
    Serial.printf("Pictures may use %u bytes/s of the radio\n", bps);
    return;
  }
  if (sscanf(t, "%d-%d-%d %d:%d:%d", &Y, &M, &D, &h, &m, &sec) == 6) {
    if (Y < 2020 || Y > 2099 || M < 1 || M > 12 || D < 1 || D > 31 ||
        h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) {
      Serial.println("Date not valid - use  2026-10-19 19:30:00");
      return;
    }
    setClock(Y, M, D, h, m, sec);
  } else if (sscanf(t, "%d:%d:%d", &h, &m, &sec) == 3) {
    if (h < 0 || h > 23 || m < 0 || m > 59 || sec < 0 || sec > 59) {
      Serial.println("Time not valid - use  19:30:00");
      return;
    }
    time_t now = time(nullptr);
    struct tm tmv;
    localtime_r(&now, &tmv);
    setClock(tmv.tm_year + 1900, tmv.tm_mon + 1, tmv.tm_mday, h, m, sec);
  } else if (len == 1) {
    runKey(t[0]);
    return;
  } else {
    Serial.printf("Not understood: \"%s\" - type h for help\n", t);
    return;
  }
  clockFromUser = true;
  char ts[24];
  clockString(ts, sizeof(ts));
  Serial.printf("Dusk1-%s:> clock set\n", ts);
  restartLog();                                  // log lines now land on whole seconds
}

// Works with any Serial Monitor line ending: a line ends at Enter, or when
// nothing more arrives for 100 ms.
static void handleInput() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') { if (inLen) processLine(); continue; }
    if (inLen < sizeof(inBuf) - 1) inBuf[inLen++] = c;
    inLast = millis();
  }
  if (inLen && millis() - inLast > 100) processLine();
}

// ---------------------------- SETUP / LOOP -----------------------------------
void setup() {
  pinMode(PIN_FLASH, OUTPUT);
  digitalWrite(PIN_FLASH, LOW);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);                   // off

  Serial.setTxBufferSize(SERIAL_TX_BUF);         // must come before begin()
  Serial.begin(SERIAL_BAUD);
  setClockFromBuild();
  resetName = resetReasonName(esp_reset_reason());
  imgBuf = (uint8_t*)(psramFound() ? ps_malloc(IMG_BUF_BYTES) : malloc(32 * 1024));
  camOk = imgBuf && cameraStart();               // camera before our I2C bus
  dhtPinInit();
  delay(1500);                                   // time to open the Serial Monitor
  Serial.println();
  Serial.println("==========================================================");
  Serial.println(" DUSK-1 · telemetry + camera (MPU-6050 + DHT22 + OV2640 + SiK radio)");
  Serial.printf(" %s rev %d, %lu MHz, PSRAM %s\n", ESP.getChipModel(), ESP.getChipRevision(),
                (unsigned long)ESP.getCpuFreqMHz(), psramFound() ? "found" : "not found");
  Serial.printf(" MPU-6050 I2C IO14/IO15 at %d Hz · DHT22 IO13 every %d s · log every %d s\n",
                1000 / SAMPLE_MS, DHT_MS / 1000, LOG_MS / 1000);
  Serial.printf(" Telemetry: UART0 %d baud -> USB monitor + radio RX (IO1)\n", SERIAL_BAUD);
  Serial.printf(" Last reset: %s%s\n", resetName,
                strcmp(resetName, "brownout") == 0 ? "  <- 5 V dipped: set the radio to 100 mW (ATS4=20)" : "");
  Serial.println("==========================================================");

  loadCal();
  printCalLine();
  mpuReady = bringUpMpu();
  dhtCheck();
  cameraCheck();
  if (camOk) xTaskCreatePinnedToCore(camTaskFn, "cam", 4096, nullptr, 2, &camTaskHandle, 0);
  printHelp();
  {
    char ts[24];
    clockString(ts, sizeof(ts));
    bool envOk = env.ever;
    Serial.printf("Dusk1-%s:> boot | reset %s | mpu %s | dht %s | cam %s | gravity %s\n", ts, resetName,
                  mpuReady ? "ok" : "FAIL", envOk ? "ok" : "FAIL", camOk ? "ok" : "FAIL", CAL_NAME[calMode]);
  }
  tLastImg = millis() - imgPeriodS * 1000UL + 3000;   // first picture 3 s after start
  tokLast = millis();
  tokens = 300;
  tNextProbe = millis() + 3000;
  tNextDht = millis() + DHT_MS;
  restartLog();
}

void loop() {
  uint32_t now = millis();
  handleInput();

  // One log line every 1.000 s. The schedule adds exactly LOG_MS each time, so
  // the lines never drift (delay(1000) would drift and stop the sensor reads).
  if ((int32_t)(now - tNextLog) >= 0) {
    tNextLog += LOG_MS;
    if ((int32_t)(now - tNextLog) >= 0) tNextLog = now + LOG_MS;
    if (view == VIEW_LOG && !paused) printLogLine();
    else { acc = {}; errAtLog = i2cErrors; }
  }

  if (mpuReady) {
    if ((int32_t)(now - tNextSample) >= 0) {
      tNextSample += SAMPLE_MS;
      if ((int32_t)(now - tNextSample) >= 0) tNextSample = now + SAMPLE_MS;
      Sample s;
      if (readSample(s, true)) {
        updateAttitude(s, SAMPLE_MS / 1000.0f);
        last = s;
        haveLast = true;
        failsInRow = 0;
        addToLog(s);
      } else if (++failsInRow >= 20) {
        Serial.println("\n!! MPU-6050 stopped answering (20 reads in a row failed)");
        printMpuHelp();
        Serial.println();
        mpuReady = false;
        tNextProbe = now + 3000;
      }
    }
  } else if ((int32_t)(now - tNextProbe) >= 0) {   // wait for the MPU-6050 to come back
    tNextProbe = now + 3000;
    if (mpuAnswers()) {
      Serial.println("\nMPU-6050 answered - running its checks");
      mpuReady = bringUpMpu();
      restartLog();
    }
  }

  if ((int32_t)(now - tNextDht) >= 0) {           // DHT22: one measurement every 2 s
    tNextDht = now + DHT_MS;
    dhtRead();
  }

  refillTokens(now);
  imagingTask(now);
  if (view == VIEW_LOG && !paused) imageSendTask();

  if (view != VIEW_LOG && !paused && (int32_t)(now - tNextPrint) >= 0) {
    tNextPrint = now + PLOT_MS;
    printPlot();
  }

  bool envOk = env.ever && (millis() - env.okAt) < DHT_STALE_MS;
  uint32_t blink = (mpuReady && envOk) ? 500 : 100; // slow = all good, fast = a sensor is missing
  digitalWrite(PIN_LED, ((now / blink) % 2) ? LOW : HIGH);
  delay(1);
}
