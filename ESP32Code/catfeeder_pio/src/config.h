#pragma once

// ================== WiFi ==================
#define WIFI_SSID       "AE_21"
#define WIFI_PASSWORD   "therapon"

// ================== MQTT ==================
#define MQTT_BROKER     "10.65.253.205"   // IP หรือ host ของ MQTT broker
#define MQTT_PORT       1883
#define MQTT_CLIENT_ID  "catfeeder_001"
#define DEVICE_ID       "catfeeder_001"   // ต้องตรงกับ device_id ที่ backend ใช้

// Topic ต้องตรงกับฝั่ง Node.js เป๊ะ ๆ
#define TOPIC_COMMAND   "catfeeder/control/command"
#define TOPIC_SET_TIME  "catfeeder/control/set-time"
#define TOPIC_STATUS    "catfeeder/control/data"   // topic ที่ ESP32 ส่งข้อมูลขึ้นไป (ต้อง subscribe topic นี้ฝั่ง server)

// ================== I2C (จอ + RTC ใช้บัสร่วมกัน) ==================
#define PIN_SDA         21
#define PIN_SCL         22
#define OLED_ADDR       0x3C

// ================== HX711 โหลดเซลล์ ==================
#define PIN_HOPPER_DOUT 16   // ถังเก็บอาหาร
#define PIN_HOPPER_SCK  17
#define PIN_BOWL_DOUT   4   // ถาดอาหาร
#define PIN_BOWL_SCK    5

// ค่า calibration factor ต้องปรับเทียบเองด้วยน้ำหนักมาตรฐานจริง
#define CAL_FACTOR_HOPPER  -702.51f
#define CAL_FACTOR_BOWL    -673.23f

// น้ำหนักเปลี่ยนแปลงขั้นต่ำ (กรัม) ถึงจะถือว่า "เปลี่ยนจริง" แล้วค่อยส่งขึ้น MQTT
#define WEIGHT_CHANGE_THRESHOLD_G  10.0f

// ถ้าน้ำหนักในถาด (bowl) มากกว่าค่านี้ (กรัม) ถือว่าอาหารยังเหลือเยอะ -> ไม่ให้อาหารเพิ่ม
#define BOWL_FULL_THRESHOLD_G      30.0f

// ================== เซอร์โว ==================
#define PIN_SERVO             15
#define SERVO_STOP_SPEED      90
#define SERVO_FEED_SPEED      0
#define TIME_PER_ROTATION_MS  1500   // เวลาที่เปิดเซอร์โวต่อ 1 portion
#define SERVO_MOVE_TIME_MS    300    // เวลาประมาณที่เซอร์โวใช้เคลื่อนที่ปิด
#define PORTION_PAUSE_MS      500    // เวลาหยุดพักระหว่าง portion ถ้าสั่งมากกว่า 1

// ================== ปุ่มกด ==================
#define PIN_BUTTON      33
#define DEBOUNCE_MS     50

// ================== ตารางเวลา ==================
#define MAX_SCHEDULE_SLOTS 8
#define PREFS_NAMESPACE    "catfeeder"

// ================== ช่วงเวลาทำงานแบบ non-blocking ==================
#define WIFI_RETRY_INTERVAL_MS     5000
#define MQTT_RETRY_INTERVAL_MS     5000
#define DISPLAY_UPDATE_INTERVAL_MS 500
#define SCHEDULE_CHECK_INTERVAL_MS 1000
#define STATUS_CHECK_INTERVAL_MS   1000   // ความถี่ในการ "เช็ค" ว่าค่าเปลี่ยนหรือยัง (ไม่ใช่ความถี่ในการส่ง)

// เปิด/ปิดการ sync เวลาจาก NTP ตอน WiFi ต่อติดครั้งแรก (ช่วยตั้ง RTC ให้แม่นยำ)
#define ENABLE_NTP_SYNC     true
#define NTP_GMT_OFFSET_SEC  (7 * 3600)   // GMT+7 ประเทศไทย
#define NTP_SERVER          "pool.ntp.org"
