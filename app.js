'use strict';

const DEFAULT_CFG = {
  name: 'Family',
  bill_start_date: '2025-09-20',
  start_readings: { T1: 12079, T2: 5359, T3: 6670 },
  tod_mode: 'auto',
  current_tariff_mode: 'non-telescopic-tod',
  tod_multipliers: { T1: 0.90, T2: 1.25, T3: 1.00 },
  telescopic_slabs_monthly: [[50,3.35],[100,4.25],[150,5.35],[200,7.2],[250,8.5]],
  non_tel_monthly_brackets: [[300,6.75],[350,7.60],[400,7.95],[500,8.25],[99999,9.20]],
  fixed_charge_telescopic_monthly: [[50,50],[100,85],[150,105],[200,140],[250,160]],
  fixed_charge_non_tel_monthly: [[300,220],[350,240],[400,260],[500,286],[99999,310]],
  electricity_duty_rate: 0.10,
  fuel_surcharge_paise_per_unit: 10,
};

const S = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

function getCfg() { return Object.assign({}, DEFAULT_CFG, S.get('kseb_cfg') || {}); }
function getReadings() { return S.get('kseb_readings') || []; }
function saveReadings(arr) { S.set('kseb_readings', arr); }

function computeDueDate(startDateStr) {
  const d = new Date(startDateStr);
  let m = d.getMonth() + 2;
  let y = d.getFullYear();
  if (m > 11) { m -= 12; y += 1; }
  return new Date(y, m, 20);
}
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

