// ==============================
// Cat Feeder Dashboard — Client Logic
// ==============================

const API_BASE = ''; // ใช้โดเมนเดียวกันเพราะรันบน Express server ตัวเดียวกัน
const DEFAULT_CAPACITY_G = 1000; // ค่าเริ่มต้นความจุถัง (g) ใช้คำนวณ % ถ้าไม่มีค่าจาก API
const AUTO_REFRESH_MS = 30000; // รีเฟรชสถานะทุกเครื่องอัตโนมัติทุก 30 วิ
const DEVICE_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899', '#14b8a6'];

let allDevices = [];
let deviceStatusCache = {};   // deviceId -> latest status object
let deviceScheduleCache = {}; // deviceId -> times array
let deviceHistoryCache = {};  // deviceId -> history array (raw from API)
let feederChart = null;
let autoRefreshTimer = null;
let globalHistoryData = []; // ข้อมูลประวัติที่ถูกเลือกไว้สำหรับตาราง (ก่อนกรองเวลา)

// ---------- Helpers ----------

function getCurrentDevice() {
  return document.getElementById('deviceSelect').value;
}

function deviceColor(deviceId) {
  const idx = allDevices.indexOf(deviceId);
  return DEVICE_COLORS[idx >= 0 ? idx % DEVICE_COLORS.length : 0];
}

function getCapacity(deviceId) {
  const stored = localStorage.getItem(`feeder_capacity_${deviceId}`);
  return stored ? parseFloat(stored) : DEFAULT_CAPACITY_G;
}

function setCapacity(deviceId, value) {
  localStorage.setItem(`feeder_capacity_${deviceId}`, value);
}

// ฟังก์ชันกดปุ่มเพิ่มแถวเวลา
function addScheduleRow() {
  const container = document.getElementById('scheduleListContainer');
  const row = document.createElement('div');
  row.className = "flex gap-2 items-center schedule-row";
  row.innerHTML = `
        <input type="time" value="12:00" class="time-input px-3 py-2 border rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none flex-1">
        <input type="number" value="1" min="1" max="5" placeholder="Portion" class="portion-input w-24 px-3 py-2 border rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none">
        <button type="button" onclick="this.parentElement.remove()" class="text-red-500 hover:text-red-700 px-2">🗑️</button>
    `;
  container.appendChild(row);
}

