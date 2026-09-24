
/*
  ===========================================================
   เครื่องให้อาหารแมวอัตโนมัติ - ESP32 (PlatformIO)
  ===========================================================
  lib_deps ทั้งหมดกำหนดไว้ใน platformio.ini แล้ว ไม่ต้องติดตั้งเอง
  แค่สั่ง "PlatformIO: Build" ตัวเครื่องมือจะโหลด library ให้อัตโนมัติ

  คุณสมบัติ:
    - ปุ่มกด (pin 33) กดแล้วปล่อยอาหารทันที
    - จอ OLED แสดงสถานะ WiFi/MQTT, น้ำหนักถัง, น้ำหนักถาด, เวลาที่ตั้งไว้
    - ทำงานแบบ non-blocking ทั้งหมด (ไม่มี delay() ในระบบหลัก)
    - ทำงานได้แม้ไม่มีอินเทอร์เน็ต/ไม่เชื่อม MQTT (ตารางเวลายังทำงาน)
    - จำตารางเวลาไว้ใน Flash (Preferences) ไม่หายตอนไฟดับ
    - ส่งสถานะขึ้น MQTT เฉพาะตอนค่าที่ตรวจสอบแล้ว "เปลี่ยนจริง" เท่านั้น
  ===========================================================
*/

#include <Arduino.h>          // จำเป็นสำหรับ PlatformIO (ต่างจาก Arduino IDE ที่ include ให้อัตโนมัติ)
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Ds1302.h>
#include <ESP32Servo.h>
#include <Preferences.h>
#include <time.h>
#include <NTPClient.h>
#include "config.h"
#include "WeightSensor.h"

// ------------------- Global objects -------------------
WiFiClient        wifiClient;
PubSubClient      mqttClient(wifiClient);
Adafruit_SH1106G  display(128, 64, &Wire, -1);

const int PIN_ENA = 19;  // DAT / IO
const int PIN_CLK = 18;  // SCLK / CLK
const int PIN_DAT = 23;  // CE / ENA

Ds1302 rtc(PIN_ENA, PIN_CLK, PIN_DAT);
// NTP Client สำหรับดึงเวลาอินเทอร์เน็ต
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 25200, 60000); // 25200 = UTC+7 (เวลาประเทศไทย)


Servo             feederServo;
Preferences       prefs;

WeightSensor hopperSensor(PIN_HOPPER_DOUT, PIN_HOPPER_SCK, CAL_FACTOR_HOPPER);
WeightSensor bowlSensor(PIN_BOWL_DOUT, PIN_BOWL_SCK, CAL_FACTOR_BOWL);

// ------------------- สถานะเครื่อง -------------------
enum FeederStatus { STATUS_IDLE, STATUS_FEEDING, STATUS_ERROR };
FeederStatus currentStatus = STATUS_IDLE;

const char* statusToString(FeederStatus s) {
    switch (s) {
        case STATUS_FEEDING: return "feeding";
        case STATUS_ERROR:   return "error";
        default:              return "idle";
    }
}

// ------------------- ตัวแปรสำหรับตรวจสอบ "การเปลี่ยนแปลงจริง" ก่อนส่ง MQTT -------------------
struct LastPublished {
    float hopperWeight = -999999.0f;
    float bowlWeight   = -999999.0f;
    FeederStatus status = STATUS_IDLE;
    bool everPublished = false;
} lastPublished;

// ------------------- ตารางเวลา (เก็บใน Preferences) -------------------
uint8_t scheduleHour[MAX_SCHEDULE_SLOTS];
uint8_t scheduleMinute[MAX_SCHEDULE_SLOTS];
uint8_t schedulePortion[MAX_SCHEDULE_SLOTS]; // ถ้าอยากแยกพอร์ชั่นแต่ละเวลา
uint8_t scheduleCount = 0;
int16_t lastTriggeredTotalMinutes = -1;   // กันยิงซ้ำในนาทีเดียวกัน

