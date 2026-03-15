'use strict';
// ── KSEB Tracker PWA v2.0 | Updated: March 2026 ──────────────────
const APP_VERSION = '2.0.0';
const APP_UPDATED = 'March 2026';

const DEFAULT_CFG = {
  name: 'Family',
  bill_start_date: '2025-09-20',
  bill_due_date: '',           // optional override
  start_readings: { T1: 12079, T2: 5359, T3: 6670 },
  tod_mode: 'auto',
  current_tariff_mode: 'non-telescopic-tod',
  tod_multipliers: { T1: 0.90, T2: 1.25, T3: 1.00 },
  telescopic_slabs_monthly:        [[50,3.35],[100,4.25],[150,5.35],[200,7.2],[250,8.5]],
  non_tel_monthly_brackets:        [[300,6.75],[350,7.60],[400,7.95],[500,8.25],[99999,9.20]],
  fixed_charge_telescopic_monthly: [[50,50],[100,85],[150,105],[200,140],[250,160]],
  fixed_charge_non_tel_monthly:    [[300,220],[350,240],[400,260],[500,286],[99999,310]],
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

// ── Due date: 20th of 2nd month after start (handles Feb/31-day) ──
function computeDueDate(startDateStr, overrideDueDate) {
  if (overrideDueDate) return new Date(overrideDueDate);
  const d = new Date(startDateStr);
  let m = d.getMonth() + 2;
  let y = d.getFullYear();
  if (m > 11) { m -= 12; y += 1; }
  return new Date(y, m, 20);
}
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

// ── Core bill engine ───────────────────────────────────────────────
function computeBill(cfg, readingsNow) {
  const start = cfg.start_readings;
  let used = {
    T1: Math.max(0, readingsNow.T1 - start.T1),
    T2: Math.max(0, readingsNow.T2 - start.T2),
    T3: Math.max(0, readingsNow.T3 - start.T3),
  };
  if (cfg.tod_mode === 'off') { used.T3 += used.T1 + used.T2; used.T1 = 0; used.T2 = 0; }
  else if (cfg.tod_mode === 'auto' && used.T1 <= 0 && used.T2 <= 0) { /* T3 only */ }

  const totalUnits = used.T1 + used.T2 + used.T3;
  const startDate = new Date(cfg.bill_start_date);
  const today = new Date(); today.setHours(0,0,0,0);
  const dueDate = computeDueDate(cfg.bill_start_date, cfg.bill_due_date);
  const billingDays = daysBetween(startDate, dueDate);
  const daysElapsed = Math.max(1, daysBetween(startDate, today));

  const monthlyEquivNow = totalUnits > 0 ? (totalUnits * (billingDays / daysElapsed)) / 2 : 0;
  const projectedUnits  = totalUnits > 0 ? totalUnits * (billingDays / daysElapsed) : 0;
  const projectedMonthly = projectedUnits / 2;

  const isNonTel = cfg.current_tariff_mode === 'non-telescopic-tod' ||
    (cfg.current_tariff_mode === 'auto' && monthlyEquivNow > 250);

  function pickRate(brackets, mu) { for (const [l,r] of brackets) if (mu<=l) return r; return brackets[brackets.length-1][1]; }
  function pickFC(table, mu)      { for (const [l,f] of table)    if (mu<=l) return f; return table[table.length-1][1]; }
  function todShares(u) { const t=u.T1+u.T2+u.T3; if(!t) return {T1:0,T2:0,T3:0}; return {T1:u.T1/t,T2:u.T2/t,T3:u.T3/t}; }

  function ecNonTel(units, mu, u) {
    const rate=pickRate(cfg.non_tel_monthly_brackets,mu), sh=todShares(u), m=cfg.tod_multipliers;
    const ecn=units*sh.T1*rate*m.T1, ecp=units*sh.T2*rate*m.T2, eco=units*sh.T3*rate*m.T3;
    return {ecn,ecp,eco,total:ecn+ecp+eco};
  }
  function ecTel(units, u) {
    const sh=todShares(u), m=cfg.tod_multipliers;
    let rem=units, ecn=0, ecp=0, eco=0, prev=0;
    for (const [lim,rate] of cfg.telescopic_slabs_monthly) {
      if(rem<=0)break;
      const biLim=lim>=99999?9999999:lim*2;
      const chunk=Math.min(rem,biLim-prev); prev=biLim;
      if(chunk<=0)continue;
      ecn+=chunk*sh.T1*rate*m.T1; ecp+=chunk*sh.T2*rate*m.T2; eco+=chunk*sh.T3*rate*m.T3;
      rem-=chunk;
    }
    return {ecn,ecp,eco,total:ecn+ecp+eco};
  }

  const ec = isNonTel ? ecNonTel(totalUnits,monthlyEquivNow,used) : ecTel(totalUnits,used);
  const fcMonthly = isNonTel ? pickFC(cfg.fixed_charge_non_tel_monthly,monthlyEquivNow)
                              : pickFC(cfg.fixed_charge_telescopic_monthly,monthlyEquivNow);
  const fcNow = fcMonthly * (daysElapsed / (billingDays / 2));
  const ed = ec.total * cfg.electricity_duty_rate;
  const fs = totalUnits * cfg.fuel_surcharge_paise_per_unit / 100;
  const netToday = Math.round(ec.total + ed + fs + fcNow);

  const isNonTelProj = cfg.current_tariff_mode === 'non-telescopic-tod' ||
    (cfg.current_tariff_mode === 'auto' && projectedMonthly > 250);
  const ecP = isNonTelProj ? ecNonTel(projectedUnits,projectedMonthly,used) : ecTel(projectedUnits,used);
  const fcPMo = isNonTelProj ? pickFC(cfg.fixed_charge_non_tel_monthly,projectedMonthly)
                              : pickFC(cfg.fixed_charge_telescopic_monthly,projectedMonthly);
  const edP=ecP.total*cfg.electricity_duty_rate, fsP=projectedUnits*cfg.fuel_surcharge_paise_per_unit/100;
  const netProj = Math.round(ecP.total + edP + fsP + 2*fcPMo);

  return {
    used, totalUnits, daysElapsed, billingDays, dueDate,
    monthlyEquivNow, projectedUnits, projectedMonthly,
    isNonTel, ec, fcNow, ed, fs, netToday,
    proj:{ec:ecP,fc:2*fcPMo,ed:edP,fs:fsP,total:netProj,units:projectedUnits}
  };
}

// ── Utils ──────────────────────────────────────────────────────────
function fmt(n) { return '₹'+Math.round(n).toLocaleString('en-IN'); }
function fmtU(n) { return (+n).toFixed(1); }
function toast(msg,type='info') {
  const el=document.getElementById('toast');
  el.textContent=msg;
  el.style.background=type==='error'?'#ef4444':type==='success'?'#22c55e':'var(--accent)';
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2800);
}