// ฟังก์ชันบันทึกข้อมูลส่งเข้า API
async function saveCustomSchedule() {
  // 1. ดึง device_id จาก id="scheduleDeviceLabel" (หรือดึงจากตัวแปรโกลบอลของหน้าเว็บคุณ)
  const deviceIdLabel = document.getElementById('scheduleDeviceLabel');
  // ดึงค่าข้อความหรือ dataset (เช่น ถ้าข้อความใน span คือ "(catfeeder_001)" ให้ตัดวงเล็บออก หรือดึงจากตัวแปรหลัก)
  let deviceId = "catfeeder_001"; // ค่าสำรองเผื่อยังไม่ได้เซ็ต
  if (deviceIdLabel) {
    const text = deviceIdLabel.innerText.trim();
    // ถ้าข้อความในวงเล็บ เช่น "(catfeeder_001)" ให้ดึงเฉพาะข้างใน
    const match = text.match(/\(([^)]+)\)/);
    if (match) {
      deviceId = match[1];
    } else if (deviceIdLabel.dataset.deviceId) {
      deviceId = deviceIdLabel.dataset.deviceId;
    }
  }

  // 2. วนลูปเก็บค่าจากแต่ละแถวที่มี class="schedule-row"
  const rows = document.querySelectorAll('.schedule-row');
  const times = [];

  rows.forEach(row => {
    // ปรับ selector ตรงนี้ให้ตรงกับ class หรือ element จริงของคอมโพเนนต์เวลาในรูป
    const timeInput = row.querySelector('.time-input');
    const portionInput = row.querySelector('.portion-input');

    if (timeInput && timeInput.value) {
      // สมมติว่าถ้าคอมโพเนนต์ในรูปพ่นค่าออกมาเป็น "09:00 AM" หรือรูปแบบ 12 ชม.
      let rawTime = timeInput.value.trim();
      let formattedTime = rawTime;

      // ถ้าค่าที่ได้ติด AM/PM มาด้วย (เช่น "09:00 AM" หรือ "02:30 PM") 
      // เราต้องแปลงเป็นระบบ 24 ชั่วโมง ("HH:MM") ก่อนส่งเข้า API
      if (rawTime.includes('AM') || rawTime.includes('PM')) {
        const [timePart, modifier] = rawTime.split(' ');
        let [hours, minutes] = timePart.split(':');
        let h = parseInt(hours, 10);

        if (modifier === 'PM' && h < 12) {
          h += 12;
        } else if (modifier === 'AM' && h === 12) {
          h = 0;
        }
        formattedTime = `${String(h).padStart(2, '0')}:${minutes}`;
      }

      times.push({
        time: formattedTime, // ได้ค่า 24 ชม. เช่น "09:00" หรือ "14:30" แน่นอน
        portion: portionInput ? (parseInt(portionInput.value) || 1) : 1
      });
    }
  });

  // 3. ตรวจสอบความถูกต้องก่อนส่ง
  if (!deviceId || times.length === 0) {
    document.getElementById('scheduleResult').innerText = "❌ บันทึกไม่สำเร็จ: Missing device_id or times";
    document.getElementById('scheduleResult').className = "text-xs text-center text-red-500 mt-2";
    return;
  }

  try {
    const response = await fetch('/api/feeder/set-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        times: times
      })
    });

    const result = await response.json();
    if (result.success) {
      document.getElementById('scheduleResult').innerText = "✅ บันทึกตารางเวลาสำเร็จ!";
      document.getElementById('scheduleResult').className = "text-xs text-center text-green-500 mt-2";
    } else {
      document.getElementById('scheduleResult').innerText = "❌ บันทึกไม่สำเร็จ: " + (result.message || 'Unknown error');
      document.getElementById('scheduleResult').className = "text-xs text-center text-red-500 mt-2";
    }
  } catch (err) {
    console.error(err);
    document.getElementById('scheduleResult').innerText = "❌ เกิดข้อผิดพลาดในการเชื่อมต่อ";
    document.getElementById('scheduleResult').className = "text-xs text-center text-red-500 mt-2";
  }
}

function editCapacity(deviceId) {
  const current = getCapacity(deviceId);
  const input = prompt(`ความจุเต็มถังของ ${deviceId} (กรัม) — ใช้คำนวณ %`, current);
  if (input && !isNaN(parseFloat(input))) {
    setCapacity(deviceId, parseFloat(input));
    refreshAllDeviceCards();
  }
}

// สีของ badge ตามสถานะจริงจากอุปกรณ์ (feeding / idle / error) เผื่อค่าอื่นๆ ไว้ด้วย
function statusBadgeClasses(status) {
  const s = (status || '').toLowerCase();
  if (s === 'feeding') return 'bg-blue-100 text-blue-700 animate-pulse';
  if (s === 'idle') return 'bg-emerald-100 text-emerald-700';
  if (s === 'error') return 'bg-red-100 text-red-700';
  if (s === 'ok' || s === 'normal') return 'bg-emerald-100 text-emerald-700';
  if (s === 'low') return 'bg-amber-100 text-amber-700';
  if (s === 'empty') return 'bg-red-100 text-red-700';
  if (s === 'offline') return 'bg-gray-200 text-gray-500';
  return 'bg-gray-100 text-gray-600';
}