// ------------------- ตัวแปรจับเวลาแบบ non-blocking -------------------
unsigned long lastWifiAttempt   = 0;
unsigned long lastMqttAttempt   = 0;
unsigned long lastDisplayUpdate = 0;
unsigned long lastScheduleCheck = 0;
unsigned long lastStatusCheck   = 0;
bool ntpSynced = false;

// ------------------- ปุ่มกด (debounce) -------------------
int lastButtonReading = HIGH;
int buttonState        = HIGH;
unsigned long lastDebounceTime = 0;

// ------------------- state machine เครื่องจ่ายอาหาร -------------------
enum FeedState { FS_IDLE, FS_DISPENSING, FS_CLOSING, FS_PAUSE_BETWEEN };
FeedState feedState = FS_IDLE;
unsigned long feedStateStart = 0;
uint8_t portionsRemaining = 0;

// ============================================================
//   Function prototypes — จำเป็นสำหรับ PlatformIO/.cpp เพราะ
//   ไม่มีการ auto-generate prototype ให้เหมือน Arduino IDE (.ino)
// ============================================================
void handleWiFi();
void syncTimeFromNTP();
void handleMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void saveScheduleToPrefs();
void loadScheduleFromPrefs();
void checkSchedule();
bool getNextScheduleString(char* out, size_t outLen);
void handleButton();
void startFeeding(uint8_t portions, bool checkBowlWeight = true);
void updateFeedingStateMachine();
void checkAndPublishIfChanged();
void publishStatus(float hopperW, float bowlW);
void updateDisplay();

// ============================================================
//                         SETUP
// ============================================================
void setup() {
    Serial.begin(115200);
    delay(100); // ดีเลย์สั้น ๆ ตอนบูตเท่านั้น ไม่กระทบ non-blocking loop

    pinMode(PIN_BUTTON, INPUT_PULLDOWN); // ปุ่มกดต่อกับ GND

    Wire.begin(PIN_SDA, PIN_SCL);

    // --- จอ OLED ---
    if (!display.begin(OLED_ADDR, true)) {
        Serial.println("⚠️ ไม่พบจอ SH1106G");
    }
    display.clearDisplay();
    display.setTextColor(SH110X_WHITE);
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("Cat Feeder booting...");
    display.display();

    rtc.init();

    // --- โหลดเซลล์ ---
    hopperSensor.begin();
    bowlSensor.begin();

    // --- เซอร์โว ---
    feederServo.attach(PIN_SERVO);
    feederServo.write(SERVO_STOP_SPEED); // หยุดนิ่งตอนเริ่มต้น

    // --- โหลดตารางเวลาที่จำไว้ ---
    loadScheduleFromPrefs();

    // --- เริ่มเชื่อม WiFi (non-blocking, ทำงานเบื้องหลัง) ---
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    // --- ตั้งค่า MQTT ---
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);

    Serial.println("✅ Setup เสร็จสิ้น เริ่มทำงาน");
}

// ============================================================
//                          LOOP
// ============================================================
void loop() {
    handleWiFi();
    handleMQTT();
    handleButton();

    hopperSensor.update();
    bowlSensor.update();

    updateFeedingStateMachine();
    checkSchedule();
    checkAndPublishIfChanged();
    updateDisplay();
}

// ============================================================
//                    WiFi / MQTT (non-blocking)
// ============================================================
void handleWiFi() {
    if (WiFi.status() == WL_CONNECTED) {
        // sync เวลาจาก NTP แค่ครั้งแรกหลังต่อ WiFi ติด
        if (ENABLE_NTP_SYNC && !ntpSynced) {
            syncTimeFromNTP();
        }
        return;
    }
    unsigned long now = millis();
    if (now - lastWifiAttempt >= WIFI_RETRY_INTERVAL_MS) {
        lastWifiAttempt = now;
        Serial.println("🔄 พยายามเชื่อมต่อ WiFi...");
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // ไม่บล็อก เชื่อมต่อ background
        ntpSynced = false;
    }
}

