'use strict';

// ── KSEB Tracker PWA v2.1 | Updated: March 2026 ──────────────────
const APP_VERSION = '2.1.0';
const APP_UPDATED = 'March 2026';

const DB_NAME = 'kseb-tracker-db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

const DEFAULT_CFG = {
  name: 'Family',
  bill_start_date: '2025-09-20',
  bill_due_date: '',
  start_readings: { T1: 12079, T2: 5359, T3: 6670 },
  tod_mode: 'auto',
  current_tariff_mode: 'non-telescopic-tod',
  tod_multipliers: { T1: 0.90, T2: 1.25, T3: 1.00 },
  telescopic_slabs_monthly: [
    [50, 3.35],
    [100, 4.25],
    [150, 5.35],
    [200, 7.2],
    [250, 8.5],
  ],
  non_tel_monthly_brackets: [
    [300, 6.75],
    [350, 7.60],
    [400, 7.95],
    [500, 8.25],
    [99999, 9.20],
  ],
  fixed_charge_telescopic_monthly: [
    [50, 50],
    [100, 85],
    [150, 105],
    [200, 140],
    [250, 160],
  ],
  fixed_charge_non_tel_monthly: [
    [300, 220],
    [350, 240],
    [400, 260],
    [500, 286],
    [99999, 310],
  ],
  electricity_duty_rate: 0.10,
  fuel_surcharge_paise_per_unit: 10,
};

const DEFAULT_STATE = {
  cfg: DEFAULT_CFG,
  readings: [],
  remindertime: '',
  notifon: false,
};

const S = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      reqonsuccess = null;
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    return this.db;
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  },
  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async del(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async keys() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
};

