# 📥 คู่มือการติดตั้งและตั้งค่า Eclipse Mosquitto (MQTT Broker) บน Windows

คู่มือนี้อธิบายวิธีการติดตั้งและตั้งค่า **Eclipse Mosquitto** เพื่อใช้งานเป็น Private MQTT Broker บนระบบปฏิบัติการ Windows สำหรับโปรเจกต์ IoT (เช่น ESP32 ร่วมกับ Node.js)

---

## 1. ขั้นตอนการติดตั้ง (Installation)

1. ดาวน์โหลดโปรแกรมติดตั้ง Mosquitto สำหรับ Windows ได้ที่เว็บไซต์ทางการ:
   * [https://mosquitto.org/download/](https://mosquitto.org/download/)
   * เลือกเวอร์ชันที่เหมาะสม (แนะนำ Windows 64-bit installer)
2. ดับเบิ้ลคลิกไฟล์ที่ดาวน์โหลดมา และกด **Next** ไปเรื่อยๆ จนสิ้นสุดการติดตั้ง (แนะนำให้เลือกติดตั้งเป็น Windows Service เพื่อให้รันอัตโนมัติ)

---

## 2. การตั้งค่า Configuration

หลังจากติดตั้งเสร็จเรียบร้อย ให้ทำการแก้ไขไฟล์คอนฟิกเพื่อเปิดรับการเชื่อมต่อ:

1. เปิด Command Prompt (CMD) หรือ PowerShell แล้วเข้าไปยังโฟลเดอร์ที่ติดตั้งโปรแกรม:
   ```bash
   cd "C:\Program Files\mosquitto"

เปิดไฟล์ mosquitto.conf
เพิ้่ม
listener 1883
allow_anonymous true

mqtt://localhost:1883

*** อย่าด่าผม Gemini บอกผมมาทั้งนั้น