void syncTimeFromNTP() {
    // ตั้งค่า NTP (GMT+7 สำหรับประเทศไทย = 25200 วินาที)
    configTime(25200, 0, "pool.ntp.org", "time.nist.gov");
    
    Serial.println("🔄 กำลังซิงค์เวลาจาก NTP...");
    struct tm timeinfo;
    
    int retry = 0;
    while (!getLocalTime(&timeinfo) && retry < 10) {
        delay(500);
        Serial.print(".");
        retry++;
    }
    Serial.println();

    if (retry < 10) {
        // สร้างโครงสร้างเก็บเวลาของ DS1302
        Ds1302::DateTime dt;
        dt.year   = timeinfo.tm_year + 1900 - 2000; // DS1302 เก็บปี ค.ศ. เป็น 2 หลักท้าย (เช่น 2026 -> 26)
        dt.month  = timeinfo.tm_mon + 1;            // เดือน 1-12
        dt.day    = timeinfo.tm_mday;               // วันที่ 1-31
        dt.dow    = timeinfo.tm_wday == 0 ? 7 : timeinfo.tm_wday; // วันในสัปดาห์ (1-7)
        dt.hour   = timeinfo.tm_hour;               // 0-23
        dt.minute = timeinfo.tm_min;                // 0-59
        dt.second = timeinfo.tm_sec;                // 0-59

        // บันทึกลงโมดูล DS1302
        rtc.setDateTime(&dt);
        
        Serial.println("🕒 Sync เวลาจาก NTP เข้า DS1302 สำเร็จ!");
        ntpSynced = true;
    } else {
        Serial.println("⚠️ ไม่สามารถดึงเวลาจาก NTP ได้ ใช้เวลาเดิมจาก DS1302 ไปก่อน");
        ntpSynced = false;
    }
}

void handleMQTT() {
    if (WiFi.status() != WL_CONNECTED) return;

    if (!mqttClient.connected()) {
        unsigned long now = millis();
        if (now - lastMqttAttempt >= MQTT_RETRY_INTERVAL_MS) {
            lastMqttAttempt = now;
            Serial.println("🔄 พยายามเชื่อมต่อ MQTT...");
            if (mqttClient.connect(MQTT_CLIENT_ID)) {
                Serial.println("✅ MQTT เชื่อมต่อสำเร็จ");
                mqttClient.subscribe(TOPIC_COMMAND);
                mqttClient.subscribe(TOPIC_SET_TIME);
                // เชื่อมใหม่ทีไร บังคับส่งสถานะล่าสุดอีกครั้งให้ server อัปเดต
                lastPublished.everPublished = false;
            }
        }
    } else {
        mqttClient.loop();
    }
}