// ── Navigation ─────────────────────────────────────────────────────
function showPage(name,btn) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  // Particle burst on nav tap
  spawnParticles(btn);
}

// ── Particle effects ───────────────────────────────────────────────
function spawnParticles(el) {
  const rect=el.getBoundingClientRect();
  const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
  for(let i=0;i<8;i++){
    const p=document.createElement('div');
    p.className='particle';
    p.style.cssText=`left:${cx}px;top:${cy}px;--dx:${(Math.random()-0.5)*80}px;--dy:${-(Math.random()*60+20)}px`;
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),700);
  }
}

// ── Dashboard ──────────────────────────────────────────────────────
function refreshDashboard() {
  const cfg=getCfg(), readings=getReadings();
  if(!readings.length) {
    document.getElementById('heroAmount').textContent='₹ –';
    return;
  }
  const latest=readings[readings.length-1];
  const bill=computeBill(cfg,latest);

  // Animate number
  animateNumber('heroAmount', bill.netToday, v => fmt(v));
  document.getElementById('heroSub').textContent=
    `Day ${bill.daysElapsed} of ${bill.billingDays} · Due ${bill.dueDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}`;

  animateNumber('stUnits', bill.totalUnits, v=>fmtU(v));
  document.getElementById('stDays').textContent=`${bill.daysElapsed}/${bill.billingDays}`;
  animateNumber('stAvg', bill.totalUnits/bill.daysElapsed, v=>fmtU(v));
  document.getElementById('stProj').textContent=fmt(bill.proj.total);

  const pct=Math.min(100,bill.daysElapsed/bill.billingDays*100);
  setTimeout(()=>{document.getElementById('progBar').style.width=pct+'%';},100);
  document.getElementById('progDayLabel').textContent=`Day ${bill.daysElapsed}`;
  document.getElementById('progEndLabel').textContent=`Day ${bill.billingDays}`;

  // Color hero based on projected vs expected
  const ratio=bill.proj.total/6000; // rough reference
  const heroEl=document.getElementById('heroAmount');
  heroEl.style.color=bill.proj.total>8000?'#ef4444':bill.proj.total>5000?'#f59e0b':'#818cf8';

  document.getElementById('breakupCard').style.display='';
  document.querySelector('#breakupTable tbody').innerHTML=`
    <tr><td>⚡ Energy – T1 Normal (×0.90)</td><td>${fmt(bill.ec.ecn)}</td></tr>
    <tr><td>⚡ Energy – T2 Peak (×1.25)</td><td>${fmt(bill.ec.ecp)}</td></tr>
    <tr><td>⚡ Energy – T3 Off-Peak (×1.00)</td><td>${fmt(bill.ec.eco)}</td></tr>
    <tr><td><strong>Energy Total</strong></td><td><strong>${fmt(bill.ec.total)}</strong></td></tr>
    <tr><td>🏦 Fixed Charge (pro-rated)</td><td>${fmt(bill.fcNow)}</td></tr>
    <tr><td>🔌 Electricity Duty (10%)</td><td>${fmt(bill.ed)}</td></tr>
    <tr><td>⛽ Fuel Surcharge (10p/u)</td><td>${fmt(bill.fs)}</td></tr>
    <tr class="total-row"><td><strong>Net Payable Today</strong></td><td><strong>${fmt(bill.netToday)}</strong></td></tr>
  `;

  document.getElementById('projCard').style.display='';
  document.querySelector('#projTable tbody').innerHTML=`
    <tr><td>📦 Projected Units</td><td>${fmtU(bill.proj.units)}</td></tr>
    <tr><td>⚡ Energy Charge</td><td>${fmt(bill.proj.ec.total)}</td></tr>
    <tr><td>🏦 Fixed Charge (2 mo)</td><td>${fmt(bill.proj.fc)}</td></tr>
    <tr><td>🔌 Electricity Duty</td><td>${fmt(bill.proj.ed)}</td></tr>
    <tr><td>⛽ Fuel Surcharge</td><td>${fmt(bill.proj.fs)}</td></tr>
    <tr class="total-row"><td><strong>Projected Total</strong></td><td><strong>${fmt(bill.proj.total)}</strong></td></tr>
  `;

  const mode=bill.isNonTel?'NON-TELESCOPIC + TOD':'TELESCOPIC';
  const cls=bill.isNonTel?'badge-yellow':'badge-green';
  document.getElementById('tariffBadge').innerHTML=
    `<span class="badge ${cls}">${mode}</span>
     <span style="font-size:.75rem;color:var(--muted);margin-left:.5rem">~${fmtU(bill.monthlyEquivNow)} u/mo pace</span>`;

  document.getElementById('headerSub').textContent=
    `${cfg.name||'Family'} · Due ${bill.dueDate.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})}`;
}

