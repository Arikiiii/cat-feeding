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
    .map(t => {
      const parts = t.split(':').map(n => parseInt(n, 10));
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
  const deviceId = getCurrentDevice();
  const timesStr = document.getElementById('scheduleInput').value;
  const timesArray = timesStr.split(',').map(t => t.trim()).filter(t => t);
  const resMsg = document.getElementById('scheduleResult');

  if (timesArray.length === 0) {
    alert('กรุณากรอกเวลาอย่างน้อย 1 ค่า');
    return;
  }

  resMsg.innerText = "⏳ กำลังบันทึก...";
  try {
    const res = await fetch(`${API_BASE}/api/feeder/set-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, times: timesArray })
    });
    const json = await res.json();
    if (json.success) {
      resMsg.innerText = "✅ บันทึกตารางเวลาสำเร็จ!";
      resMsg.className = "text-xs text-center text-green-600 mt-1";
      refreshAllDeviceCards();
    } else {
      resMsg.innerText = "❌ บันทึกไม่สำเร็จ";
      resMsg.className = "text-xs text-center text-red-600 mt-1";
    }
  } catch (err) {
    resMsg.innerText = "❌ เชื่อมต่อ Server ไม่ได้";
    resMsg.className = "text-xs text-center text-red-600 mt-1";
  }
}

async function fetchSchedule() {
  const deviceId = getCurrentDevice();
  const times = await fetchDeviceSchedule(deviceId);
  deviceScheduleCache[deviceId] = times;
  document.getElementById('scheduleInput').value = times.join(', ');
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

function renderHistoryTable(data) {
  const tbody = document.getElementById('historyTableBody');
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-400">ไม่พบข้อมูลในช่วงเวลานี้</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(row => `
    <tr class="hover:bg-gray-50">
      <td class="p-3 text-gray-500">${new Date(row.timestamp).toLocaleString('th-TH') || '-'}</td>
      <td class="p-3 font-medium">${row.deviceId || '-'}</td>
      <td class="p-3">${row.hopperWeight || 0} g</td>
      <td class="p-3">${row.bowlWeight || 0} g</td>
      <td class="p-3"><span class="px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClasses(row.status)}">${statusLabel(row.status)}</span></td>
    </tr>
  `).join('');
}

async function fetchHistory() {
  const scope = document.getElementById('historyScope').value;
  const tbody = document.getElementById('historyTableBody');
  tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-gray-400">กำลังโหลดประวัติ...</td></tr>`;

  let data = [];
  if (scope === 'all') {
    const perDevice = await Promise.all(allDevices.map(id => getDeviceHistory(id)));
    data = perDevice.flat();
  } else {
    data = await getDeviceHistory(getCurrentDevice());
  }

  data = [...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  globalHistoryData = data;
  applyTimeFilter();
}

// ---------- Shared time filter (drives both chart and history) ----------

function applyTimeFilter() {
  renderChartForMode();

  const timeFilterValue = document.getElementById('timeFilter').value;
  renderHistoryTable(filterByTime(globalHistoryData, timeFilterValue));
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