// ============================================================
//                      MQTT callback
// ============================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        Serial.print("❌ JSON parse error: ");
        Serial.println(err.c_str());
        return;
    }

    String t = String(topic);

    if (t == TOPIC_COMMAND) {
        // ถ้า payload มี device_id มาด้วย และไม่ตรงกับเครื่องนี้ ให้ข้าม
        if (doc.containsKey("device_id")) {
            const char* devId = doc["device_id"] | "";
            if (strcmp(devId, DEVICE_ID) != 0) {
                return;
            }
        }
        
        const char* action = doc["action"] | "";
        if (strcmp(action, "feed_now") == 0) {
            uint8_t portion = doc["portion"] | 1;
            Serial.printf("📥 คำสั่ง feed_now จาก MQTT (manual/หน้าเว็บ), portion=%d ไม่เช็คน้ำหนักถาด\n", portion);
            startFeeding(portion, false); // manual: ไม่เช็คน้ำหนัก bowl
        }
    }
   else if (t == TOPIC_SET_TIME) {
        // ถ้า payload มี device_id มาด้วย และไม่ตรงกับเครื่องนี้ ให้ข้าม
        if (doc.containsKey("device_id")) {
            const char* devId = doc["device_id"] | "";
            if (strcmp(devId, DEVICE_ID) != 0) {
                return;
            }
        }

        JsonArray times = doc["times"].as<JsonArray>();
        if (times.isNull()) return;

        // เริ่มบันทึกค่าลงตัวแปรชั่วคราวก่อน
        uint8_t tempHours[MAX_SCHEDULE_SLOTS];
        uint8_t tempMinutes[MAX_SCHEDULE_SLOTS];
        uint8_t tempPortions[MAX_SCHEDULE_SLOTS];
        uint8_t tempCount = 0;

        // รองรับกรณีส่ง portion มาเป็นค่าเดียวรวม หรือส่งมาเป็นอาเรย์คู่กัน
        uint8_t defaultPortion = doc["portion"] | 1;

        for (JsonVariant v : times) {
            if (tempCount >= MAX_SCHEDULE_SLOTS) break;
            
            // รองรับทั้งแบบส่งมาเป็น String "HH:MM" หรือ Object {"time": "HH:MM", "portion": 2}
            const char* timeStr = nullptr;
            uint8_t pVal = defaultPortion;

            if (v.is<JsonObject>()) {
                JsonObject timeObj = v.as<JsonObject>();
                timeStr = timeObj["time"] | "";
                pVal = timeObj["portion"] | defaultPortion;
            } else {
                timeStr = v.as<const char*>();
            }

            if (timeStr == nullptr) continue;

            int h = -1, m = -1;
            if (sscanf(timeStr, "%d:%d", &h, &m) == 2 && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
                tempHours[tempCount]   = (uint8_t)h;
                tempMinutes[tempCount] = (uint8_t)m;
                tempPortions[tempCount]= pVal;
                tempCount++;
            }
        }

        // อัปเดตเข้าตัวแปรหลักของเครื่อง
        scheduleCount = tempCount;
        for (int i = 0; i < scheduleCount; i++) {
            scheduleHour[i]   = tempHours[i];
            scheduleMinute[i] = tempMinutes[i];
            schedulePortion[i]= tempPortions[i];
        }

        // บันทึกลง Flash Memory แบบอาเรย์ (ให้ตรงกับตอนโหลดด้วย getBytes)
        prefs.begin(PREFS_NAMESPACE, false);
        prefs.putUChar("count", scheduleCount);
        prefs.putBytes("hours", scheduleHour, scheduleCount);
        prefs.putBytes("mins", scheduleMinute, scheduleCount);
        prefs.putBytes("portions", schedulePortion, scheduleCount);
        prefs.end();

        Serial.printf("💾 บันทึกตารางเวลาลง Flash เรียบร้อยแล้ว (%d รายการ)\n", scheduleCount);
    }
}

// ============================================================
//                   ตารางเวลา (Preferences)
// ============================================================
void saveScheduleToPrefs() {
    prefs.begin(PREFS_NAMESPACE, false);
    prefs.putUChar("count", scheduleCount);
    prefs.putBytes("hours", scheduleHour, scheduleCount);
    prefs.putBytes("mins", scheduleMinute, scheduleCount);
    prefs.end();
}

void loadScheduleFromPrefs() {
    prefs.begin(PREFS_NAMESPACE, true);
    scheduleCount = prefs.getUChar("count", 0);
    if (scheduleCount > MAX_SCHEDULE_SLOTS) scheduleCount = MAX_SCHEDULE_SLOTS;
    
    prefs.getBytes("hours", scheduleHour, scheduleCount);
    prefs.getBytes("mins", scheduleMinute, scheduleCount);
    
    // เพิ่มการโหลดพอร์ชั่นของแต่ละรอบเวลา
    prefs.getBytes("portions", schedulePortion, scheduleCount);
    
    prefs.end();
    Serial.printf("📂 โหลดตารางเวลาจากหน่วยความจำ: %d รายการ\n", scheduleCount);
}