function animateNumber(id, target, formatter) {
  const el=document.getElementById(id);
  const start=0, dur=800, startTime=performance.now();
  function step(now) {
    const p=Math.min((now-startTime)/dur,1);
    const ease=1-Math.pow(1-p,3);
    el.textContent=formatter(start+(target-start)*ease);
    if(p<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Log readings ───────────────────────────────────────────────────
function setDefaultDateTime() {
  const now=new Date(); now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  document.getElementById('inDateTime').value=now.toISOString().slice(0,16);
}

function addReading() {
  const t1=parseFloat(document.getElementById('inT1').value);
  const t2=parseFloat(document.getElementById('inT2').value);
  const t3=parseFloat(document.getElementById('inT3').value);
  const dt=document.getElementById('inDateTime').value;
  if(isNaN(t1)||isNaN(t2)||isNaN(t3)||!dt){toast('⚠️ Please fill all fields','error');return;}
  const cfg=getCfg(), sr=cfg.start_readings;
  if(t1<sr.T1||t2<sr.T2||t3<sr.T3){
    if(!confirm('⚠️ One or more readings are below your start readings. Continue?')) return;
  }
  const readings=getReadings();
  readings.push({T1:t1,T2:t2,T3:t3,dt});
  saveReadings(readings);
  renderLogList(); refreshDashboard();
  toast('✅ Reading saved!','success');
  ['inT1','inT2','inT3'].forEach(id=>document.getElementById(id).value='');
  setDefaultDateTime();
}

function renderLogList() {
  const readings=getReadings(), container=document.getElementById('logList');
  if(!readings.length){
    container.innerHTML='<p class="empty-msg">No readings yet. Add your first reading above.</p>';
    return;
  }
  const cfg=getCfg();
  container.innerHTML=[...readings].reverse().map((r,ri)=>{
    const i=readings.length-1-ri;
    const bill=computeBill(cfg,r);
    const du=i>0?(r.T1+r.T2+r.T3-(readings[i-1].T1+readings[i-1].T2+readings[i-1].T3)).toFixed(1):'–';
    const duNum=parseFloat(du);
    const duClass=isNaN(duNum)?'':'badge-'+(duNum>15?'red':duNum>8?'yellow':'green');
    return `<div class="log-item">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.88rem">T1:${r.T1} · T2:${r.T2} · T3:${r.T3}</div>
        <div class="log-meta">📅 ${new Date(r.dt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
          &nbsp;|&nbsp; <span class="badge ${duClass}" style="font-size:.68rem">Δ ${du} u</span>
          &nbsp;|&nbsp; <strong style="color:var(--accent2)">${fmt(bill.netToday)}</strong>
        </div>
      </div>
      <div class="log-actions">
        <button class="btn btn-warn" style="padding:.35rem .7rem;font-size:.75rem" onclick="openEdit(${i})">✏️</button>
        <button class="btn btn-danger" style="padding:.35rem .7rem;font-size:.75rem" onclick="deleteReading(${i})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function deleteReading(i) {
  if(!confirm('Delete this reading?'))return;
  const r=getReadings(); r.splice(i,1); saveReadings(r);
  renderLogList(); refreshDashboard(); toast('🗑️ Deleted');
}

function openEdit(i) {
  const r=getReadings()[i];
  document.getElementById('editIdx').value=i;
  document.getElementById('editT1').value=r.T1;
  document.getElementById('editT2').value=r.T2;
  document.getElementById('editT3').value=r.T3;
  document.getElementById('editModal').style.display='flex';
}
function closeEdit(){document.getElementById('editModal').style.display='none';}
function saveEdit(){
  const i=parseInt(document.getElementById('editIdx').value);
  const r=getReadings();
  r[i].T1=parseFloat(document.getElementById('editT1').value);
  r[i].T2=parseFloat(document.getElementById('editT2').value);
  r[i].T3=parseFloat(document.getElementById('editT3').value);
  saveReadings(r); closeEdit(); renderLogList(); refreshDashboard(); toast('✅ Updated','success');
}

// ── Charts ─────────────────────────────────────────────────────────
let charts={};
function destroyChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}

const CHART_DEFAULTS={
  responsive:true,maintainAspectRatio:false,
  animation:{duration:800,easing:'easeOutQuart'},
  plugins:{legend:{labels:{color:'#94a3b8',font:{size:11},boxWidth:12}}},
  scales:{
    x:{ticks:{color:'#94a3b8',font:{size:10},maxRotation:30},grid:{color:'rgba(255,255,255,.04)'},border:{color:'rgba(255,255,255,.1)'}},
    y:{ticks:{color:'#94a3b8',font:{size:10}},grid:{color:'rgba(255,255,255,.04)'},border:{color:'rgba(255,255,255,.1)'}}
  }
};

function renderCharts() {
  const readings=getReadings(), cfg=getCfg();
  if(!readings.length){
    document.getElementById('noChartMsg').style.display='block'; return;
  }
  document.getElementById('noChartMsg').style.display='none';

  const labels=readings.map(r=>new Date(r.dt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}));
  const dailyDelta=readings.map((r,i)=>i===0?0:(r.T1+r.T2+r.T3)-(readings[i-1].T1+readings[i-1].T2+readings[i-1].T3));
  const billArr=readings.map(r=>computeBill(cfg,r).netToday);
  const predArr=readings.map(r=>computeBill(cfg,r).proj.total);

  destroyChart('chartDaily');
  charts.chartDaily=new Chart(document.getElementById('chartDaily'),{
    type:'bar',
    data:{labels,datasets:[{
      label:'Daily Units',data:dailyDelta,
      backgroundColor:dailyDelta.map(v=>v>15?'rgba(239,68,68,.75)':v>8?'rgba(245,158,11,.75)':'rgba(99,102,241,.75)'),
      borderColor:dailyDelta.map(v=>v>15?'#ef4444':v>8?'#f59e0b':'#818cf8'),
      borderWidth:1,borderRadius:6,borderSkipped:false,
    }]},
    options:{...CHART_DEFAULTS,plugins:{...CHART_DEFAULTS.plugins,legend:{display:false}}}
  });

  destroyChart('chartBill');
  charts.chartBill=new Chart(document.getElementById('chartBill'),{
    type:'line',
    data:{labels,datasets:[{
      label:'Bill So Far (₹)',data:billArr,
      borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.08)',
      fill:true,tension:.4,pointBackgroundColor:'#22c55e',pointRadius:4,pointHoverRadius:7,
    }]},
    options:CHART_DEFAULTS
  });

  const lastBill=computeBill(cfg,readings[readings.length-1]);
  destroyChart('chartTOD');
  charts.chartTOD=new Chart(document.getElementById('chartTOD'),{
    type:'doughnut',
    data:{
      labels:['T1 Normal (6am–6pm)','T2 Peak (6pm–10pm)','T3 Off-Peak (10pm–6am)'],
      datasets:[{data:[lastBill.used.T1,lastBill.used.T2,lastBill.used.T3],
        backgroundColor:['rgba(99,102,241,.85)','rgba(239,68,68,.85)','rgba(34,197,94,.85)'],
        borderWidth:0,hoverOffset:8}]
    },
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      animation:{animateRotate:true,duration:1000},
      plugins:{legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:11},boxWidth:12,padding:12}}}}
  });

  destroyChart('chartPred');
  charts.chartPred=new Chart(document.getElementById('chartPred'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Projected Bill',data:predArr,borderColor:'#f59e0b',backgroundColor:'rgba(245,158,11,.08)',fill:true,tension:.4,borderDash:[5,3],pointRadius:3},
      {label:'Actual Bill',data:billArr,borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,.08)',fill:true,tension:.4,pointRadius:4}
    ]},
    options:CHART_DEFAULTS
  });
}

// ── Settings ───────────────────────────────────────────────────────
function loadSettingsUI() {
  const cfg=getCfg();
  document.getElementById('cfgName').value=cfg.name||'';
  document.getElementById('cfgStartDate').value=cfg.bill_start_date||'';
  document.getElementById('cfgDueDate').value=cfg.bill_due_date||'';
  document.getElementById('cfgT1').value=cfg.start_readings.T1;
  document.getElementById('cfgT2').value=cfg.start_readings.T2;
  document.getElementById('cfgT3').value=cfg.start_readings.T3;
  document.getElementById('cfgTariff').value=cfg.current_tariff_mode;
  document.getElementById('cfgTOD').value=cfg.tod_mode;
  const rt=S.get('kseb_reminder_time');
  if(rt)document.getElementById('cfgReminderTime').value=rt;
  document.getElementById('notifDot').className='notif-status'+(S.get('kseb_notif_on')?' on':'');
  // Show auto-calculated due date
  updateDueDatePreview();
}

function updateDueDatePreview() {
  const sd=document.getElementById('cfgStartDate').value;
  const override=document.getElementById('cfgDueDate').value;
  if(!sd)return;
  const due=computeDueDate(sd,override||null);
  document.getElementById('dueDatePreview').textContent=
    `Auto-calculated: ${due.toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`;
}

function saveSettings() {
  const existing=getCfg();
  S.set('kseb_cfg',{...existing,
    name:document.getElementById('cfgName').value,
    bill_start_date:document.getElementById('cfgStartDate').value,
    bill_due_date:document.getElementById('cfgDueDate').value||'',
    start_readings:{
      T1:parseFloat(document.getElementById('cfgT1').value)||0,
      T2:parseFloat(document.getElementById('cfgT2').value)||0,
      T3:parseFloat(document.getElementById('cfgT3').value)||0,
    },
    current_tariff_mode:document.getElementById('cfgTariff').value,
    tod_mode:document.getElementById('cfgTOD').value,
  });
  refreshDashboard(); renderLogList(); toast('✅ Settings saved!','success');
}

function clearAllData() {
  if(!confirm('⚠️ Delete ALL readings and settings? This cannot be undone.'))return;
  ['kseb_readings','kseb_cfg','kseb_notif_on'].forEach(k=>localStorage.removeItem(k));
  refreshDashboard(); renderLogList(); loadSettingsUI(); toast('🗑️ All data cleared');
}

// ── Bill Upload / OCR ──────────────────────────────────────────────
// Note: Without server-side OCR, we parse common KSEB bill text formats
// If user pastes bill text, we try to extract key fields
function parseBillText(text) {
  const patterns = {
    start_date: /(?:bill\s*from|from\s*date|billing\s*period)[:\s]+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
    t1: /T1[:\s]+(\d+\.?\d*)/i,
    t2: /T2[:\s]+(\d+\.?\d*)/i,
    t3: /T3[:\s]+(\d+\.?\d*)/i,
    due: /(?:due\s*date|payment\s*due)[:\s]+(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
  };
  const result={};
  for(const [key,rx] of Object.entries(patterns)){
    const m=text.match(rx);
    if(m) result[key]=m[1];
  }
  return result;
}

function handleBillTextPaste() {
  const text=document.getElementById('billTextInput').value;
  if(!text.trim()){toast('⚠️ Paste your bill text first','error');return;}
  const parsed=parseBillText(text);
  let filled=0;
  if(parsed.t1){document.getElementById('cfgT1').value=parsed.t1;filled++;}
  if(parsed.t2){document.getElementById('cfgT2').value=parsed.t2;filled++;}
  if(parsed.t3){document.getElementById('cfgT3').value=parsed.t3;filled++;}
  if(parsed.start_date){document.getElementById('cfgStartDate').value=parsed.start_date;filled++;}
  if(parsed.due){document.getElementById('cfgDueDate').value=parsed.due;filled++;}
  if(filled>0) toast(`✅ Auto-filled ${filled} field(s) from bill!`,'success');
  else toast('⚠️ Could not extract data. Fill manually.','error');
}

// ── Push Notifications ─────────────────────────────────────────────
async function scheduleNotification() {
  if(!('Notification' in window)){toast('Notifications not supported','error');return;}
  const perm=await Notification.requestPermission();
  if(perm!=='granted'){toast('❌ Permission denied','error');return;}
  const timeStr=document.getElementById('cfgReminderTime').value||'20:00';
  S.set('kseb_reminder_time',timeStr);
  S.set('kseb_notif_on',true);
  document.getElementById('notifDot').className='notif-status on';

  const [hh,mm]=timeStr.split(':').map(Number);
  let next=new Date(); next.setHours(hh,mm,0,0);
  if(next<=new Date()) next.setDate(next.getDate()+1);
  const msUntil=next-new Date();

  // Use service worker for background notification (works when Chrome is closed)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.ready.then(reg=>{
      // Store schedule in SW via message
      if(reg.active){
        reg.active.postMessage({type:'SCHEDULE_NOTIFICATION',ms:msUntil,timeStr});
      }
    });
  }
  toast(`🔔 Reminder set for ${timeStr} daily`,'success');
}

// ── WhatsApp share ─────────────────────────────────────────────────
function shareToWhatsApp() {
  const cfg=getCfg(), readings=getReadings();
  if(!readings.length){toast('⚠️ No readings to share','error');return;}
  const r=readings[readings.length-1];
  const bill=computeBill(cfg,r);
  const msg=`⚡ *KSEB Tracker* – Day ${bill.daysElapsed}/${bill.billingDays}

📟 *Meter*: T1=${r.T1} | T2=${r.T2} | T3=${r.T3}
📦 *Used*: ${fmtU(bill.totalUnits)} units
  T1 Normal: ${fmtU(bill.used.T1)} u
  T2 Peak: ${fmtU(bill.used.T2)} u  
  T3 Off-Peak: ${fmtU(bill.used.T3)} u
📅 *Pace*: ~${fmtU(bill.monthlyEquivNow)} u/month
⚡ *Avg*: ${fmtU(bill.totalUnits/bill.daysElapsed)} u/day
⚠️ *Tariff*: ${bill.isNonTel?'Non-Telescopic+TOD':'Telescopic'}

💰 *If billed today*: ${fmt(bill.netToday)}
  Energy: ${fmt(bill.ec.total)}
  Fixed: ${fmt(bill.fcNow)} | Duty: ${fmt(bill.ed)} | FSC: ${fmt(bill.fs)}

🔮 *Projected*: ${fmt(bill.proj.total)} (~${fmtU(bill.proj.units)} units)
📅 *Due*: ${bill.dueDate.toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}

_via KSEB Tracker PWA v${APP_VERSION}_`;
  window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank');
}

// ── Info page ──────────────────────────────────────────────────────
function renderInfo() {
  const cfg=getCfg();
  document.getElementById('tariffInfoBody').innerHTML=`
    <table>
      <tr><th>Parameter</th><th>Value</th></tr>
      <tr><td>Bill Start</td><td>${cfg.bill_start_date}</td></tr>
      <tr><td>Due Date</td><td>${computeDueDate(cfg.bill_start_date,cfg.bill_due_date).toLocaleDateString('en-IN')}</td></tr>
      <tr><td>Start T1 (Normal)</td><td>${cfg.start_readings.T1}</td></tr>
      <tr><td>Start T2 (Peak)</td><td>${cfg.start_readings.T2}</td></tr>
      <tr><td>Start T3 (Off-Peak)</td><td>${cfg.start_readings.T3}</td></tr>
      <tr><td>Tariff Mode</td><td>${cfg.current_tariff_mode}</td></tr>
      <tr><td>TOD Mode</td><td>${cfg.tod_mode}</td></tr>
      <tr><td>T1 Multiplier</td><td>×${cfg.tod_multipliers.T1} (−10% discount)</td></tr>
      <tr><td>T2 Multiplier</td><td>×${cfg.tod_multipliers.T2} (+25% surcharge)</td></tr>
      <tr><td>T3 Multiplier</td><td>×${cfg.tod_multipliers.T3} (normal)</td></tr>
      <tr><td>Electricity Duty</td><td>${cfg.electricity_duty_rate*100}% of EC</td></tr>
      <tr><td>Fuel Surcharge</td><td>${cfg.fuel_surcharge_paise_per_unit} paise/unit</td></tr>
      <tr><td>Tariff Order</td><td><a href="https://kseb.in/downloads/eyJpdiI6Inl0OGhQd3p2K245MUpNd29TTmh4VWc9PSIsInZhbHVlIjoiLytiOFh2Tk5ISGhHZTlhVldGQ3dWQT09IiwibWFjIjoiZDM5OTRlMzRlZjZkZjkwMWE5MGNiNzM2OWFhNTE5NjVmODI2MDdlNDNlNDk0MmMxYjIxNTgwNTJkYzE3MzIzYiIsInRhZyI6IiJ9" target="_blank" style="color:var(--accent2)">KSERC Dec 2024 ↗</a></td></tr>
    </table>
    <div style="margin-top:.8rem"><strong>Non-Telescopic Rate Brackets (monthly):</strong>
    <table style="margin-top:.3rem">
      <tr><th>≤ u/mo</th><th>Rate ₹/u</th><th>FC ₹/mo</th></tr>
      ${cfg.non_tel_monthly_brackets.map(([l,r],i)=>{
        const fc=cfg.fixed_charge_non_tel_monthly[i]?cfg.fixed_charge_non_tel_monthly[i][1]:'–';
        return `<tr><td>${l>=99999?'>500':l}</td><td>₹${r}</td><td>₹${fc}</td></tr>`;
      }).join('')}
    </table></div>
    <p style="margin-top:.8rem;font-size:.75rem;color:var(--muted)">
      ✅ Rates verified against KSERC Tariff Order dated 05.12.2024 (effective Dec 2024–Mar 2027)
    </p>
  `;
  document.getElementById('tipsBody').innerHTML=`
    <div style="display:flex;flex-direction:column;gap:.6rem">
      <div class="tip-card"><div class="tip-icon">🌙</div><p>Run washing machine, iron, geyser during <strong>T1 (6am–6pm)</strong> for a 10% discount vs T3 rate.</p></div>
      <div class="tip-card"><div class="tip-icon">☀️</div><p>Avoid AC/geyser during <strong>T2 peak (6pm–10pm)</strong> — costs 25% more than normal rate.</p></div>
      <div class="tip-card"><div class="tip-icon">📉</div><p>Stay under <strong>250 units/month</strong> during KSEB review (Jan–Feb, Jul–Aug) to get reclassified to cheaper Telescopic tariff.</p></div>
      <div class="tip-card"><div class="tip-icon">🌡️</div><p>AC at <strong>24°C vs 18°C</strong> = ~36% less energy. Each degree saves ~6%.</p></div>
      <div class="tip-card"><div class="tip-icon">💡</div><p>9W LED = 60W incandescent. 85% lighting savings. Replace any remaining non-LED bulbs now.</p></div>
      <div class="tip-card"><div class="tip-icon">🔌</div><p>Unplug TVs, chargers and set-top boxes when not in use. Standby can be 5–10% of your bill.</p></div>
      <div class="tip-card"><div class="tip-icon">🧊</div><p>Don't keep refrigerator door open. Keep coils dust-free. Maintain 2cm wall gap for ventilation.</p></div>
      <div class="tip-card"><div class="tip-icon">🚿</div><p>Solar water heater pays back in 2–3 years. Your geyser is likely the biggest energy consumer.</p></div>
      <div class="tip-card"><div class="tip-icon">📱</div><p>Log readings <strong>daily</strong> for accurate tracking. Spikes are easier to catch early!</p></div>
    </div>
  `;
  document.getElementById('appVersionInfo').textContent=`v${APP_VERSION} · Updated ${APP_UPDATED}`;
}

// ── PWA Registration ───────────────────────────────────────────────
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js')
      .then(reg=>{
        console.log('SW registered');
        // Re-schedule notification after SW is ready
        const rt=S.get('kseb_reminder_time');
        if(rt && S.get('kseb_notif_on') && reg.active){
          const [hh,mm]=rt.split(':').map(Number);
          let next=new Date(); next.setHours(hh,mm,0,0);
          if(next<=new Date()) next.setDate(next.getDate()+1);
          reg.active.postMessage({type:'SCHEDULE_NOTIFICATION',ms:next-new Date(),timeStr:rt});
        }
      })
      .catch(()=>{});
  });
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  setDefaultDateTime();
  loadSettingsUI();
  renderLogList();
  refreshDashboard();
  // Show version in footer
  const vEl=document.getElementById('footerVersion');
  if(vEl) vEl.textContent=`v${APP_VERSION}`;
});