const KEYS = {
  cfg: 'cfg',
  readings: 'readings',
  remindertime: 'remindertime',
  notifon: 'notifon',
  migrated: 'migrated_from_localstorage',
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function getDefaultCfg() {
  return JSON.parse(JSON.stringify(DEFAULT_CFG));
}

function normalizeCfg(cfg) {
  const merged = deepMerge(getDefaultCfg(), cfg || {});
  if (!merged.start_readings) merged.start_readings = { T1: 0, T2: 0, T3: 0 };
  return merged;
}

async function migrateFromLocalStorage() {
  const already = await S.get(KEYS.migrated);
  if (already) return;

  const lsCfg = localStorage.getItem('kseb_cfg');
  const lsReadings = localStorage.getItem('kseb_readings');
  const lsReminderTime = localStorage.getItem('kseb_remindertime');
  const lsNotifOn = localStorage.getItem('kseb_notifon');

  if (lsCfg !== null) {
    try { await S.set(KEYS.cfg, normalizeCfg(JSON.parse(lsCfg))); } catch {}
  }
  if (lsReadings !== null) {
    try { await S.set(KEYS.readings, JSON.parse(lsReadings) || []); } catch {}
  }
  if (lsReminderTime !== null) {
    try { await S.set(KEYS.remindertime, JSON.parse(lsReminderTime)); } catch {}
  }
  if (lsNotifOn !== null) {
    try { await S.set(KEYS.notifon, JSON.parse(lsNotifOn)); } catch {}
  }

  await S.set(KEYS.migrated, true);
}

async function getCfg() {
  const cfg = await S.get(KEYS.cfg);
  return normalizeCfg(cfg || {});
}

async function saveCfg(cfg) {
  await S.set(KEYS.cfg, normalizeCfg(cfg));
}

async function getReadings() {
  return (await S.get(KEYS.readings)) || [];
}

async function saveReadings(arr) {
  await S.set(KEYS.readings, Array.isArray(arr) ? arr : []);
}

async function getReminderTime() {
  return (await S.get(KEYS.remindertime)) || '';
}

async function setReminderTime(v) {
  await S.set(KEYS.remindertime, v || '');
}

async function getNotifOn() {
  return !!(await S.get(KEYS.notifon));
}

async function setNotifOn(v) {
  await S.set(KEYS.notifon, !!v);
}

function computeDueDate(startDateStr, overrideDueDate) {
  if (overrideDueDate) return new Date(overrideDueDate);
  const d = new Date(startDateStr);
  let m = d.getMonth() + 2;
  let y = d.getFullYear();
  if (m > 11) {
    m -= 12;
    y += 1;
  }
  return new Date(y, m, 20);
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function computeBill(cfg, readingsNow) {
  const start = cfg.start_readings;
  let used = {
    T1: Math.max(0, readingsNow.T1 - start.T1),
    T2: Math.max(0, readingsNow.T2 - start.T2),
    T3: Math.max(0, readingsNow.T3 - start.T3),
  };

  if (cfg.tod_mode === 'off') {
    used.T3 += used.T1 + used.T2;
    used.T1 = 0;
    used.T2 = 0;
  }

  const totalUnits = used.T1 + used.T2 + used.T3;
  const startDate = new Date(cfg.bill_start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = computeDueDate(cfg.bill_start_date, cfg.bill_due_date);
  const billingDays = daysBetween(startDate, dueDate);
  const daysElapsed = Math.max(1, daysBetween(startDate, today));
  const monthlyEquivNow = totalUnits > 0 ? (totalUnits * (billingDays / daysElapsed)) / 2 : 0;
  const projectedUnits = totalUnits > 0 ? totalUnits * (billingDays / daysElapsed) : 0;
  const projectedMonthly = projectedUnits / 2;

  const isNonTel =
    cfg.current_tariff_mode === 'non-telescopic-tod' ||
    (cfg.current_tariff_mode === 'auto' && monthlyEquivNow > 250);

  function pickRate(brackets, mu) {
    for (const [l, r] of brackets) if (mu <= l) return r;
    return brackets[brackets.length - 1][1];
  }

  function pickFC(table, mu) {
    for (const [l, f] of table) if (mu <= l) return f;
    return table[table.length - 1][1];
  }

  function todShares(u) {
    const t = u.T1 + u.T2 + u.T3;
    if (!t) return { T1: 0, T2: 0, T3: 0 };
    return { T1: u.T1 / t, T2: u.T2 / t, T3: u.T3 / t };
  }

  function ecNonTel(units, mu, u) {
    const rate = pickRate(cfg.non_tel_monthly_brackets, mu);
    const sh = todShares(u);
    const m = cfg.tod_multipliers;
    const ecn = units * sh.T1 * rate * m.T1;
    const ecp = units * sh.T2 * rate * m.T2;
    const eco = units * sh.T3 * rate * m.T3;
    return { ecn, ecp, eco, total: ecn + ecp + eco };
  }

  function ecTel(units, u) {
    const sh = todShares(u);
    const m = cfg.tod_multipliers;
    let rem = units, ecn = 0, ecp = 0, eco = 0, prev = 0;
    for (const [lim, rate] of cfg.telescopic_slabs_monthly) {
      if (rem <= 0) break;
      const biLim = lim >= 99999 ? 9999999 : lim * 2;
      const chunk = Math.min(rem, biLim - prev);
      prev = biLim;
      if (chunk <= 0) continue;
      ecn += chunk * sh.T1 * rate * m.T1;
      ecp += chunk * sh.T2 * rate * m.T2;
      eco += chunk * sh.T3 * rate * m.T3;
      rem -= chunk;
    }
    return { ecn, ecp, eco, total: ecn + ecp + eco };
  }

  const ec = isNonTel ? ecNonTel(totalUnits, monthlyEquivNow, used) : ecTel(totalUnits, used);
  const fcMonthly = isNonTel
    ? pickFC(cfg.fixed_charge_non_tel_monthly, monthlyEquivNow)
    : pickFC(cfg.fixed_charge_telescopic_monthly, monthlyEquivNow);
  const fcNow = fcMonthly * (daysElapsed / (billingDays / 2));
  const ed = ec.total * cfg.electricity_duty_rate;
  const fs = (totalUnits * cfg.fuel_surcharge_paise_per_unit) / 100;
  const netToday = Math.round(ec.total + ed + fs + fcNow);

  const isNonTelProj =
    cfg.current_tariff_mode === 'non-telescopic-tod' ||
    (cfg.current_tariff_mode === 'auto' && projectedMonthly > 250);
  const ecP = isNonTelProj ? ecNonTel(projectedUnits, projectedMonthly, used) : ecTel(projectedUnits, used);
  const fcPMo = isNonTelProj
    ? pickFC(cfg.fixed_charge_non_tel_monthly, projectedMonthly)
    : pickFC(cfg.fixed_charge_telescopic_monthly, projectedMonthly);
  const edP = ecP.total * cfg.electricity_duty_rate;
  const fsP = (projectedUnits * cfg.fuel_surcharge_paise_per_unit) / 100;
  const netProj = Math.round(ecP.total + edP + fsP + 2 * fcPMo);

  return {
    used,
    totalUnits,
    daysElapsed,
    billingDays,
    dueDate,
    monthlyEquivNow,
    projectedUnits,
    projectedMonthly,
    isNonTel,
    ec,
    fcNow,
    ed,
    fs,
    netToday,
    proj: {
      ec: ecP,
      fc: 2 * fcPMo,
      ed: edP,
      fs: fsP,
      total: netProj,
      units: projectedUnits,
    },
  };
}

function fmt(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function fmtU(n) {
  return (+n).toFixed(1);
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.background = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : 'var(--accent)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  spawnParticles(btn || document.body);
}

function spawnParticles(el) {
  if (!el || !el.getBoundingClientRect) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `left:${cx}px;top:${cy}px;--dx:${(Math.random() - 0.5) * 80}px;--dy:${-(Math.random() * 60 + 20)}px`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 700);
  }
}

function setDefaultDateTime() {
  const el = document.getElementById('inDateTime');
  if (!el) return;
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  el.value = now.toISOString().slice(0, 16);
}

async function refreshDashboard() {
  const cfg = await getCfg();
  const readings = await getReadings();
  if (!readings.length) {
    const hero = document.getElementById('heroAmount');
    if (hero) hero.textContent = fmt(0);
    return;
  }
  const latest = readings[readings.length - 1];
  const bill = computeBill(cfg, latest);

  animateNumber('heroAmount', bill.netToday, v => fmt(v));
  const heroSub = document.getElementById('heroSub');
  if (heroSub) heroSub.textContent = `Day ${bill.daysElapsed} of ${bill.billingDays} · Due ${bill.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  animateNumber('stUnits', bill.totalUnits, v => fmtU(v));
  const stDays = document.getElementById('stDays');
  if (stDays) stDays.textContent = `${bill.daysElapsed}/${bill.billingDays}`;
  animateNumber('stAvg', bill.totalUnits / bill.daysElapsed, v => fmtU(v));
  const stProj = document.getElementById('stProj');
  if (stProj) stProj.textContent = fmt(bill.proj.total);

  const pct = Math.min(100, (bill.daysElapsed / bill.billingDays) * 100);
  setTimeout(() => {
    const bar = document.getElementById('progBar');
    if (bar) bar.style.width = pct + '%';
  }, 100);
  const progDayLabel = document.getElementById('progDayLabel');
  if (progDayLabel) progDayLabel.textContent = `Day ${bill.daysElapsed}`;
  const progEndLabel = document.getElementById('progEndLabel');
  if (progEndLabel) progEndLabel.textContent = `Day ${bill.billingDays}`;

  const heroEl = document.getElementById('heroAmount');
  if (heroEl) heroEl.style.color = bill.proj.total > 8000 ? '#ef4444' : bill.proj.total > 5000 ? '#f59e0b' : '#818cf8';

  const breakupCard = document.getElementById('breakupCard');
  if (breakupCard) breakupCard.style.display = 'block';
  const breakupBody = document.querySelector('#breakupTable tbody');
  if (breakupBody) breakupBody.innerHTML = `
    <tr><td>Energy T1 Normal 0.90</td><td>${fmt(bill.ec.ecn)}</td></tr>
    <tr><td>Energy T2 Peak 1.25</td><td>${fmt(bill.ec.ecp)}</td></tr>
    <tr><td>Energy T3 Off-Peak 1.00</td><td>${fmt(bill.ec.eco)}</td></tr>
    <tr><td><strong>Energy Total</strong></td><td><strong>${fmt(bill.ec.total)}</strong></td></tr>
    <tr><td>Fixed Charge pro-rated</td><td>${fmt(bill.fcNow)}</td></tr>
    <tr><td>Electricity Duty 10%</td><td>${fmt(bill.ed)}</td></tr>
    <tr><td>Fuel Surcharge 10p/u</td><td>${fmt(bill.fs)}</td></tr>
    <tr class="total-row"><td><strong>Net Payable Today</strong></td><td><strong>${fmt(bill.netToday)}</strong></td></tr>
  `;

  const projCard = document.getElementById('projCard');
  if (projCard) projCard.style.display = 'block';
  const projBody = document.querySelector('#projTable tbody');
  if (projBody) projBody.innerHTML = `
    <tr><td>Projected Units</td><td>${fmtU(bill.proj.units)}</td></tr>
    <tr><td>Energy Charge</td><td>${fmt(bill.proj.ec.total)}</td></tr>
    <tr><td>Fixed Charge 2 mo</td><td>${fmt(bill.proj.fc)}</td></tr>
    <tr><td>Electricity Duty</td><td>${fmt(bill.proj.ed)}</td></tr>
    <tr><td>Fuel Surcharge</td><td>${fmt(bill.proj.fs)}</td></tr>
    <tr class="total-row"><td><strong>Projected Total</strong></td><td><strong>${fmt(bill.proj.total)}</strong></td></tr>
  `;

  const mode = bill.isNonTel ? 'NON-TELESCOPIC TOD' : 'TELESCOPIC';
  const badge = document.getElementById('tariffBadge');
  if (badge) badge.innerHTML = `<span class="badge ${bill.isNonTel ? 'badge-yellow' : 'badge-green'}">${mode}</span> <span style="font-size:.75rem;color:var(--muted);margin-left:.5rem">${fmtU(bill.monthlyEquivNow)} u/mo</span>`;
  const headerSub = document.getElementById('headerSub');
  if (headerSub) headerSub.textContent = `${cfg.name || 'Family'} · Due ${bill.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
}

function animateNumber(id, target, formatter) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = 0, dur = 800, startTime = performance.now();
  function step(now) {
    const p = Math.min((now - startTime) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = formatter(start + (target - start) * ease);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function renderLogList() {
  const readings = await getReadings();
  const cfg = await getCfg();
  const container = document.getElementById('logList');
  if (!container) return;
  if (!readings.length) {
    container.innerHTML = '<p class="empty-msg">No readings yet. Add your first reading above.</p>';
    return;
  }
  container.innerHTML = readings.slice().reverse().map((r, ri) => {
    const i = readings.length - 1 - ri;
    const bill = computeBill(cfg, r);
    const du = i > 0 ? r.T1 + r.T2 + r.T3 - (readings[i - 1].T1 + readings[i - 1].T2 + readings[i - 1].T3) : 0;
    const duClass = du > 15 ? 'red' : du > 8 ? 'yellow' : 'green';
    return `
      <div class="log-item">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.88rem">T1 ${r.T1} · T2 ${r.T2} · T3 ${r.T3}</div>
          <div class="log-meta">
            ${new Date(r.dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            &nbsp;&nbsp;<span class="badge ${duClass}" style="font-size:.68rem">${du} u</span>
            &nbsp;&nbsp;<strong style="color:var(--accent2)">${fmt(bill.netToday)}</strong>
          </div>
        </div>
        <div class="log-actions">
          <button class="btn btn-warn" style="padding:.35rem .7rem;font-size:.75rem" onclick="openEdit(${i})">Edit</button>
          <button class="btn btn-danger" style="padding:.35rem .7rem;font-size:.75rem" onclick="deleteReading(${i})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

async function addReading() {
  const t1 = parseFloat(document.getElementById('inT1').value);
  const t2 = parseFloat(document.getElementById('inT2').value);
  const t3 = parseFloat(document.getElementById('inT3').value);
  const dt = document.getElementById('inDateTime').value;

  if (isNaN(t1) || isNaN(t2) || isNaN(t3) || !dt) {
    toast('Please fill all fields', 'error');
    return;
  }

  const cfg = await getCfg();
  const sr = cfg.start_readings;
  if (t1 < sr.T1 || t2 < sr.T2 || t3 < sr.T3) {
    if (!confirm('One or more readings are below your start readings. Continue?')) return;
  }

  const readings = await getReadings();
  readings.push({ T1: t1, T2: t2, T3: t3, dt });
  await saveReadings(readings);
  await renderLogList();
  await refreshDashboard();
  toast('Reading saved!', 'success');
  ['inT1', 'inT2', 'inT3'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  setDefaultDateTime();
}

async function deleteReading(i) {
  if (!confirm('Delete this reading?')) return;
  const r = await getReadings();
  r.splice(i, 1);
  await saveReadings(r);
  await renderLogList();
  await refreshDashboard();
  toast('Deleted', 'success');
}

async function openEdit(i) {
  const r = await getReadings();
  const item = r[i];
  if (!item) return;
  document.getElementById('editIdx').value = i;
  document.getElementById('editT1').value = item.T1;
  document.getElementById('editT2').value = item.T2;
  document.getElementById('editT3').value = item.T3;
  document.getElementById('editModal').style.display = 'flex';
}

function closeEdit() {
  document.getElementById('editModal').style.display = 'none';
}

async function saveEdit() {
  const i = parseInt(document.getElementById('editIdx').value);
  const r = await getReadings();
  if (!r[i]) return;
  r[i].T1 = parseFloat(document.getElementById('editT1').value);
  r[i].T2 = parseFloat(document.getElementById('editT2').value);
  r[i].T3 = parseFloat(document.getElementById('editT3').value);
  await saveReadings(r);
  closeEdit();
  await renderLogList();
  await refreshDashboard();
  toast('Updated', 'success');
}

function destroyChart(id) {
  if (window.charts && charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 800, easing: 'easeOutQuart' },
  plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 30 }, grid: { color: 'rgba(255,255,255,.04)', borderColor: 'rgba(255,255,255,.1)' } },
    y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.04)', borderColor: 'rgba(255,255,255,.1)' } },
  },
};

async function renderCharts() {
  const readings = await getReadings();
  const cfg = await getCfg();
  if (!readings.length) {
    const msg = document.getElementById('noChartMsg');
    if (msg) msg.style.display = 'block';
    return;
  }
  const msg = document.getElementById('noChartMsg');
  if (msg) msg.style.display = 'none';
  window.charts = window.charts || {};

  const labels = readings.map(r => new Date(r.dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
  const dailyDelta = readings.map((r, i) => i === 0 ? 0 : r.T1 + r.T2 + r.T3 - (readings[i - 1].T1 + readings[i - 1].T2 + readings[i - 1].T3));
  const billArr = readings.map(r => computeBill(cfg, r).netToday);
  const predArr = readings.map(r => computeBill(cfg, r).proj.total);

  destroyChart('chartDaily');
  charts.chartDaily = new Chart(document.getElementById('chartDaily'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Daily Units',
        data: dailyDelta,
        backgroundColor: dailyDelta.map(v => v > 15 ? 'rgba(239,68,68,.75)' : v > 8 ? 'rgba(245,158,11,.75)' : 'rgba(99,102,241,.75)'),
        borderColor: dailyDelta.map(v => v > 15 ? '#ef4444' : v > 8 ? '#f59e0b' : '#818cf8'),
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } } },
  });

  destroyChart('chartBill');
  charts.chartBill = new Chart(document.getElementById('chartBill'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Bill So Far',
        data: billArr,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,.08)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#22c55e',
        pointRadius: 4,
        pointHoverRadius: 7,
      }],
    },
    options: CHART_DEFAULTS,
  });

  const lastBill = computeBill(cfg, readings[readings.length - 1]);
  destroyChart('chartTOD');
  charts.chartTOD = new Chart(document.getElementById('chartTOD'), {
    type: 'doughnut',
    data: {
      labels: ['T1 Normal 6am-6pm', 'T2 Peak 6pm-10pm', 'T3 Off-Peak 10pm-6am'],
      datasets: [{
        data: [lastBill.used.T1, lastBill.used.T2, lastBill.used.T3],
        backgroundColor: ['rgba(99,102,241,.85)', 'rgba(239,68,68,.85)', 'rgba(34,197,94,.85)'],
        borderWidth: 0,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      animation: { animateRotate: true, duration: 1000 },
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 12 } } },
    },
  });

  destroyChart('chartPred');
  charts.chartPred = new Chart(document.getElementById('chartPred'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Projected Bill',
          data: predArr,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,.08)',
          fill: true,
          tension: 0.4,
          borderDash: [5, 3],
          pointRadius: 3,
        },
        {
          label: 'Actual Bill',
          data: billArr,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
        },
      ],
    },
    options: CHART_DEFAULTS,
  });
}

async function loadSettingsUI() {
  const cfg = await getCfg();
  document.getElementById('cfgName').value = cfg.name;
  document.getElementById('cfgStartDate').value = cfg.bill_start_date;
  document.getElementById('cfgDueDate').value = cfg.bill_due_date;
  document.getElementById('cfgT1').value = cfg.start_readings.T1;
  document.getElementById('cfgT2').value = cfg.start_readings.T2;
  document.getElementById('cfgT3').value = cfg.start_readings.T3;
  document.getElementById('cfgTariff').value = cfg.current_tariff_mode;
  document.getElementById('cfgTOD').value = cfg.tod_mode;

  const rt = await getReminderTime();
  if (rt) document.getElementById('cfgReminderTime').value = rt;
  document.getElementById('notifDot').className = 'notif-status ' + ((await getNotifOn()) ? 'on' : 'off');
  updateDueDatePreview();
}

function updateDueDatePreview() {
  const sd = document.getElementById('cfgStartDate').value;
  const override = document.getElementById('cfgDueDate').value;
  if (!sd) return;
  const due = computeDueDate(sd, override || null);
  document.getElementById('dueDatePreview').textContent = 'Auto-calculated due: ' + due.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function saveSettings() {
  const cfg = await getCfg();
  const next = {
    ...cfg,
    name: document.getElementById('cfgName').value,
    bill_start_date: document.getElementById('cfgStartDate').value,
    bill_due_date: document.getElementById('cfgDueDate').value,
    start_readings: {
      T1: parseFloat(document.getElementById('cfgT1').value || 0),
      T2: parseFloat(document.getElementById('cfgT2').value || 0),
      T3: parseFloat(document.getElementById('cfgT3').value || 0),
    },
    current_tariff_mode: document.getElementById('cfgTariff').value,
    tod_mode: document.getElementById('cfgTOD').value,
  };
  await saveCfg(next);
  await refreshDashboard();
  await renderLogList();
  toast('Settings saved!', 'success');
}

async function clearAllData() {
  if (!confirm('Delete ALL readings and settings? This cannot be undone.')) return;
  await S.clear();
  localStorage.removeItem('kseb_cfg');
  localStorage.removeItem('kseb_readings');
  localStorage.removeItem('kseb_remindertime');
  localStorage.removeItem('kseb_notifon');
  await loadInitialData();
  toast('All data cleared', 'success');
}

function parseBillText(text) {
  const patterns = {
    startdate: /(?:bill\s*from|from\s*date|billing\s*period).*?(\d{1,2}-\d{1,2}-\d{4})/i,
    t1: /T1[^0-9]*([0-9]+(?:\.[0-9]+)?)/i,
    t2: /T2[^0-9]*([0-9]+(?:\.[0-9]+)?)/i,
    t3: /T3[^0-9]*([0-9]+(?:\.[0-9]+)?)/i,
    due: /(?:due\s*date|payment\s*due).*?(\d{1,2}-\d{1,2}-\d{4})/i,
  };
  const result = {};
  for (const [key, rx] of Object.entries(patterns)) {
    const m = text.match(rx);
    if (m) result[key] = m[1];
  }
  return result;
}

function handleBillTextPaste() {
  const text = document.getElementById('billTextInput').value;
  if (!text.trim()) return toast('Paste your bill text first', 'error');
  const parsed = parseBillText(text);
  let filled = 0;
  if (parsed.t1) { document.getElementById('cfgT1').value = parsed.t1; filled++; }
  if (parsed.t2) { document.getElementById('cfgT2').value = parsed.t2; filled++; }
  if (parsed.t3) { document.getElementById('cfgT3').value = parsed.t3; filled++; }
  if (parsed.startdate) { document.getElementById('cfgStartDate').value = parsed.startdate; filled++; }
  if (parsed.due) { document.getElementById('cfgDueDate').value = parsed.due; filled++; }
  updateDueDatePreview();
  toast(filled ? `Auto-filled ${filled} fields from bill!` : 'Could not extract data. Fill manually.', filled ? 'success' : 'error');
}

async function scheduleNotification() {
  if (!('Notification' in window)) return toast('Notifications not supported', 'error');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Permission denied', 'error');

  const timeStr = document.getElementById('cfgReminderTime').value || '20:00';
  await setReminderTime(timeStr);
  await setNotifOn(true);
  document.getElementById('notifDot').className = 'notif-status on';

  const [hh, mm] = timeStr.split(':').map(Number);
  let next = new Date();
  next.setHours(hh, mm, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  const msUntil = next - new Date();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'SCHEDULE_NOTIFICATION', ms: msUntil, timeStr });
      toast(`Reminder set for ${timeStr} daily`, 'success');
    });
  }
}

async function shareToWhatsApp() {
  const cfg = await getCfg();
  const readings = await getReadings();
  if (!readings.length) return toast('No readings to share', 'error');
  const r = readings[readings.length - 1];
  const bill = computeBill(cfg, r);
  const msg = `KSEB Tracker\nDay ${bill.daysElapsed}/${bill.billingDays}\nMeter: T1 ${r.T1} T2 ${r.T2} T3 ${r.T3}\nUsed: ${fmtU(bill.totalUnits)} units\nT1 Normal: ${fmtU(bill.used.T1)} u\nT2 Peak: ${fmtU(bill.used.T2)} u\nT3 Off-Peak: ${fmtU(bill.used.T3)} u\nPace: ${fmtU(bill.monthlyEquivNow)} u/mo\nEst. Today: ${fmt(bill.netToday)}\nProjected: ${fmt(bill.proj.total)}\nDue: ${bill.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}\nvia KSEB Tracker PWA v${APP_VERSION}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

async function renderInfo() {
  const cfg = await getCfg();
  document.getElementById('tariffInfoBody').innerHTML = `
    <table>
      <tr><th>Parameter</th><th>Value</th></tr>
      <tr><td>Bill Start</td><td>${cfg.bill_start_date}</td></tr>
      <tr><td>Due Date</td><td>${computeDueDate(cfg.bill_start_date, cfg.bill_due_date).toLocaleDateString('en-IN')}</td></tr>
      <tr><td>Start T1 Normal</td><td>${cfg.start_readings.T1}</td></tr>
      <tr><td>Start T2 Peak</td><td>${cfg.start_readings.T2}</td></tr>
      <tr><td>Start T3 Off-Peak</td><td>${cfg.start_readings.T3}</td></tr>
      <tr><td>Tariff Mode</td><td>${cfg.current_tariff_mode}</td></tr>
      <tr><td>TOD Mode</td><td>${cfg.tod_mode}</td></tr>
      <tr><td>T1 Multiplier</td><td>${cfg.tod_multipliers.T1} 10% discount</td></tr>
      <tr><td>T2 Multiplier</td><td>${cfg.tod_multipliers.T2} 25% surcharge</td></tr>
      <tr><td>T3 Multiplier</td><td>${cfg.tod_multipliers.T3} normal</td></tr>
      <tr><td>Electricity Duty</td><td>${cfg.electricity_duty_rate * 100}% of EC</td></tr>
      <tr><td>Fuel Surcharge</td><td>${cfg.fuel_surcharge_paise_per_unit} paise/unit</td></tr>
    </table>
  `;
}

async function exportBackup() {
  const backup = {
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    cfg: await getCfg(),
    readings: await getReadings(),
    remindertime: await getReminderTime(),
    notifon: await getNotifOn(),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kseb-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importBackupFile(file) {
  const txt = await file.text();
  const data = JSON.parse(txt);
  if (!data || typeof data !== 'object') throw new Error('Invalid backup');
  if (data.cfg) await saveCfg(normalizeCfg(data.cfg));
  if (Array.isArray(data.readings)) await saveReadings(data.readings);
  if (typeof data.remindertime === 'string') await setReminderTime(data.remindertime);
  if (typeof data.notifon === 'boolean') await setNotifOn(data.notifon);
  await loadInitialData();
  toast('Backup restored', 'success');
}

async function loadInitialData() {
  await migrateFromLocalStorage();
  await loadSettingsUI();
  await renderLogList();
  await refreshDashboard();
  if (document.getElementById('appVersionInfo')) document.getElementById('appVersionInfo').textContent = `v${APP_VERSION} Updated ${APP_UPDATED}`;
  const vEl = document.getElementById('footerVersion');
  if (vEl) vEl.textContent = `v${APP_VERSION}`;
}

function bindEvents() {
  document.getElementById('cfgStartDate').addEventListener('change', updateDueDatePreview);
  document.getElementById('cfgDueDate').addEventListener('change', updateDueDatePreview);
  ['cfgName', 'cfgStartDate', 'cfgDueDate', 'cfgT1', 'cfgT2', 'cfgT3', 'cfgTariff', 'cfgTOD'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {});
  });

  const importInput = document.getElementById('importBackupInput');
  if (importInput) {
    importInput.addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        try { await importBackupFile(file); } catch { toast('Could not import backup', 'error'); }
      }
      importInput.value = '';
    });
  }
}

window.showPage = showPage;
window.addReading = addReading;
window.deleteReading = deleteReading;
window.openEdit = openEdit;
window.closeEdit = closeEdit;
window.saveEdit = saveEdit;
window.saveSettings = saveSettings;
window.clearAllData = clearAllData;
window.handleBillTextPaste = handleBillTextPaste;
window.scheduleNotification = scheduleNotification;
window.shareToWhatsApp = shareToWhatsApp;
window.renderCharts = renderCharts;
window.renderInfo = renderInfo;
window.exportBackup = exportBackup;

document.addEventListener('DOMContentLoaded', async () => {
  setDefaultDateTime();
  bindEvents();
  await loadInitialData();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      console.log('SW registered');
      getReminderTime().then(rt => {
        getNotifOn().then(on => {
          if (rt && on && reg.active) {
            const [hh, mm] = rt.split(':').map(Number);
            let next = new Date();
            next.setHours(hh, mm, 0, 0);
            if (next <= new Date()) next.setDate(next.getDate() + 1);
            reg.active.postMessage({ type: 'SCHEDULE_NOTIFICATION', ms: next - new Date(), timeStr: rt });
          }
        });
      });
    }).catch(console.error);
  });
}