void checkSchedule() {
    unsigned long now = millis();
    if (now - lastScheduleCheck < SCHEDULE_CHECK_INTERVAL_MS) return;
    lastScheduleCheck = now;

    // เปลี่ยนมาดึงเวลาด้วย DS1302
    Ds1302::DateTime t;
    rtc.getDateTime(&t);
    
    // ใช้ t.hour และ t.minute ตรงๆ
    int16_t totalMinutes = t.hour * 60 + t.minute;

    if (totalMinutes == lastTriggeredTotalMinutes) return; // กันยิงซ้ำในนาทีเดียวกัน

    for (uint8_t i = 0; i < scheduleCount; i++) {
        int16_t slotMinutes = scheduleHour[i] * 60 + scheduleMinute[i];
        if (slotMinutes == totalMinutes) {
            Serial.printf("⏰ ถึงเวลาให้อาหารตามตาราง %02d:%02d\n", scheduleHour[i], scheduleMinute[i]);
            startFeeding(schedulePortion[i]);
            lastTriggeredTotalMinutes = totalMinutes;
            break;
        }
    }
}

// หาเวลาให้อาหารครั้งถัดไปเพื่อแสดงบนจอ
bool getNextScheduleString(char* out, size_t outLen) {
    if (scheduleCount == 0) return false;

    Ds1302::DateTime t;
    rtc.getDateTime(&t);
        
    int16_t nowMinutes = t.hour * 60 + t.minute;

    int16_t bestDiff = 24 * 60 + 1;
    int bestIdx = -1;
    for (uint8_t i = 0; i < scheduleCount; i++) {
        int16_t slotMinutes = scheduleHour[i] * 60 + scheduleMinute[i];
        int16_t diff = slotMinutes - nowMinutes;
        if (diff <= 0) diff += 24 * 60; // ข้ามไปวันถัดไป
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }
    if (bestIdx < 0) return false;
    snprintf(out, outLen, "%02d:%02d", scheduleHour[bestIdx], scheduleMinute[bestIdx]);
    return true;
}

// ============================================================
//                       ปุ่มกด (debounce)
// ============================================================
void handleButton() {
    int reading = digitalRead(PIN_BUTTON);

    if (reading != lastButtonReading) {
        lastDebounceTime = millis();
    }

    if ((millis() - lastDebounceTime) > DEBOUNCE_MS) {
        if (reading != buttonState) {
            buttonState = reading;
            if (buttonState == HIGH) { // กด (ใช้ INPUT_PULLUP: กด = LOW)
                Serial.println("🔘 กดปุ่ม -> ปล่อยอาหารทันที (ไม่เช็คน้ำหนักถาด)");
                startFeeding(1, false); // manual: ไม่เช็คน้ำหนัก bowl
            }
        }
    }
    lastButtonReading = reading;
}

// ============================================================
//               เครื่องจ่ายอาหาร (state machine, non-blocking)
// ============================================================


void startFeeding(uint8_t portions, bool checkBowlWeight) {
    if (feedState != FS_IDLE) {
        Serial.println("⚠️ กำลังจ่ายอาหารอยู่ ข้ามคำสั่งซ้อน");
        return;
    }

    // ถ้าในถาดยังมีอาหารเหลือเกินเกณฑ์ ไม่ต้องจ่ายเพิ่ม (กันอาหารล้นถาด)
    // เช็คเฉพาะตอนเซนเซอร์ถาดเชื่อมต่ออยู่จริง ถ้าหลุดอยู่ก็ยังให้ทำงานตามปกติ
    // ไม่งั้นถ้าเซนเซอร์เสีย เครื่องจะไม่มีวันให้อาหารได้เลย
    // เช็คเฉพาะตอนให้อาหารอัตโนมัติตามตารางเวลาเท่านั้น (checkBowlWeight = true)
    // ส่วนกดปุ่มที่ตัวเครื่อง / สั่งจากหน้าเว็บ (MQTT feed_now) ให้ข้ามเช็คนี้เสมอ
    if (checkBowlWeight && bowlSensor.isConnected() && bowlSensor.getWeightGrams() > BOWL_FULL_THRESHOLD_G) {
        Serial.printf("🚫 ข้ามการให้อาหารอัตโนมัติ: น้ำหนักในถาดยังเหลือ %.2f g (เกณฑ์ %.1f g)\n",
                      bowlSensor.getWeightGrams(), BOWL_FULL_THRESHOLD_G);
        return;
    }

    if (portions == 0) portions = 1;

    portionsRemaining = portions;
    
    // เริ่มสั่งให้เซอร์โว 360 หมุนเดินหน้า
    feederServo.write(SERVO_FEED_SPEED); 
    
    feedState = FS_DISPENSING;
    feedStateStart = millis();
    currentStatus = STATUS_FEEDING;
}

