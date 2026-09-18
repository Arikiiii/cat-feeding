const db = require('../config/database.js');

/**
 * ฟังก์ชันช่วยตรวจสอบและเพิ่มอุปกรณ์ลงตาราง devices อัตโนมัติ (ป้องกันปัญหา Foreign Key Error)
 */
const ensureDeviceExists = (deviceId) => {
    const check = db.prepare('SELECT device_id FROM devices WHERE device_id = ?').get(deviceId);
    if (!check) {
        db.prepare('INSERT INTO devices (device_id) VALUES (?)').run(deviceId);
    }
};

/**
 * 1. ตั้งเวลาให้อาหาร (Normalize: ลบเวลาเก่าของเครื่องนั้นทิ้ง แล้ว Insert เวลาใหม่ทีละแถว)
 * @param {string} deviceId - รหัสอุปกรณ์
 * @param {Array<string>|string} timesArray - อาเรย์เวลา เช่น ["08:00", "16:00"]
 */
const updateDeviceSchedule = (deviceId, timesArray) => {
    try {
        console.log(`⏳ กำลังอัปเดตตารางเวลา (Normalized) สำหรับ [${deviceId}]...`);
        
        // แปลงให้เป็นอาเรย์เสมอ
        const times = Array.isArray(timesArray) ? timesArray : timesArray.split(',');

        // ใช้ Transaction เพื่อความปลอดภัย (ลบของเก่า Insert ของใหม่พร้อมกัน)
        const updateTransaction = db.transaction((devId, timeList) => {
            ensureDeviceExists(devId);

            // ลบตารางเวลาเก่าทั้งหมดของเครื่องนี้ทิ้ง
            db.prepare('DELETE FROM schedules WHERE device_id = ?').run(devId);

            // วนลูป Insert เวลาแต่ละมื้อลงไปเป็นแถวแยกกัน (Normalize 1NF)
            const insertStmt = db.prepare('INSERT INTO schedules (device_id, feeding_time, last_updated) VALUES (?, ?, ?)');
            const now = new Date().toISOString();

            for (const time of timeList) {
                if (time.trim()) {
                    insertStmt.run(devId, time.trim(), now);
                }
            }
        });

        updateTransaction(deviceId, times);

        console.log(`✅ Schedule Updated (Normalized) for [${deviceId}] สำเร็จ`);
        return { success: true, device_id: deviceId, times, lastUpdated: new Date().toISOString() };

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาดในการอัปเดตตารางเวลา:', error.message);
        return null;
    }
};

/**
 * 2. ดึงตารางเวลา (รวมข้อมูลกลับมาเป็น Array ให้ใช้งานง่ายเหมือนเดิม)
 */
const getSchedulesFromSheet = (targetDeviceId = null) => {
    console.log(`⏳ โหลด Schedules (Normalized) จาก SQLite... (Device ID: ${targetDeviceId || 'All'})`);
    
    if (targetDeviceId) {
        const stmt = db.prepare('SELECT feeding_time, last_updated FROM schedules WHERE device_id = ? ORDER BY feeding_time ASC');
        const rows = stmt.all(targetDeviceId);

        if (!rows || rows.length === 0) {
            throw new Error(`Device ID: ${targetDeviceId} not found`);
        }

        return {
            deviceId: targetDeviceId,
            times: rows.map(r => r.feeding_time), // รวมกลับเป็น Array ตอนส่งออก
            lastUpdated: rows[0].last_updated
        };
    } else {
        // ดึงรายชื่อ device ทั้งหมดที่มีตารางเวลา
        const devices = db.prepare('SELECT DISTINCT device_id FROM schedules').all();
        
        if (!devices || devices.length === 0) {
            throw new Error('No schedules found');
        }

        return devices.map(d => {
            const rows = db.prepare('SELECT feeding_time, last_updated FROM schedules WHERE device_id = ? ORDER BY feeding_time ASC').all(d.device_id);
            return {
                deviceId: d.device_id,
                times: rows.map(r => r.feeding_time),
                lastUpdated: rows[0]?.last_updated
            };
        });
    }
};

/**
 * 3. ดึงข้อมูล Log ล่าสุดของอุปกรณ์
 */
const getDataFromGoogleSheet = (targetDeviceId = null) => {
    try {
        let row;
        if (targetDeviceId) {
            const stmt = db.prepare(`
                SELECT timestamp, device_id as deviceId, hopper_weight as hopperWeight, bowl_weight as bowlWeight, status 
                FROM device_logs 
                WHERE device_id = ? 
                ORDER BY id DESC LIMIT 1
            `);
            row = stmt.get(targetDeviceId);
        } else {
            const stmt = db.prepare(`
                SELECT timestamp, device_id as deviceId, hopper_weight as hopperWeight, bowl_weight as bowlWeight, status 
                FROM device_logs 
                ORDER BY id DESC LIMIT 1
            `);
            row = stmt.get();
        }

        if (!row) return null;
        return row;

    } catch (error) {
        console.error('Error retrieving data from SQLite:', error.message);
        return null;
    }
};

/**
 * 4. ดึงประวัติข้อมูลทั้งหมดตาม Device ID
 */
const getDataByDeviceId = (targetDeviceId = null) => {
    try {
        let rows;
        if (targetDeviceId) {
            const stmt = db.prepare(`
                SELECT timestamp, device_id as deviceId, hopper_weight as hopperWeight, bowl_weight as bowlWeight, status 
                FROM device_logs 
                WHERE device_id = ?
                ORDER BY id ASC
            `);
            rows = stmt.all(targetDeviceId);
        } else {
            const stmt = db.prepare(`
                SELECT timestamp, device_id as deviceId, hopper_weight as hopperWeight, bowl_weight as bowlWeight, status 
                FROM device_logs 
                ORDER BY id ASC
            `);
            rows = stmt.all();
        }

        return rows;
    } catch (error) {
        console.error('Error retrieving data by deviceId from SQLite:', error);
        return [];
    }
};

/**
 * 5. บันทึกข้อมูล Log ใหม่ลง SQLite
 */
const sendDataToGoogleSheet = (data) => {
    try {
        const deviceId = data.device_id || data.deviceId;
        
        // ตรวจสอบว่ามี Device นี้ในระบบหรือยัง ถ้ายังให้สร้างตาราง devices รอไว้ (ป้องกัน Foreign Key Error)
        ensureDeviceExists(deviceId);

        const stmt = db.prepare(`
            INSERT INTO device_logs (device_id, hopper_weight, bowl_weight, status) 
            VALUES (?, ?, ?, ?)
        `);

        // Map ชื่อฟิลด์จาก mqtt.js (hopper_weight_g, bowl_weight_g, feeder_status)
        const hopperWeight = data.hopper_weight_g !== undefined ? data.hopper_weight_g : data.hopperWeight;
        const bowlWeight = data.bowl_weight_g !== undefined ? data.bowl_weight_g : data.bowlWeight;
        const status = data.feeder_status || data.status;

        stmt.run(deviceId, hopperWeight, bowlWeight, status);
        console.log(`📥 บันทึก Log ของ [${deviceId}] ลง SQLite สำเร็จ!`);
    } catch (error) {
        console.error('❌ Error saving MQTT data to SQLite:', error.message);
    }
};

module.exports = { 
    getDataFromGoogleSheet, 
    sendDataToGoogleSheet, 
    updateDeviceSchedule, 
    getSchedulesFromSheet, 
    getDataByDeviceId 
};