const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();


const google_sheet_url = process.env.GOOGLE_SHEET_URL; 



/**
 * ฟังก์ชันสำหรับตั้งเวลาให้อาหาร (จะไปอัปเดตและลบค่าเก่าทิ้งในชีต Schedules)
 * @param {string} deviceId - รหัสเครื่อง เช่น "cat_feeder_01"
 * @param {Array<string>} timesArray - อาเรย์ของเวลา เช่น ["08:00", "16:00"]
 */
const updateDeviceSchedule = async (deviceId, timesArray) => {
    try {
        // แปลงอาเรย์เวลา เช่น ["08:00", "16:00"] ให้กลายเป็น String "08:00,16:00"
        console.log(`⏳ Preparing to update schedule for [${deviceId}] with times:`, timesArray);
        const timesString = Array.isArray(timesArray) ? timesArray.join(',') : timesArray;

        // จัดรูปทรงข้อมูลให้ตรงกับที่ Apps Script (ชีต Schedules) ต้องการ
        const scheduleData = {
            sheetName: "Schedules",
            action: "update_schedule",
            device_id: deviceId,
            times: timesString
        };

        console.log(`⏳ กำลังอัปเดตตารางเวลาให้ [${deviceId}]...`, scheduleData);

        // ยิง HTTP POST ไปที่ Google Apps Script
        const response = await axios.post(google_sheet_url, scheduleData);

        console.log(`✅ Schedule Updated for [${deviceId}]:`, response.data);
        console.log(' set-schedule ✅ : successfully to Google Sheet');
        return response.data;

    } catch (error) {
        console.error('❌ เกิดข้อผิดพลาดในการอัปเดตตารางเวลา:', error.message);
        return null;
    }
};

/**
 * ฟังก์ชันดึงตารางเวลาจาก Google Sheets
 * @param {string} [targetDeviceId] - (Optional) รหัสอุปกรณ์ที่ต้องการกรอง
 * @returns {Promise<Array|Object>} คืนค่าเป็น Array ทั้งหมด หรือ Object เดี่ยวตาม deviceId
 */