void updateFeedingStateMachine() {
    unsigned long now = millis();

    switch (feedState) {
        case FS_IDLE:
            break;

        case FS_DISPENSING:
            // หมุนครบเวลาของ 1 พชั่นหรือยัง (ใช้เวลาตามที่จูน 1 รอบ)
            if (now - feedStateStart >= TIME_PER_ROTATION_MS) {
                // ครบ 1 รอบแล้ว ให้สั่งหยุดก่อนชั่วคราว
                feederServo.write(SERVO_STOP_SPEED); 
                
                portionsRemaining--;
                if (portionsRemaining > 0) {
                    // ถ้ายังมีพชั่นเหลือ ให้พักรอก่อนเริ่มรอบถัดไป
                    feedState = FS_PAUSE_BETWEEN;
                    feedStateStart = now;
                } else {
                    // ครบทุกพชั่นแล้ว กลับสู่สถานะ IDLE
                    feedState = FS_IDLE;
                    currentStatus = STATUS_IDLE;
                    Serial.println("✅ จ่ายอาหารเสร็จสิ้น");
                }
            }
            break;

        case FS_CLOSING:
            // (สถานะนี้อาจจะไม่จำเป็นแล้วสำหรับเซอร์โว 360 แต่ถ้าโครงสร้างเดิมมีไว้ สามารถข้ามหรือปรับใช้ได้ครับ)
            break;

        case FS_PAUSE_BETWEEN:
            // พักระหว่างรอจ่ายพชั่นถัดไป (เช่น 1 วินาที)
            if (now - feedStateStart >= PORTION_PAUSE_MS) {
                // เริ่มหมุนต่อสำหรับพชั่นถัดไป
                feederServo.write(SERVO_FEED_SPEED);
                feedState = FS_DISPENSING;
                feedStateStart = now;
            }
            break;
    }
}

// ============================================================
//         ตรวจสอบการเปลี่ยนแปลงจริง แล้วค่อยส่ง MQTT
// ============================================================
void checkAndPublishIfChanged() {
    unsigned long now = millis();
    if (now - lastStatusCheck < STATUS_CHECK_INTERVAL_MS) return;
    lastStatusCheck = now;

    // อัปเดตสถานะ error ถ้าเซนเซอร์หลุด (แต่ไม่ทับสถานะ feeding ที่กำลังทำงานอยู่)
    if (feedState == FS_IDLE) {
        if (!hopperSensor.isConnected() || !bowlSensor.isConnected()) {
            currentStatus = STATUS_ERROR;
        } else {
            currentStatus = STATUS_IDLE;
        }
    }

    float hopperW = hopperSensor.getWeightGrams();
    float bowlW   = bowlSensor.getWeightGrams();

    bool weightChanged =
        fabs(hopperW - lastPublished.hopperWeight) >= WEIGHT_CHANGE_THRESHOLD_G ||
        fabs(bowlW   - lastPublished.bowlWeight)   >= WEIGHT_CHANGE_THRESHOLD_G;

    bool statusChanged = (currentStatus != lastPublished.status);

    // ส่งเฉพาะตอนมีอะไรเปลี่ยนจริง ๆ (หรือยังไม่เคยส่งเลยตั้งแต่ต่อ MQTT ติด)
    if (!lastPublished.everPublished || weightChanged || statusChanged) {
        publishStatus(hopperW, bowlW);
        lastPublished.hopperWeight = hopperW;
        lastPublished.bowlWeight   = bowlW;
        lastPublished.status       = currentStatus;
        lastPublished.everPublished = true;
    }
}

