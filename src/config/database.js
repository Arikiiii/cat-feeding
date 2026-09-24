const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../database/db_cat_feeder.db');
const db = new DatabaseSync(dbPath);

// node:sqlite ไม่มี db.pragma() แบบ better-sqlite3 ต้องใช้ db.exec() ยิง PRAGMA แทน
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON'); // เปิดใช้งาน Foreign Key Constraints

// 1. ตารางอุปกรณ์ (Devices)
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    device_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 2. ตารางตารางเวลา (Schedules - Normalization แยกเวลาแต่ละมื้อเป็นแถวอิสระ)
// หมายเหตุ: เพิ่มคอลัมน์ portion เข้ามาด้วย เพราะ deviceModel.js มีการ INSERT/SELECT
// คอลัมน์นี้อยู่ แต่ตารางเดิมไม่มีคอลัมน์นี้ (จะทำให้ query พังถ้าไม่เพิ่ม)
db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    feeding_time TEXT NOT NULL, -- เช่น "08:00"
    portion INTEGER DEFAULT 1,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
  )
`);

// 3. ตารางประวัติการทำงาน (Device Logs)
db.exec(`
  CREATE TABLE IF NOT EXISTS device_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    device_id TEXT NOT NULL,
    hopper_weight REAL,
    bowl_weight REAL,
    status TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
  )
`);

module.exports = db;
