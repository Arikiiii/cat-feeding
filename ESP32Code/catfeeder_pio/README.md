# เครื่องให้อาหารแมวอัตโนมัติ - ESP32 (PlatformIO)

## โครงสร้างไฟล์
```
catfeeder_pio/
├── platformio.ini        ← กำหนดบอร์ด + library ทั้งหมด (ไม่ต้องติดตั้งเอง)
└── src/
    ├── main.cpp           ← ไฟล์หลัก
    ├── config.h           ← ขา, WiFi, MQTT, ค่า calibration
    ├── WeightSensor.h
    └── WeightSensor.cpp   ← โมดูลแยกสำหรับอ่าน/หักลบน้ำหนักโหลดเซลล์
```
เปิดโฟลเดอร์ `catfeeder_pio` ทั้งโฟลเดอร์ด้วย VS Code + PlatformIO extension (File > Open Folder) แล้วกด Build/Upload ได้เลย ไม่ต้องติดตั้ง library เองเพราะกำหนดไว้ใน `lib_deps` ของ `platformio.ini` แล้ว PlatformIO จะโหลดให้อัตโนมัติตอน build ครั้งแรก

## ปรับ board ให้ตรงรุ่น
ค่าเริ่มต้นใน `platformio.ini` คือ `board = esp32dev` (ESP32 DevKit ทั่วไป 30/38 ขา) ถ้าใช้บอร์ดรุ่นอื่นเช็ครายชื่อ board id ได้ด้วยคำสั่ง:
```
pio boards espressif32 | grep -i esp32
```

## สิ่งที่ต้องแก้ก่อนอัปโหลดใน `src/config.h`
1. `WIFI_SSID`, `WIFI_PASSWORD`
2. `MQTT_BROKER` — IP/host ของ broker เดียวกับที่ฝั่ง Node.js เชื่อมอยู่
3. `DEVICE_ID` — ต้องตรงกับ `device_id` ที่ backend ใช้เรียก API
4. `CAL_FACTOR_HOPPER`, `CAL_FACTOR_BOWL` — **ต้อง calibrate เองด้วยน้ำหนักมาตรฐานจริง**

## ข้อแตกต่างจากเวอร์ชัน Arduino IDE (.ino)
- ไฟล์หลักเปลี่ยนชื่อเป็น `main.cpp` และเพิ่ม `#include <Arduino.h>` บรรทัดแรก (PlatformIO ไม่ include ให้อัตโนมัติเหมือน Arduino IDE)
- เพิ่มบล็อก **function prototypes** ไว้ก่อน `setup()` เพราะไฟล์ `.cpp` ธรรมดาต้องประกาศฟังก์ชันก่อนถูกเรียกใช้งาน (ไม่เหมือน `.ino` ที่ Arduino IDE gen prototype ให้อัตโนมัติ)
- library ทุกตัวประกาศผ่าน `lib_deps` ใน `platformio.ini` แทนการติดตั้งผ่าน Library Manager ของ Arduino IDE

## ⚠️ สิ่งที่ต้องแก้ฝั่ง Node.js เพิ่ม
`/api/feeder/feed-now` ตอน publish `commandPayload` **ไม่ได้แนบ `device_id`** ไปด้วย (มีแค่ `set-schedule` เท่านั้น) ถ้ามี ESP32 มากกว่า 1 เครื่อง subscribe topic เดียวกันจะสั่งพร้อมกันหมด แนะนำแก้เป็น:
```javascript
const commandPayload = JSON.stringify({
    action: 'feed_now',
    device_id: device_id,   // เพิ่มบรรทัดนี้
    portion: portion || 1,
    timestamp: Date.now()
});
```
โค้ด ESP32 ฝั่ง `set-schedule` เช็ค `device_id` อยู่แล้ว ถ้าอยากกรองที่ `feed_now` ด้วยก็เพิ่มเช็คแบบเดียวกันใน `mqttCallback` ส่วน `TOPIC_COMMAND`

backend ต้อง **subscribe** topic `catfeeder/status/data` (ตาม `TOPIC_STATUS` ใน `config.h`) ผ่าน `mqttConnect()` ที่มีอยู่แล้ว เพื่อรับน้ำหนัก/สถานะจาก ESP32

## รูปแบบเวลาตารางเวลา
`times` ใน payload ของ `catfeeder/control/set-time` ต้องเป็น array ของ string `"HH:MM"` เช่น `["07:00", "12:30", "18:00"]`

## หลักการทำงานสำคัญ
- **Non-blocking**: ไม่มี `delay()` ในลูปหลัก ใช้ `millis()` เทียบเวลาทั้งหมด
- **จำตารางเวลา** ผ่าน `Preferences` (Flash) ไฟดับ/รีเซ็ตก็ไม่หาย
- **ส่งขึ้น MQTT เฉพาะตอนเปลี่ยนจริง**: เทียบกับค่าที่ส่งไปล่าสุด ต่างเกิน `WEIGHT_CHANGE_THRESHOLD_G` (ค่าเริ่มต้น 2 กรัม) หรือสถานะเปลี่ยน
- **RTC + NTP**: sync เวลาจาก NTP เข้า RTC อัตโนมัติครั้งแรกหลัง WiFi ต่อติด

## ผังขา
| อุปกรณ์ | ขา |
|---|---|
| OLED SH1106G + RTC DS3231 (I2C ร่วม) | SDA=21, SCL=22 |
| โหลดเซลล์ถังอาหาร (HX711) | DOUT=16, SCK=17 |
| โหลดเซลล์ถาดอาหาร (HX711) | DOUT=18, SCK=19 |
| เซอร์โว | GPIO 23 |
| ปุ่มกด | GPIO 33 (INPUT_PULLUP) |