// ข้อความสถานะภาษาไทยที่อ่านง่าย พร้อมไอคอนกำกับ
function statusLabel(status) {
  const s = (status || '').toLowerCase();
  if (s === 'feeding') return '🍽️ กำลังให้อาหาร';
  if (s === 'idle') return '💤 ว่าง';
  if (s === 'error') return '⚠️ ผิดพลาด';
  return status || 'ไม่ทราบสถานะ';
}

// สีขอบซ้ายของการ์ดอุปกรณ์ ให้เห็นสถานะได้ทันทีแม้มองผ่านๆ
function statusCardAccentClasses(status) {
  const s = (status || '').toLowerCase();
  if (s === 'feeding') return 'border-l-4 border-l-blue-400';
  if (s === 'idle') return 'border-l-4 border-l-emerald-400';
  if (s === 'error') return 'border-l-4 border-l-red-500';
  if (s === 'ok' || s === 'normal') return 'border-l-4 border-l-emerald-400';
  if (s === 'low') return 'border-l-4 border-l-amber-400';
  if (s === 'empty') return 'border-l-4 border-l-red-500';
  if (s === 'offline') return 'border-l-4 border-l-gray-300';
  return 'border-l-4 border-l-gray-200';
}

function weightBarClasses(percent) {
  if (percent >= 50) return 'bg-emerald-500';
  if (percent >= 20) return 'bg-amber-500';
  return 'bg-red-500';
}

// คำนวณเวลาให้อาหารครั้งต่อไปจากรายการเวลา (HH:MM)
function getNextFeedInfo(times) {
  if (!times || times.length === 0) return null;
  const now = new Date();
  const parsed = times
    .map(item => {
      // รองรับทั้งกรณีที่ item เป็น string เลย ("08:45") หรือเป็น object ({ time: "08:45", portion: 2 })
      const timeStr = (typeof item === 'object' && item !== null) ? item.time : item;
      
      if (!timeStr || typeof timeStr !== 'string') return null;

      const parts = timeStr.split(':').map(n => parseInt(n, 10));
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
      const d = new Date(now);
      d.setHours(parts[0], parts[1], 0, 0);
      return d;
    })
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (parsed.length === 0) return null;

  let next = parsed.find(d => d > now);
  if (!next) {
    next = new Date(parsed[0]);
    next.setDate(next.getDate() + 1);
  }
  return { time: next, diffMs: next - now };
}