const getSchedulesFromSheet = async (targetDeviceId = null) => {
    // เรียก GET ไปที่ Google Apps Script โดยระบุพารามิเตอร์ sheet=Schedules
    console.log(`⏳ loading Schedules : Google Sheet... (Device ID: ${targetDeviceId || 'All'})`);
    const response = await axios.get(`${google_sheet_url}?sheet=Schedules`);
    
    // ข้อมูลที่ได้จาก Apps Script จะมาเป็น Array ของแถว (rows)
    const rows = response.data.data;

    if (!rows || rows.length <= 1) {
        throw new Error('No schedules found');
    }

    // rows[0] คือหัวตาราง ["Device ID", "Scheduled Times", "Last Updated"]
    const header = rows[0]; 
    const dataRows = rows.slice(1); // ข้อมูลตั้งแต่แถวที่ 2 เป็นต้นไป

    // แปลงข้อมูลให้อ่านง่ายเป็น Array ของ Object
    let schedules = dataRows.map(row => ({
        deviceId: row[0],
        times: row[1] ? row[1].split(',') : [], // แปลง String "08:00,16:00" กลับเป็นอาเรย์
        lastUpdated: row[2]
    }));

    // ถ้ามีการระบุ device_id มา ให้กรองเอาเฉพาะเครื่องนั้น
    if (targetDeviceId) {
        schedules = schedules.filter(item => item.deviceId === targetDeviceId);
        if (schedules.length === 0) {
            throw new Error(`Device ID: ${targetDeviceId} not found`);
        }
        console.log(`✅ Found schedule for Device ID: ${targetDeviceId || 'All'}`, schedules[0]);
        console.log(' get-schedule ✅ : successfully from Google Sheet');
        return schedules[0]; // ส่งกลับเป็น Object เดี่ยว
    }
    console.log(' get-schedule ✅ : successfully from Google Sheet');
    return schedules; // ส่งกลับเป็น Array ทั้งหมด
};
// lastest data from Google Sheet 
const getDataFromGoogleSheet = async (targetDeviceId = null) => {
    try {
        console.log(`⏳ Loading Logs : Google Sheet... (Device ID: ${targetDeviceId || 'All'})`);
        const response = await axios.get(google_sheet_url);
        
        // 🔍 ป้องกันเคสที่ response.data ไม่ใช่อาเรย์ตรงๆ (เช่น อาจจะอยู่ใน response.data.data)
        let rows = response.data;
        if (rows && !Array.isArray(rows) && Array.isArray(rows.data)) {
            rows = rows.data;
        }

        // เช็คความถูกต้องอีกรอบว่าเป็นอาเรย์แน่ๆ และมีข้อมูลพอไหม
        if (!Array.isArray(rows) || rows.length < 2) {
            console.warn('⚠️ ข้อมูลใน Google Sheet ว่างเปล่า หรือรูปแบบไม่ถูกต้อง:', response.data);
            return null;
        }

        // แยกหัวตารางและข้อมูล (ตอนนี้ปลอดภัยใช้ .slice ได้แล้ว)
        const headers = rows[0]; 
        const dataRows = rows.slice(1); 

        let latestRow = null;

        if (targetDeviceId) {
            for (let i = dataRows.length - 1; i >= 0; i--) {
                const row = dataRows[i];
                const deviceIdCol = row[1]; // สมมติว่า Device ID อยู่คอลัมน์ที่ 2 (index 1)

                if (deviceIdCol === targetDeviceId) {
                    latestRow = row;
                    break; 
                }
            }

            if (!latestRow) {
                console.warn(`⚠️ ไม่พบข้อมูลสำหรับ Device ID: ${targetDeviceId}`);
                return null;
            }
        } else {
            latestRow = dataRows[dataRows.length - 1];
        }

        const formattedData = {
            timestamp: latestRow[0],
            deviceId: latestRow[1],
            hopperWeight: latestRow[2],
            bowlWeight: latestRow[3],
            status: latestRow[4]
        };

        console.log(`GET ✅ : Latest Data Processed for [${targetDeviceId || 'All'}]:`, formattedData);
        console.log(' get-Lastest data ✅ : successfully from Google Sheet');
        return formattedData;

    } catch (error) {
        console.error('Error retrieving data from Google Sheet:', error.message);
        return null;
    }
};
// ฟังก์ชันดึงประวัติข้อมูลทั้งหมดจาก Google Sheet
const getDataByDeviceId = async (targetDeviceId) => {
    try {
        const response = await axios.get(google_sheet_url);
        
        // 🔍 ป้องกันเคสที่ response.data ไม่ใช่อาเรย์ตรงๆ
        let rows = response.data;
        if (rows && !Array.isArray(rows) && Array.isArray(rows.data)) {
            rows = rows.data;
        }

        // เช็คความถูกต้องอีกรอบว่าเป็นอาเรย์แน่ๆ และมีข้อมูลพอไหม
        if (!Array.isArray(rows) || rows.length < 2) {
            console.warn('⚠️ ข้อมูลใน Google Sheet ว่างเปล่า หรือรูปแบบไม่ถูกต้อง:', response.data);
            return [];
        }

        const headers = rows[0]; // เก็บหัวตารางไว้
        const dataRows = rows.slice(1); // ตัดหัวตารางออก เอาเฉพาะข้อมูลข้างล่าง

        // แปลงทุกแถวให้อยู่ในรูป Object
        const allFormattedData = dataRows.map((row) => {
            return {
                timestamp: row[0],
                deviceId: row[1],
                hopperWeight: row[2],
                bowlWeight: row[3],
                status: row[4]
            };
        });

        // 🎯 กรองเฉพาะ deviceId ที่ต้องการ (ถ้าส่งมา) ถ้าไม่ได้ส่งมาให้คืนค่าทั้งหมด
        const filteredData = targetDeviceId 
            ? allFormattedData.filter(item => item.deviceId === targetDeviceId)
            : allFormattedData;

        console.log(`Retrieved ${filteredData.length} records for device: ${targetDeviceId || 'ALL'}.`);
        console.log(' Get ✅ : successfully from Google Sheet');
        
        return filteredData; // ส่งออกเป็น Array ของข้อมูลเฉพาะ device_id นั้นๆ
    } catch (error) {
        console.error('Error retrieving data by deviceId from Google Sheet:', error);
        return [];
    }
};

const sendDataToGoogleSheet = async (data) => {
    try {
        const response = await axios.post(google_sheet_url, data);
        console.log('Data sent to Google Sheet:', response.data);
        console.log(' Send ✅ : successfully to Google Sheet');
        console.log(' send-data from  MQTT ✅ : successfully to Google Sheet');
    } catch (error) {
        console.error('Error sending data to Google Sheet:', error);
    }
};

module.exports = { getDataFromGoogleSheet, sendDataToGoogleSheet , updateDeviceSchedule, getSchedulesFromSheet , getDataByDeviceId}; 