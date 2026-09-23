#pragma once
#include <Arduino.h>
#include <HX711.h>

// โมดูลนี้แยกความรับผิดชอบเรื่อง "อ่านค่า + หักลบน้ำหนัก (tare)" ออกจากโค้ดหลัก
// เพื่อให้เรียกใช้กับโหลดเซลล์กี่ตัวก็ได้โดยไม่ปนกัน (ถังอาหาร 1 ตัว, ถาดอาหาร 1 ตัว)
class WeightSensor {
public:
    WeightSensor(uint8_t doutPin, uint8_t sckPin, float calibrationFactor);

    // เรียกครั้งเดียวใน setup() — มี wait_ready_timeout() แบบจำกัดเวลา ไม่บล็อกถาวร
    void begin();

    // สั่ง tare (หักลบน้ำหนักภาชนะ/จุดศูนย์) — ควรเรียกตอนถังว่าง/ถาดว่างเท่านั้น
    void tare(uint8_t samples = 10);

    // เรียกทุกรอบ loop() ได้เลย: จะอ่านค่าจริงเฉพาะตอน HX711 พร้อมข้อมูล (is_ready())
    // ถ้ายังไม่พร้อม จะคืนค่า false ทันทีโดยไม่หน่วงเวลา (non-blocking)
    bool update();

    float getWeightGrams() const;   // น้ำหนักสุทธิล่าสุด (กรัม) หลังหักลบ tare + calibration
    bool  isConnected() const;      // false ถ้า HX711 ไม่ตอบสนอง (สายหลุด/เสีย)

private:
    HX711 _scale;
    uint8_t _doutPin, _sckPin;
    float _calibrationFactor;
    float _currentWeight = 0.0f;
    bool  _connected = false;
    unsigned long _lastReadyMillis = 0;                 // เพิ่ม
    static const unsigned long CONNECTION_TIMEOUT_MS = 3000; 
};