function formatCountdown(diffMs) {
  const totalMin = Math.max(0, Math.round(diffMs / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `อีก ${h} ชม. ${m} นาที`;
  return `อีก ${m} นาที`;
}

function formatClock(date) {
  return date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Device list & status grid ----------

async function fetchDevices() {
  const select = document.getElementById('deviceSelect');
  try {
    const res = await fetch(`${API_BASE}/api/feeder/devices`);
    const json = await res.json();

    if (json.success && json.data && json.data.length > 0) {
      allDevices = json.data;
    } else {
      allDevices = ['cat_feeder_01'];
    }
  } catch (err) {
    console.error('Failed to load devices:', err);
    allDevices = ['cat_feeder_01'];
  }

  select.innerHTML = allDevices.map(id => `<option value="${id}">${id}</option>`).join('');
  renderChartDeviceCheckboxes();
  changeDevice();
  refreshAllDeviceCards();

  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(refreshAllDeviceCards, AUTO_REFRESH_MS);
}

async function fetchDeviceLatest(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/feeder/latest?device_id=${deviceId}`);
    const json = await res.json();
    return json.success ? json.data : null;
  } catch (err) {
    return null;
  }
}

async function fetchDeviceSchedule(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/feeder/get-schedule?device_id=${deviceId}`);
    const json = await res.json();
    if (json.success && json.data) {
      const raw = json.data.times || json.data.scheduledTimes || '';
      return Array.isArray(raw) ? raw : String(raw).split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
  } catch (err) {
    return [];
  }
}

async function refreshAllDeviceCards() {
  const grid = document.getElementById('deviceGrid');
  if (allDevices.length === 0) {
    grid.innerHTML = `<p class="text-gray-400 text-sm">ไม่พบเครื่องในระบบ</p>`;
    return;
  }

  const results = await Promise.all(allDevices.map(async id => {
    const [status, schedule] = await Promise.all([fetchDeviceLatest(id), fetchDeviceSchedule(id)]);
    deviceStatusCache[id] = status;
    deviceScheduleCache[id] = schedule;
    return { id, status, schedule };
  }));

  grid.innerHTML = results.map(({ id, status, schedule }) => renderDeviceCard(id, status, schedule)).join('');
}

function renderDeviceCard(deviceId, status, schedule) {
  const selected = deviceId === getCurrentDevice();
  const hopperWeight = status ? (status.hopperWeight ?? status.hopper_weight_g ?? 0) : 0;
  const bowlWeight = status ? (status.bowlWeight ?? status.bowl_weight_g ?? 0) : 0;
  const statusText = status ? (status.status || 'OK') : 'OFFLINE';
  const capacity = getCapacity(deviceId);
  const percent = capacity > 0 ? Math.min(100, Math.max(0, Math.round((hopperWeight / capacity) * 100))) : 0;
  const nextFeed = getNextFeedInfo(schedule);

  const nextFeedHtml = nextFeed
    ? `<span class="font-medium text-gray-600">${formatClock(nextFeed.time)}</span> <span class="text-gray-400">(${formatCountdown(nextFeed.diffMs)})</span>`
    : `<span class="text-gray-400">ยังไม่ได้ตั้งเวลา</span>`;

  return `
    <div class="device-card bg-white p-5 rounded-2xl shadow-sm border ${statusCardAccentClasses(statusText)} ${selected ? 'is-selected' : 'border-gray-200'} cursor-pointer"
      onclick="selectDeviceFromCard('${deviceId}')">
      <div class="flex justify-between items-start mb-3">
        <h3 class="font-semibold text-gray-800 flex items-center gap-1">🐾 ${deviceId}</h3>
        <span class="px-2 py-0.5 rounded text-xs font-bold ${statusBadgeClasses(statusText)}">${statusLabel(statusText)}</span>
      </div>

      <div class="mb-3">
        <div class="flex justify-between text-xs text-gray-500 mb-1">
          <span>น้ำหนักถัง</span>
          <span>
            <button onclick="event.stopPropagation(); editCapacity('${deviceId}')"
              class="underline decoration-dotted hover:text-orange-600" title="ตั้งค่าความจุเต็มถัง">${percent}%</button>
          </span>
        </div>
        <div class="w-full h-2.5 rounded-full weight-bar-track overflow-hidden">
          <div class="h-full rounded-full weight-bar-fill ${weightBarClasses(percent)}" style="width:${percent}%"></div>
        </div>
        <div class="text-xs text-gray-400 mt-1">${hopperWeight} g / ${capacity} g</div>
      </div>

      <div class="flex justify-between text-sm mb-3">
        <span class="text-gray-500">น้ำหนักชาม</span>
        <span class="font-medium text-gray-700">${bowlWeight} g</span>
      </div>

      <div class="text-xs border-t pt-2 mt-2 flex justify-between items-center">
        <span class="text-gray-500">⏰ ครั้งต่อไป</span>
        ${nextFeedHtml}
      </div>
    </div>
  `;
}

function selectDeviceFromCard(deviceId) {
  document.getElementById('deviceSelect').value = deviceId;
  changeDevice();
  refreshAllDeviceCards();
}

// ---------- Feed now ----------

async function feedNow() {
  const deviceId = getCurrentDevice();
  const portion = parseInt(document.getElementById('portionInput').value) || 1;
  const resMsg = document.getElementById('feedResult');

  resMsg.innerText = "⏳ กำลังส่งคำสั่ง...";
  try {
    const res = await fetch(`${API_BASE}/api/feeder/feed-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, portion: portion })
    });
    const json = await res.json();
    if (json.success) {
      resMsg.innerText = "✅ ส่งคำสั่งสำเร็จแล้ว!";
      resMsg.className = "text-xs text-center text-green-600 mt-2 font-medium";
      setTimeout(refreshAllDeviceCards, 1500);
    } else {
      resMsg.innerText = "❌ ส่งคำสั่งไม่สำเร็จ";
      resMsg.className = "text-xs text-center text-red-600 mt-2 font-medium";
    }
  } catch (err) {
    resMsg.innerText = "❌ เชื่อมต่อ Server ไม่ได้";
    resMsg.className = "text-xs text-center text-red-600 mt-2 font-medium";
  }
}

// ---------- Schedule ----------

async function saveSchedule() {
  // 1. ดึง device_id ให้ชัวร์ (ถ้าหน้าเว็บใช้ตัวแปรโกลบอลเก็บชื่อเครื่องอยู่แล้ว ให้เอามาใส่ตรงนี้ได้เลย)
  // สมมติว่าดึงจาก UI หรือกำหนดค่าตรงๆ (เช่น "catfeeder_001")
  const deviceIdElement = document.getElementById('scheduleDeviceLabel');
  const deviceId = (deviceIdElement && deviceIdElement.dataset.deviceId) ? deviceIdElement.dataset.deviceId : "catfeeder_001";

  // 2. วนลูปเก็บค่าจากฟอร์มตารางเวลาแต่ละแถวในหน้า UI
  const rows = document.querySelectorAll('.schedule-row'); // ปรับ selector ให้ตรงกับ class แถวใน HTML ของคุณ
  const times = [];

  rows.forEach(row => {
    // หา input เวลาและพอร์ชั่นในแต่ละแถว
    const timeInput = row.querySelector('input[type="time"]'); // หรือ input สำหรับเวลา
    const portionInput = row.querySelector('input[type="number"]'); // ช่องกรอกพอร์ชั่น

    if (timeInput && timeInput.value) {
      times.push({
        time: timeInput.value, // เช่น "08:45"
        portion: portionInput ? (parseInt(portionInput.value) || 1) : 1
      });
    }
  });

  // ตรวจสอบเบื้องต้นว่ามี device_id และมีข้อมูลมื้ออาหารไหม
  if (!deviceId || times.length === 0) {
    document.getElementById('scheduleResult').innerText = "❌ บันทึกไม่สำเร็จ: Missing device_id or times";
    document.getElementById('scheduleResult').className = "text-xs text-center text-red-500";
    return;
  }

  try {
    const response = await fetch('/api/feeder/set-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        times: times // ส่งไปเป็นอาเรย์ของ Object เช่น [{time: "08:45", portion: 2}, ...]
      })
    });

    const result = await response.json();
    if (result.success) {
      document.getElementById('scheduleResult').innerText = "✅ บันทึกตารางเวลาสำเร็จ!";
      document.getElementById('scheduleResult').className = "text-xs text-center text-green-500";
    } else {
      document.getElementById('scheduleResult').innerText = "❌ บันทึกไม่สำเร็จ: " + (result.message || 'Unknown error');
      document.getElementById('scheduleResult').className = "text-xs text-center text-red-500";
    }
  } catch (err) {
    console.error(err);
    document.getElementById('scheduleResult').innerText = "❌ เกิดข้อผิดพลาดในการเชื่อมต่อ";
    document.getElementById('scheduleResult').className = "text-xs text-center text-red-500";
  }
}

async function fetchSchedule() {
  const deviceId = getCurrentDevice();
  const times = await fetchDeviceSchedule(deviceId);
  deviceScheduleCache[deviceId] = times;

  // 1. เช็คก่อนว่ามี input ช่องนี้อยู่บนหน้าเว็บไหม
  const scheduleInput = document.getElementById('scheduleInput');
  if (scheduleInput) {
    // แปลงโครงสร้าง times ให้เป็นสตริงเวลาธรรมดาก่อน join (เผื่อเป็น Object)
    const timeStrings = Array.isArray(times) 
      ? times.map(t => (typeof t === 'object' && t !== null ? t.time : t)) 
      : [];
    scheduleInput.value = timeStrings.join(', ');
  } else {
    console.warn("⚠️ ไม่พบ element id='scheduleInput' บนหน้า HTML (คาดว่าเปลี่ยนไปใช้ UI แบบตารางรายแถวแล้ว)");
    
    // ถ้าคุณเปลี่ยนไปใช้ UI แบบตารางเลือกเวลาและพอร์ชั่นหลายแถว 
    // ให้เรียกฟังก์ชันสำหรับวาดแถวข้อมูลตรงนี้แทนได้เลย เช่น:
    // renderScheduleTable(times); 
  }
}

// ---------- Chart ----------

function onChartModeChange() {
  const mode = document.getElementById('chartMode').value;
  document.getElementById('chartDeviceCheckboxes').classList.toggle('hidden', mode !== 'multi');
  applyTimeFilter();
}

function renderChartDeviceCheckboxes() {
  const wrap = document.getElementById('chartDeviceCheckboxes');
  wrap.innerHTML = allDevices.map((id, idx) => `
    <label class="flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" class="chart-device-checkbox" value="${id}" ${idx === 0 ? 'checked' : ''} onchange="applyTimeFilter()">
      <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${deviceColor(id)}"></span>
      ${id}
    </label>
  `).join('');
}

function getSelectedChartDevices() {
  return Array.from(document.querySelectorAll('.chart-device-checkbox:checked')).map(cb => cb.value);
}

function filterByTime(data, filterValue) {
  if (filterValue === 'all') return data;
  const now = new Date();
  return data.filter(row => {
    const rowDate = new Date(row.timestamp);
    const diffDays = Math.ceil(Math.abs(now - rowDate) / (1000 * 60 * 60 * 24));
    if (filterValue === 'day') return diffDays <= 1;
    if (filterValue === 'week') return diffDays <= 7;
    if (filterValue === 'month') return diffDays <= 30;
    if (filterValue === 'year') return diffDays <= 365;
    return true;
  });
}

async function getDeviceHistory(deviceId) {
  if (deviceHistoryCache[deviceId]) return deviceHistoryCache[deviceId];
  try {
    const res = await fetch(`${API_BASE}/api/feeder/history?deviceId=${deviceId}`);
    const json = await res.json();
    const data = (json.success && json.data) ? json.data : [];
    deviceHistoryCache[deviceId] = data;
    return data;
  } catch (err) {
    return [];
  }
}

function buildDatasets(deviceId, historyData, metric) {
  const sorted = [...historyData].reverse();
  const color = deviceColor(deviceId);
  const datasets = [];

  if (metric === 'hopper' || metric === 'both') {
    datasets.push({
      label: `${deviceId} — ถัง (g)`,
      data: sorted.map(row => ({ x: new Date(row.timestamp).getTime(), y: row.hopperWeight || 0 })),
      borderColor: color,
      backgroundColor: color + '1a',
      borderWidth: 2,
      tension: 0.3,
      fill: metric === 'hopper',
      pointRadius: 2
    });
  }
  if (metric === 'bowl' || metric === 'both') {
    datasets.push({
      label: `${deviceId} — ชาม (g)`,
      data: sorted.map(row => ({ x: new Date(row.timestamp).getTime(), y: row.bowlWeight || 0 })),
      borderColor: color,
      backgroundColor: color + '1a',
      borderWidth: 2,
      borderDash: metric === 'both' ? [5, 4] : [],
      tension: 0.3,
      fill: metric === 'bowl',
      pointRadius: 2
    });
  }
  return datasets;
}

function formatAxisDate(ms) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function renderChartForMode() {
  const mode = document.getElementById('chartMode').value;
  const metric = document.getElementById('chartMetric').value;
  const timeFilterValue = document.getElementById('timeFilter').value;

  let devicesToPlot = mode === 'multi' ? getSelectedChartDevices() : [getCurrentDevice()];
  if (devicesToPlot.length === 0) devicesToPlot = [getCurrentDevice()];

  const allDatasets = [];
  for (const deviceId of devicesToPlot) {
    if (!deviceId) continue;
    const history = await getDeviceHistory(deviceId);
    const filtered = filterByTime(history, timeFilterValue);
    allDatasets.push(...buildDatasets(deviceId, filtered, metric));
  }

  const ctx = document.getElementById('feederChart').getContext('2d');
  if (feederChart) feederChart.destroy();

  const hasData = allDatasets.some(ds => ds.data.length > 0);
  document.getElementById('chartEmptyMessage').classList.toggle('hidden', hasData);
  if (!hasData) return;

  feederChart = new Chart(ctx, {
    type: 'line',
    data: { datasets: allDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: {
          type: 'linear',
          ticks: {
            maxRotation: 0,
            callback: value => formatAxisDate(value)
          }
        },
        y: { beginAtZero: true }
      },
      plugins: {
        legend: { display: allDatasets.length > 0 },
        tooltip: {
          callbacks: {
            title: items => items.length ? formatAxisDate(items[0].parsed.x) : ''
          }
        }
      }
    }
  });
}

// ---------- History table ----------
let currentPage = 1;
const rowsPerPage = 10;
let allHistoryData = [];

// 1. ฟังก์ชันรับข้อมูลมาเก็บแล้วสั่งเรนเดอร์หน้าแรก
function initHistoryTable(data) {
  allHistoryData = data;
  currentPage = 1; // รีเซ็ตกลับมาหน้าแรกสุด
  renderPagedTable();
}

// 2. ฟังก์ชันตัดแบ่งข้อมูลตามหน้าปัจจุบัน
function renderPagedTable() {
  const tbody = document.getElementById('historyTableBody');

  if (allHistoryData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-400">ไม่พบข้อมูลในช่วงเวลานี้</td></tr>`;
    document.getElementById('paginationControls').innerHTML = ''; // ซ่อนปุ่มกดถ้าไม่มีข้อมูล
    return;
  }

  // คำนวณช่วงข้อมูลที่จะตัดมาแสดง
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedData = allHistoryData.slice(startIndex, endIndex);

  // เรนเดอร์แถวข้อมูลตาราง
  tbody.innerHTML = paginatedData.map(row => `
    <tr class="border-b border-gray-100 hover:bg-gray-50 text-sm">
      <td class="p-3 text-gray-500 whitespace-nowrap">${new Date(row.timestamp).toLocaleString('th-TH') || '-'}</td>
      <td class="p-3 font-medium text-gray-800 whitespace-nowrap">${row.deviceId || '-'}</td>
      <td class="p-3 text-gray-600 whitespace-nowrap">${row.hopperWeight || 0} g</td>
      <td class="p-3 text-gray-600 whitespace-nowrap">${row.bowlWeight || 0} g</td>
      <td class="p-3 whitespace-nowrap"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${statusBadgeClasses(row.status)}">${statusLabel(row.status)}</span></td>
    </tr>
  `).join('');

  // สร้างปุ่มกดเปลี่ยนหน้า
  renderPaginationButtons();
}

// 3. ฟังก์ชันสร้างปุ่มควบคุมหน้า (ก่อนหน้า / ถัดไป / บอกหน้าปัจจุบัน)
function renderPaginationButtons() {
  const totalPages = Math.ceil(allHistoryData.length / rowsPerPage);
  const controlsContainer = document.getElementById('paginationControls');

  if (totalPages <= 1) {
    controlsContainer.innerHTML = '';
    return;
  }

  controlsContainer.innerHTML = `
    <div class="flex justify-between items-center p-4 bg-gray-50 border-t border-gray-200 text-sm text-gray-600">
      <button onclick="changePage(currentPage - 1)" 
        class="px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed" 
        ${currentPage === 1 ? 'disabled' : ''}>
        ◀ ก่อนหน้า
      </button>
      
      <span>หน้า ${currentPage} จาก ${totalPages} (ทั้งหมด ${allHistoryData.length} รายการ)</span>
      
      <button onclick="changePage(currentPage + 1)" 
        class="px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed" 
        ${currentPage === totalPages ? 'disabled' : ''}>
        ถัดไป ▶
      </button>
    </div>
  `;
}

// 4. ฟังก์ชันเปลี่ยนหน้าเมื่อกดปุ่ม
function changePage(targetPage) {
  const totalPages = Math.ceil(allHistoryData.length / rowsPerPage);
  if (targetPage < 1 || targetPage > totalPages) return;
  currentPage = targetPage;
  renderPagedTable();

  // (ทางเลือก) สไลด์หน้าจอขึ้นไปบนสุดของตารางเวลาเปลี่ยนหน้า
  document.getElementById('historyTableBody').scrollIntoView({ behavior: 'smooth' });
}

async function fetchHistory() {
  const scope = document.getElementById('historyScope').value;
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-400">กำลังโหลดประวัติ...</td></tr>`;

  let data = [];
  try {
    if (scope === 'all') {
      const perDevice = await Promise.all(allDevices.map(id => getDeviceHistory(id)));
      data = perDevice.flat();
    } else {
      data = await getDeviceHistory(getCurrentDevice());
    }
  } catch (err) {
    console.error("❌ เกิดข้อผิดพลาดตอนดึงประวัติ:", err);
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-red-400">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>`;
    return;
  }

  // ป้องกันกรณี data เป็น null หรือ undefined
  if (!Array.isArray(data)) data = [];

  console.log("🔍 ข้อมูลดิบก่อน Sort:", data);

  // เรียงลำดับ (เช็คเผื่อฟิลด์เวลาไม่ใช่ timestamp ให้ใช้ตัวที่ Backend ส่งมาจริง เช่น created_at)
  data = [...data].sort((a, b) => {
    const timeA = new Date(a.timestamp || a.created_at || a.time || 0);
    const timeB = new Date(b.timestamp || b.created_at || b.time || 0);
    return timeB - timeA;
  });

  globalHistoryData = data;
  
  // ลองเรียก applyTimeFilter ถ้ามีอยู่, แต่ถ้าไม่มีหรือกลัวพัง ให้สั่งเรนเดอร์ลงตารางตรงนี้เลย
  if (typeof applyTimeFilter === 'function') {
    applyTimeFilter();
  } else {
    renderHistoryTable(data); // หรือฟังก์ชันวาดตารางของคุณ
  }
}

// ---------- Shared time filter (drives both chart and history) ----------

function applyTimeFilter() {
  renderChartForMode();

  const timeFilterValue = document.getElementById('timeFilter').value;


  initHistoryTable(filterByTime(globalHistoryData, timeFilterValue));
}
async function handleRefreshHistory() {
  console.log("🔄 กำลังรีเฟรชข้อมูลใหม่จากเซิร์ฟเวอร์...");
  
  // เคลียร์ค่าข้อมูลเก่าในตัวแปร Global ทิ้งก่อน
  globalHistoryData = [];
  
  // เรียกฟังก์ชันดึงข้อมูลใหม่จาก Backend ตรงๆ
  await fetchHistory();
}
// ---------- Device change ----------

function changeDevice() {
  const deviceId = getCurrentDevice();
  document.getElementById('feedNowDeviceLabel').innerText = deviceId ? `(${deviceId})` : '';
  document.getElementById('scheduleDeviceLabel').innerText = deviceId ? `(${deviceId})` : '';
  fetchSchedule();
  fetchHistory();
}

// ---------- Init ----------

window.onload = () => {
  fetchDevices();
};
