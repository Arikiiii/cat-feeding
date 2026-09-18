
// Import the functions from sheet.js
const { mqttConnect } = require('./src/mqtt.js');
const { 
    getDataFromGoogleSheet, 
    sendDataToGoogleSheet,
    getAllDataFromGoogleSheet,
    updateDeviceSchedule,
    getSchedulesFromSheet
 } = require('./src/sheet.js');

// Import epress and create an instance of it
const express = require('express');
const path = require('path')
const cors = require('cors');
const app = express();
const port = 3000;



// ====== MQTT Configuration ======
const mqtt_broker_url = 'mqtt://broker.hivemq.com:1883';
const mqttTopic = 'catfeeder/control/status';


// ====== MQTT Client Setup =====

const client = mqttConnect(mqtt_broker_url, mqttTopic, (cleanData) => {
    console.log('📦 Data ready for Google Sheet:', cleanData);
    // เอา cleanData ไปยิงเข้า Google Sheets ต่อตรงนี้ได้เลย!
    console.log('Sending data to Google Sheet...');
    sendDataToGoogleSheet(cleanData);
});

// ====== Express Middleware Setup ======
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));


// ====== API Endpoint to Get Latest Feeder Status from Google Sheet ======
app.get('/api/feeder/latest', async (req, res) => {
    try {
        const targetDeviceId = req.query.device_id; // เช่น ?device_id=cat_feeder_01

        // เรียกใช้ฟังก์ชันและส่ง device_id เข้าไปกรอง
        const data = await getDataFromGoogleSheet(targetDeviceId);

        if (!data) {
            return res.status(404).json({ success: false, message: 'Data not found' });
        }

        res.status(200).json({ success: true, data: data });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ====== API Endpoint to Get Feeder History from Google Sheet for >> ======
app.get('/api/feeder/history', async (req, res) => {
    try {
        const historyData = await getAllDataFromGoogleSheet();
        res.json({
            success: true,
            count: historyData.length,
            data: historyData
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ====== API Endpoint to Send Feed Command to ESP32 via MQTT ======
const TOPIC_COMMAND = 'catfeeder/control/command';
app.post('/api/feeder/feed-now', (req, res) => {

    // data example: { "device_id": "feeder_001", "portion": 2  (count of portions to feed) }
    const { device_id, portion } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: 'Missing device_id' });
    }

    // สร้างคำสั่งรูปแบบ JSON ส่งไปให้ ESP32
    const commandPayload = JSON.stringify({
        action: 'feed_now',
        portion: portion || 1, // ค่าเริ่มต้น 1 ส่วน
        timestamp: Date.now()
    });

    // Publish คำสั่งออกไปที่ Topic ของ ESP32
    client.publish(TOPIC_COMMAND, commandPayload, (err) => {
        if (err) {
            console.error('❌ Failed to publish command:', err);
            return res.status(500).json({ success: false, message: 'Failed to send command' });
        }
        console.log(`🚀 Sent feed command to [${TOPIC_COMMAND}]:`, commandPayload);
        res.json({ success: true, message: 'Feeding command sent successfully!' });
    });
});



// ตัวอย่าง Express Endpoint สำหรับรับค่ากดเปลี่ยนเวลาจากหน้าเว็บ
app.post('/api/feeder/set-schedule', async (req, res) => {
    const { device_id, times } = req.body; 
    // ตัวอย่าง Body ที่หน้าเว็บจะส่งมา: { "device_id": "cat_feeder_01", "times": ["08:00", "17:00"] }

    if (!device_id || !times) {
        return res.status(400).json({ success: false, message: 'Missing device_id or times' });
    }

    // เรียกใช้ฟังก์ชันด้านบน
    const result = await updateDeviceSchedule(device_id, times);

    if (result && result.status === 'success') {
        res.status(200).json({ success: true, message: 'Schedule updated successfully (old data replaced)' });
    } else {
        res.status(500).json({ success: false, message: 'Failed to update schedule in Google Sheets' });
    }
});

// Endpoint สำหรับดึงตารางเวลาทั้งหมด หรือระบุเฉพาะ Device ID
app.get('/api/feeder/get-schedule', async (req, res) => {
    try {
        const targetDeviceId = req.query.device_id; 

        // เรียกใช้ฟังก์ชันที่เราแยกไว้
        const data = await getSchedulesFromSheet(targetDeviceId);

        res.status(200).json({
            success: true,
            data: data
        });

    } catch (error) {
        console.error('❌ Error fetching schedule:', error.message);
        const statusCode = error.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({ success: false, error: error.message });
    }
});


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Start the Express server
app.listen(port, () => {
    console.log(`Hello , Welcome to Cat Feeder Control Server!`);
    console.log(`By : Ae-21 Dev.กากๆ`);
    console.log(`🚀 Server is running on http://localhost:${port}`);
});


