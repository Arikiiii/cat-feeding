// Import the functions from sheet.js / models
const { mqttConnect } = require('./src/mqtt.js');
const { 
    getDataFromGoogleSheet, 
    sendDataToGoogleSheet,
    getDataByDeviceId,
    updateDeviceSchedule,
    getSchedulesFromSheet
 } = require('./src/models/deviceModel.js');

// Import express and create an instance of it
const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const port = 3000;

// ====== MQTT Configuration ======
// const mqtt_broker_url = 'mqtt://broker.hivemq.com:1883';
const mqtt_broker_url = 'mqtt://localhost:1883';
const mqttTopic = 'catfeeder/control/data';

const now = new Date();
const thaiTimeOffset = 7 * 60 * 60 * 1000; // 7 ชั่วโมงเป็นมิลลิวินาที
const thaiDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + thaiTimeOffset);
const timestampThai = thaiDate.toISOString().replace('Z', '+07:00');

// ====== MQTT Client Setup =====
const client = mqttConnect(mqtt_broker_url, mqttTopic, (cleanData) => {
    console.log('📦 Data ready for SQLite:', cleanData);
    console.log('Saving data to SQLite database...');
    sendDataToGoogleSheet(cleanData); // ชื่อฟังก์ชันเดิม แต่ข้างในบันทึกลง SQLite แล้ว
});

// ====== Express Middleware Setup ======
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


//==========================================
// GET API Endpoints (เอา async/await ออก เพราะ SQLite เป็น Synchronous)

// ====== API Endpoint to Get Latest Feeder Status ======
app.get('/api/feeder/latest', (req, res) => {
    try {
        const targetDeviceId = req.query.device_id; // เช่น ?device_id=cat_feeder_01

        // เรียกใช้ฟังก์ชัน SQLite แบบปกติ (ไม่ต้อง await)
        const data = getDataFromGoogleSheet(targetDeviceId);

        if (!data) {
            return res.status(404).json({ success: false, message: 'Data not found' });
        }

        res.status(200).json({ success: true, data: data });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ====== API Endpoint to Get Feeder History ======
app.get('/api/feeder/history', (req, res) => {
    try {
        const targetDeviceId = req.query.deviceId;

        const historyData = getDataByDeviceId(targetDeviceId);
        
        res.json({
            success: true,
            filter: targetDeviceId || 'ALL',
            count: historyData.length,
            data: historyData
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint สำหรับดึงตารางเวลาทั้งหมด หรือระบุเฉพาะ Device ID
app.get('/api/feeder/devices', (req, res) => {
    try {
        const historyData = getDataByDeviceId(); 
        
        const uniqueDevices = [...new Set(historyData.map(item => item.deviceId))].filter(Boolean);

        res.json({
            success: true,
            data: uniqueDevices
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/feeder/get-schedule', (req, res) => {
    try {
        const targetDeviceId = req.query.device_id; 

        const data = getSchedulesFromSheet(targetDeviceId);

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

// ====== API Endpoint to Send Feed Command to ESP32 via MQTT ======
const TOPIC_COMMAND = 'catfeeder/control/command'; //สำหรับส่งคำสั่งไปยัง ESP32 
const TOPIC_time =    'catfeeder/control/set-time';
//=========================================
// POST API Endpoints

app.post('/api/feeder/feed-now', (req, res) => {
    const { device_id, portion } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: 'Missing device_id' });
    }

    const commandPayload = JSON.stringify({
        action: 'feed_now',
        device_id: device_id,
        portion: portion || 1,
        timestamp: timestampThai
    });

    client.publish(TOPIC_COMMAND, commandPayload, (err) => {
        if (err) {
            console.error('❌ Failed to publish command:', err);
            return res.status(500).json({ success: false, message: 'Failed to send command' });
        }
        console.log(`🚀 Sent feed command to [${TOPIC_COMMAND}]:`, commandPayload);
        res.json({ success: true, message: 'Feeding command sent successfully!' });
    });
});

app.post('/api/feeder/set-schedule', (req, res) => {
    const { device_id, times, portion } = req.body; 

    if (!device_id || !times) {
        return res.status(400).json({ success: false, message: 'Missing device_id or times' });
    }

    // เรียกฟังก์ชันอัปเดตตารางเวลา (ส่ง portion เข้าไปด้วย ถ้ามี)
    const result = updateDeviceSchedule(device_id, times, portion);
    console.log(`SQLite  📅 Updated schedule for device [${device_id}] in SQLite:`, { times, portion });
    
    const set_timePayload = JSON.stringify({
        action: 'set_schedule',
        device_id: device_id,
        times: times,
        timestamp: timestampThai
    });

    client.publish(TOPIC_time, set_timePayload, (err) => {
        if (err) {
            console.error('❌ Failed to publish set-time command:', err);
            return res.status(500).json({ success: false, message: 'Failed to send set-time command' });
        }
        console.log(`MQTT 🚀 Sent set-time command to  [${TOPIC_time}]:`, set_timePayload);
    });

    if (result && result.success) {
        res.status(200).json({ success: true, message: 'Schedule updated successfully in SQLite' });
    } else {
        res.status(500).json({ success: false, message: 'Failed to update schedule in SQLite' });
    }
});

//=========================================
// Serve static files & Start Server
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Hello , Welcome to Cat Feeder Control Server!`);
    console.log(`By : Ae-21 Dev.กากๆ`);
    console.log(`🚀 Server is running on http://localhost:${port}`);
});