function computeBill(cfg, readingsNow) {
  const start = cfg.start_readings;
  let used = {
    T1: Math.max(0, readingsNow.T1 - start.T1),
    T2: Math.max(0, readingsNow.T2 - start.T2),
    T3: Math.max(0, readingsNow.T3 - start.T3),
  };
  if (cfg.tod_mode === 'off') { used.T3 += used.T1 + used.T2; used.T1 = 0; used.T2 = 0; }

  const totalUnits = used.T1 + used.T2 + used.T3;
  const startDate = new Date(cfg.bill_start_date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDate = computeDueDate(cfg.bill_start_date);
  const billingDays = daysBetween(startDate, dueDate);
  const daysElapsed = Math.max(1, daysBetween(startDate, today));

  const monthlyEquivNow = totalUnits > 0 ? (totalUnits * (billingDays / daysElapsed)) / 2 : 0;
  const projectedUnits = totalUnits > 0 ? totalUnits * (billingDays / daysElapsed) : 0;
  const projectedMonthly = projectedUnits / 2;

  const isNonTel = cfg.current_tariff_mode === 'non-telescopic-tod' ||
    (cfg.current_tariff_mode === 'auto' && monthlyEquivNow > 250);

  function pickRate(brackets, mu) {
    for (const [lim, rate] of brackets) if (mu <= lim) return rate;
    return brackets[brackets.length - 1][1];
  }
  function pickFC(table, mu) {
    for (const [lim, fc] of table) if (mu <= lim) return fc;
    return table[table.length - 1][1];
  }
  function todShares(u) {
    const tot = u.T1 + u.T2 + u.T3;
    if (!tot) return { T1: 0, T2: 0, T3: 0 };
    return { T1: u.T1 / tot, T2: u.T2 / tot, T3: u.T3 / tot };
  }

  function ecNonTel(units, mu, u) {
    const rate = pickRate(cfg.non_tel_monthly_brackets, mu);
    const sh = todShares(u), m = cfg.tod_multipliers;
    const ecn = units * sh.T1 * rate * m.T1;
    const ecp = units * sh.T2 * rate * m.T2;
    const eco = units * sh.T3 * rate * m.T3;
    return { ecn, ecp, eco, total: ecn + ecp + eco };
  }

  function ecTel(units, u) {
    const sh = todShares(u), m = cfg.tod_multipliers;
    let rem = units, ecn = 0, ecp = 0, eco = 0, prevLim = 0;
    for (const [lim, rate] of cfg.telescopic_slabs_monthly) {
      if (rem <= 0) break;
      const biLim = lim >= 99999 ? 9999999 : lim * 2;
      const chunk = Math.min(rem, biLim - prevLim); prevLim = biLim;
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
  const fs = totalUnits * cfg.fuel_surcharge_paise_per_unit / 100;
  const netToday = Math.round(ec.total + ed + fs + fcNow);

  const isNonTelProj = cfg.current_tariff_mode === 'non-telescopic-tod' ||
    (cfg.current_tariff_mode === 'auto' && projectedMonthly > 250);
  const ecP = isNonTelProj ? ecNonTel(projectedUnits, projectedMonthly, used) : ecTel(projectedUnits, used);
  const fcPMonthly = isNonTelProj
    ? pickFC(cfg.fixed_charge_non_tel_monthly, projectedMonthly)
    : pickFC(cfg.fixed_charge_telescopic_monthly, projectedMonthly);
  const edP = ecP.total * cfg.electricity_duty_rate;
  const fsP = projectedUnits * cfg.fuel_surcharge_paise_per_unit / 100;
  const netProj = Math.round(ecP.total + edP + fsP + 2 * fcPMonthly);

  return {
    used, totalUnits, daysElapsed, billingDays, dueDate,
    monthlyEquivNow, projectedUnits, projectedMonthly,
    isNonTel, ec, fcNow, ed, fs, netToday,
    proj: { ec: ecP, fc: 2 * fcPMonthly, ed: edP, fs: fsP, total: netProj, units: projectedUnits }
  };
}

function fmt(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
function fmtU(n) { return (+n).toFixed(1); }

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function showPage(name, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function refreshDashboard() {
  const cfg = getCfg();
  const readings = getReadings();
  if (!readings.length) return;
  const latest = readings[readings.length - 1];
  const bill = computeBill(cfg, latest);

  document.getElementById('heroAmount').textContent = fmt(bill.netToday);
  document.getElementById('heroSub').textContent =
    `Day ${bill.daysElapsed} of ${bill.billingDays} · Due ${bill.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  document.getElementById('stUnits').textContent = fmtU(bill.totalUnits);
  document.getElementById('stDays').textContent = `${bill.daysElapsed}/${bill.billingDays}`;
  document.getElementById('stAvg').textContent = fmtU(bill.totalUnits / bill.daysElapsed);
  document.getElementById('stProj').textContent = fmt(bill.proj.total);

  const pct = Math.min(100, (bill.daysElapsed / bill.billingDays) * 100);
  document.getElementById('progBar').style.width = pct + '%';
  document.getElementById('progDayLabel').textContent = `Day ${bill.daysElapsed}`;
  document.getElementById('progEndLabel').textContent = `Day ${bill.billingDays}`;

  document.getElementById('breakupCard').style.display = '';
  document.querySelector('#breakupTable tbody').innerHTML = `
    <tr><td>⚡ Energy – T1 Normal</td><td>${fmt(bill.ec.ecn)}</td></tr>
    <tr><td>⚡ Energy – T2 Peak</td><td>${fmt(bill.ec.ecp)}</td></tr>
    <tr><td>⚡ Energy – T3 Off-Peak</td><td>${fmt(bill.ec.eco)}</td></tr>
    <tr><td><strong>Energy Total</strong></td><td><strong>${fmt(bill.ec.total)}</strong></td></tr>
    <tr><td>🏦 Fixed Charge (pro-rated)</td><td>${fmt(bill.fcNow)}</td></tr>
    <tr><td>🔌 Electricity Duty (10%)</td><td>${fmt(bill.ed)}</td></tr>
    <tr><td>⛽ Fuel Surcharge</td><td>${fmt(bill.fs)}</td></tr>
    <tr style="background:rgba(99,102,241,.1)"><td><strong>Net Payable Today</strong></td><td><strong>${fmt(bill.netToday)}</strong></td></tr>
  `;

  document.getElementById('projCard').style.display = '';
  document.querySelector('#projTable tbody').innerHTML = `
    <tr><td>📦 Projected Units</td><td>${fmtU(bill.proj.units)}</td></tr>
    <tr><td>⚡ Energy Charge</td><td>${fmt(bill.proj.ec.total)}</td></tr>
    <tr><td>🏦 Fixed Charge (2 mo)</td><td>${fmt(bill.proj.fc)}</td></tr>
    <tr><td>🔌 Electricity Duty</td><td>${fmt(bill.proj.ed)}</td></tr>
    <tr><td>⛽ Fuel Surcharge</td><td>${fmt(bill.proj.fs)}</td></tr>
    <tr style="background:rgba(99,102,241,.1)"><td><strong>Projected Total</strong></td><td><strong>${fmt(bill.proj.total)}</strong></td></tr>
  `;

  const mode = bill.isNonTel ? 'NON-TELESCOPIC + TOD' : 'TELESCOPIC';
  const cls = bill.isNonTel ? 'badge-yellow' : 'badge-green';
  document.getElementById('tariffBadge').innerHTML =
    `<span class="badge ${cls}">${mode}</span>
     <span style="font-size:.75rem;color:var(--muted);margin-left:.5rem">Monthly equiv: ${fmtU(bill.monthlyEquivNow)} u/mo</span>`;

  const cfg2 = getCfg();
  document.getElementById('headerSub').textContent =
    `${cfg2.name || 'Family'} · Due ${bill.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
}

function setDefaultDateTime() {
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('inDateTime').value = now.toISOString().slice(0, 16);
}

function addReading() {
  const t1 = parseFloat(document.getElementById('inT1').value);
  const t2 = parseFloat(document.getElementById('inT2').value);
  const t3 = parseFloat(document.getElementById('inT3').value);
  const dt = document.getElementById('inDateTime').value;
  if (isNaN(t1) || isNaN(t2) || isNaN(t3) || !dt) { toast('⚠️ Please fill all fields'); return; }
  const readings = getReadings();
  readings.push({ T1: t1, T2: t2, T3: t3, dt });
  saveReadings(readings);
  renderLogList(); refreshDashboard();
  toast('✅ Reading saved!');
  document.getElementById('inT1').value = '';
  document.getElementById('inT2').value = '';
  document.getElementById('inT3').value = '';
}

function renderLogList() {
  const readings = getReadings();
  const container = document.getElementById('logList');
  if (!readings.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:.82rem;text-align:center;padding:.5rem">No readings yet.</p>';
    return;
  }
  const cfg = getCfg();
  container.innerHTML = readings.map((r, i) => {
    const bill = computeBill(cfg, r);
    const du = i > 0 ? (r.T1 + r.T2 + r.T3 - (readings[i-1].T1 + readings[i-1].T2 + readings[i-1].T3)).toFixed(1) : '–';
    return `<div class="log-item">
      <div>
        <div style="font-weight:600;font-size:.88rem">T1:${r.T1} · T2:${r.T2} · T3:${r.T3}</div>
        <div class="log-meta">📅 ${new Date(r.dt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
          &nbsp;|&nbsp; Δ ${du} u &nbsp;|&nbsp; <strong style="color:var(--accent2)">${fmt(bill.netToday)}</strong></div>
      </div>
      <div class="log-actions">
        <button class="btn btn-warn" style="padding:.35rem .7rem;font-size:.75rem" onclick="openEdit(${i})">✏️</button>
        <button class="btn btn-danger" style="padding:.35rem .7rem;font-size:.75rem" onclick="deleteReading(${i})">🗑️</button>
      </div>
    </div>`;
  }).reverse().join('');
}

function deleteReading(i) {
  if (!confirm('Delete this reading?')) return;
  const r = getReadings(); r.splice(i, 1); saveReadings(r);
  renderLogList(); refreshDashboard(); toast('🗑️ Deleted');
}

function openEdit(i) {
  const r = getReadings()[i];
  document.getElementById('editIdx').value = i;
  document.getElementById('editT1').value = r.T1;
  document.getElementById('editT2').value = r.T2;
  document.getElementById('editT3').value = r.T3;
  document.getElementById('editModal').style.display = 'flex';
}
function closeEdit() { document.getElementById('editModal').style.display = 'none'; }
function saveEdit() {
  const i = parseInt(document.getElementById('editIdx').value);
  const r = getReadings();
  r[i].T1 = parseFloat(document.getElementById('editT1').value);
  r[i].T2 = parseFloat(document.getElementById('editT2').value);
  r[i].T3 = parseFloat(document.getElementById('editT3').value);
  saveReadings(r); closeEdit(); renderLogList(); refreshDashboard(); toast('✅ Updated');
}

let charts = {};
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
    y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } }
  }
};

function renderCharts() {
  const readings = getReadings();
  const cfg = getCfg();
  if (!readings.length) return;

  const labels = readings.map(r => new Date(r.dt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
  const dailyDelta = readings.map((r, i) => i === 0 ? 0 : (r.T1+r.T2+r.T3) - (readings[i-1].T1+readings[i-1].T2+readings[i-1].T3));
  const billArr = readings.map(r => computeBill(cfg, r).netToday);
  const predArr = readings.map(r => computeBill(cfg, r).proj.total);

  destroyChart('chartDaily');
  charts.chartDaily = new Chart(document.getElementById('chartDaily'), {
    type: 'bar', data: { labels, datasets: [{ label: 'Daily Units', data: dailyDelta,
      backgroundColor: 'rgba(99,102,241,.7)', borderColor: '#818cf8', borderWidth: 1, borderRadius: 5 }] },
    options: { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }
  });

  destroyChart('chartBill');
  charts.chartBill = new Chart(document.getElementById('chartBill'), {
    type: 'line', data: { labels, datasets: [{ label: 'Bill (₹)', data: billArr,
      borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', fill: true, tension: .4, pointRadius: 4 }] },
    options: CHART_OPTS
  });

  const lastBill = computeBill(cfg, readings[readings.length-1]);
  destroyChart('chartTOD');
  charts.chartTOD = new Chart(document.getElementById('chartTOD'), {
    type: 'doughnut', data: {
      labels: ['T1 Normal', 'T2 Peak', 'T3 Off-Peak'],
      datasets: [{ data: [lastBill.used.T1, lastBill.used.T2, lastBill.used.T3],
        backgroundColor: ['rgba(99,102,241,.8)', 'rgba(239,68,68,.8)', 'rgba(34,197,94,.8)'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } } }
  });

  destroyChart('chartPred');
  charts.chartPred = new Chart(document.getElementById('chartPred'), {
    type: 'line', data: { labels, datasets: [
      { label: 'Projected Bill', data: predArr, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,.1)', fill: true, tension: .4, borderDash: [5,3] },
      { label: 'Actual Bill So Far', data: billArr, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,.1)', fill: true, tension: .4 }
    ]}, options: CHART_OPTS
  });
}

function loadSettingsUI() {
  const cfg = getCfg();
  document.getElementById('cfgName').value = cfg.name || '';
  document.getElementById('cfgStartDate').value = cfg.bill_start_date || '';
  document.getElementById('cfgT1').value = cfg.start_readings.T1;
  document.getElementById('cfgT2').value = cfg.start_readings.T2;
  document.getElementById('cfgT3').value = cfg.start_readings.T3;
  document.getElementById('cfgTariff').value = cfg.current_tariff_mode;
  document.getElementById('cfgTOD').value = cfg.tod_mode;
  const remTime = S.get('kseb_reminder_time');
  if (remTime) document.getElementById('cfgReminderTime').value = remTime;
  document.getElementById('notifDot').className = 'notif-status' + (S.get('kseb_notif_on') ? ' on' : '');
}

function saveSettings() {
  const existing = getCfg();
  S.set('kseb_cfg', { ...existing,
    name: document.getElementById('cfgName').value,
    bill_start_date: document.getElementById('cfgStartDate').value,
    start_readings: {
      T1: parseFloat(document.getElementById('cfgT1').value) || 0,
      T2: parseFloat(document.getElementById('cfgT2').value) || 0,
      T3: parseFloat(document.getElementById('cfgT3').value) || 0,
    },
    current_tariff_mode: document.getElementById('cfgTariff').value,
    tod_mode: document.getElementById('cfgTOD').value,
  });
  refreshDashboard(); renderLogList(); toast('✅ Settings saved!');
}

function clearAllData() {
  if (!confirm('⚠️ Delete ALL readings and settings?')) return;
  ['kseb_readings', 'kseb_cfg', 'kseb_notif_on'].forEach(k => localStorage.removeItem(k));
  refreshDashboard(); renderLogList(); loadSettingsUI(); toast('🗑️ All data cleared');
}

async function scheduleNotification() {
  if (!('Notification' in window)) { toast('Notifications not supported'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('❌ Permission denied'); return; }
  const timeStr = document.getElementById('cfgReminderTime').value || '20:00';
  S.set('kseb_reminder_time', timeStr);
  S.set('kseb_notif_on', true);
  document.getElementById('notifDot').className = 'notif-status on';
  const [hh, mm] = timeStr.split(':').map(Number);
  let next = new Date(); next.setHours(hh, mm, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  const msUntil = next - new Date();
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE_NOTIFICATION', ms: msUntil });
  } else {
    setTimeout(() => new Notification('⚡ KSEB Tracker', { body: "Time to log today's meter readings!" }), msUntil);
  }
  toast(`🔔 Reminder set for ${timeStr}`);
}

function shareToWhatsApp() {
  const cfg = getCfg();
  const readings = getReadings();
  if (!readings.length) { toast('⚠️ No readings to share'); return; }
  const r = readings[readings.length - 1];
  const bill = computeBill(cfg, r);
  const msg = `⚡ *KSEB Tracker Update* – Day ${bill.daysElapsed}/${bill.billingDays}

📟 *Readings*: T1=${r.T1} | T2=${r.T2} | T3=${r.T3}
📦 *Used*: ${fmtU(bill.totalUnits)} units (T1=${fmtU(bill.used.T1)}, T2=${fmtU(bill.used.T2)}, T3=${fmtU(bill.used.T3)})
📅 *Monthly pace*: ~${fmtU(bill.monthlyEquivNow)} u/mo
⚡ *Avg daily*: ${fmtU(bill.totalUnits / bill.daysElapsed)} u/day
⚠️ *Tariff*: ${bill.isNonTel ? 'Non-Telescopic+TOD' : 'Telescopic'}

💰 *If billed today*: ${fmt(bill.netToday)}
  • Energy: ${fmt(bill.ec.total)}
  • Fixed: ${fmt(bill.fcNow)} | Duty: ${fmt(bill.ed)} | FSC: ${fmt(bill.fs)}

🔮 *Projected bill*: ${fmt(bill.proj.total)} (~${fmtU(bill.proj.units)} units)
📅 *Due*: ${bill.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

function renderInfo() {
  const cfg = getCfg();
  document.getElementById('tariffInfoBody').innerHTML = `
    <table>
      <tr><th>Parameter</th><th>Value</th></tr>
      <tr><td>Bill Start</td><td>${cfg.bill_start_date}</td></tr>
      <tr><td>Due Date</td><td>${computeDueDate(cfg.bill_start_date).toLocaleDateString('en-IN')}</td></tr>
      <tr><td>Start T1/T2/T3</td><td>${cfg.start_readings.T1} / ${cfg.start_readings.T2} / ${cfg.start_readings.T3}</td></tr>
      <tr><td>Tariff Mode</td><td>${cfg.current_tariff_mode}</td></tr>
      <tr><td>TOD Mode</td><td>${cfg.tod_mode}</td></tr>
      <tr><td>Multipliers</td><td>T1×${cfg.tod_multipliers.T1} T2×${cfg.tod_multipliers.T2} T3×${cfg.tod_multipliers.T3}</td></tr>
      <tr><td>Duty / FSC</td><td>${cfg.electricity_duty_rate*100}% / ${cfg.fuel_surcharge_paise_per_unit}p/u</td></tr>
    </table>
    <div style="margin-top:.8rem"><strong>Non-Telescopic Rate Brackets:</strong>
    <table style="margin-top:.3rem">
      <tr><th>≤ u/mo</th><th>Rate ₹/u</th></tr>
      ${cfg.non_tel_monthly_brackets.map(([l,r])=>`<tr><td>${l>=99999?'>500':l}</td><td>₹${r}</td></tr>`).join('')}
    </table></div>
    <div style="margin-top:.8rem"><strong>Fixed Charges – Non-Telescopic:</strong>
    <table style="margin-top:.3rem">
      <tr><th>≤ u/mo</th><th>FC ₹/mo</th></tr>
      ${cfg.fixed_charge_non_tel_monthly.map(([l,r])=>`<tr><td>${l>=99999?'>500':l}</td><td>₹${r}</td></tr>`).join('')}
    </table></div>
  `;
  document.getElementById('tipsBody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:.6rem">
      <div class="tip-card"><div class="tip-icon">🌙</div><p>Shift heavy loads (washing machine, iron, geyser) to <strong>T1 off-peak hours</strong> to get a 10% discount.</p></div>
      <div class="tip-card"><div class="tip-icon">☀️</div><p>Avoid ACs and geysers during <strong>T2 peak hours</strong> (typically 6–10am & 6–10pm) — they incur 25% surcharge.</p></div>
      <div class="tip-card"><div class="tip-icon">📉</div><p>Keep monthly usage <strong>below 250 units</strong> during KSEB review months (Jan–Feb, Jul–Aug) to stay on cheaper Telescopic rates.</p></div>
      <div class="tip-card"><div class="tip-icon">🌡️</div><p>Set AC to <strong>24°C</strong> — each degree lower costs ~6% extra electricity.</p></div>
      <div class="tip-card"><div class="tip-icon">💡</div><p>Replace remaining non-LED bulbs. A 9W LED replaces a 60W incandescent (85% savings on lighting).</p></div>
      <div class="tip-card"><div class="tip-icon">🔌</div><p>Unplug chargers and TVs on standby — phantom loads can be up to 10% of your bill.</p></div>
      <div class="tip-card"><div class="tip-icon">📱</div><p>Log readings <strong>daily at the same time</strong> for accurate tracking and early detection of usage spikes.</p></div>
    </div>
  `;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

document.addEventListener('DOMContentLoaded', () => {
  setDefaultDateTime();
  loadSettingsUI();
  renderLogList();
  refreshDashboard();
});