void publishStatus(float hopperW, float bowlW) {
    if (!mqttClient.connected()) return; // ออฟไลน์ก็แค่ข้าม รอบหน้าค่อยเช็คใหม่

    // จำกัดทศนิยมเหลือ 2 ตำแหน่งแบบ string ก่อน แล้วค่อยแทรกเป็นตัวเลข JSON ดิบ
    // (ถ้าแค่ปัดค่า float เฉยๆ ปัญหาการเก็บเลขฐาน 2 ของ float อาจทำให้ตอน serialize
    //  หลุดทศนิยมยาวกลับมาได้อีก เช่น 82.33 อาจกลายเป็น 82.3299999...)
    char hopperStr[16];
    char bowlStr[16];
    snprintf(hopperStr, sizeof(hopperStr), "%.2f", hopperW);
    snprintf(bowlStr,   sizeof(bowlStr),   "%.2f", bowlW);

    StaticJsonDocument<256> doc;
    doc["device_id"]       = DEVICE_ID;
    doc["hopper_weight_g"] = serialized(hopperStr);
    doc["bowl_weight_g"]   = serialized(bowlStr);
    doc["feeder_status"]   = statusToString(currentStatus);

    char buffer[256];
    size_t n = serializeJson(doc, buffer);

    if (mqttClient.publish(TOPIC_STATUS, buffer, n)) {
        Serial.print("🚀 ส่งสถานะขึ้น MQTT: ");
        Serial.println(buffer);
    } else {
        Serial.println("❌ ส่งสถานะขึ้น MQTT ไม่สำเร็จ");
    }
}

// ============================================================
//                          จอแสดงผล
// ============================================================
void updateDisplay() {
    unsigned long now = millis();
    if (now - lastDisplayUpdate < DISPLAY_UPDATE_INTERVAL_MS) return;
    lastDisplayUpdate = now;

    bool wifiOk = (WiFi.status() == WL_CONNECTED);
    bool mqttOk = mqttClient.connected();

    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 0);

    // แถวสถานะการเชื่อมต่อ
    display.print("WiFi:");
    display.print(wifiOk ? "OK" : "--");
    display.print("  MQTT:");
    display.println(mqttOk ? "OK" : "--");

    display.drawLine(0, 10, 128, 10, SH110X_WHITE);

    // น้ำหนัก
    display.setCursor(0, 14);
    display.print("Hopper: ");
    display.print(hopperSensor.getWeightGrams(), 1);
    display.println(" g");

    display.setCursor(0, 24);
    display.print("Bowl  : ");
    display.print(bowlSensor.getWeightGrams(), 1);
    display.println(" g");

    // สถานะเครื่อง
    display.setCursor(0, 36);
    display.print("Status: ");
    display.println(statusToString(currentStatus));

    // เวลาปัจจุบันจาก RTC
    Ds1302::DateTime t;
    rtc.getDateTime(&t);

    display.setCursor(0, 46);
    display.printf("Time: %02d:%02d:%02d\n", t.hour, t.minute, t.second);

    // เวลาให้อาหารครั้งถัดไป
    display.setCursor(0, 56);
    char nextTime[8];
    if (getNextScheduleString(nextTime, sizeof(nextTime))) {
        display.print("Next: ");
        display.print(nextTime);
    } else {
        display.print("Next: --:--");
    }

    display.display();
}
