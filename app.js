const APP_META = {
  version: "2.1.0",
  lastUpdated: "2026-03-12",
  dueDateRule: {
    defaultDay: 20
  },
  officialDocs: [
    {
      title: "KSEB Tariff Revision Circular 2023-24",
      url: "https://kseb.in/uploads/Downloadtemsuppy/Tariff%20Revision%20Circular%202023-24-1700134451843511849.pdf"
    },
    {
      title: "KSERC Tariff Order 05 Dec 2024",
      url: "https://kseb.in/uploads/Subsubmenu/Latest%20Tariff%20Orders0912202411:17:56.pdf"
    }
  ]
};

const STORAGE_KEYS = {
  settings: "kseb_settings_v2",
  entries: "kseb_entries_v2",
  theme: "kseb_theme_v2",
  billMeta: "kseb_bill_meta_v2"
};

const TariffMode = {
  DOMESTIC_TELESCOPIC: "domestic_telescopic",
  DOMESTIC_NON_TELESCOPIC: "domestic_non_telescopic",
  DOMESTIC_TOD_OVER_500: "domestic_tod_over_500"
};

const defaultSettings = {
  billingStartDate: "",
  dueDateMode: "default",
  customDueDate: "",
  tariffMode: TariffMode.DOMESTIC_NON_TELESCOPIC,
  startT1: 0,
  startT2: 0,
  startT3: 0,
  fixedCharge: 0,
  dutyCharge: 0,
  reminderTime: "20:00"
};

let deferredPrompt = null;

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSettings() {
  return { ...defaultSettings, ...loadJSON(STORAGE_KEYS.settings, {}) };
}

function getEntries() {
  return loadJSON(STORAGE_KEYS.entries, []);
}

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function clampNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function computeDefaultDueDate(startDateStr) {
  if (!startDateStr) return "";
  const d = new Date(startDateStr);
  const due = new Date(d.getFullYear(), d.getMonth() + 2, APP_META.dueDateRule.defaultDay);
  return due.toISOString().slice(0, 10);
}

function getEffectiveDueDate(settings) {
  if (settings.dueDateMode === "custom" && settings.customDueDate) {
    return settings.customDueDate;
  }
  return computeDefaultDueDate(settings.billingStartDate);
}

function getTariffModeHelp(mode) {
  switch (mode) {
    case TariffMode.DOMESTIC_TELESCOPIC:
      return "Choose this only when your bill is under domestic telescopic billing, which generally applies up to 250 units per month equivalent.";
    case TariffMode.DOMESTIC_NON_TELESCOPIC:
      return "Choose this when your domestic bill is above 250 units per month equivalent but not billed under domestic ToD.";
    case TariffMode.DOMESTIC_TOD_OVER_500:
      return "Choose this only if KSEB actually bills your connection under domestic ToD. A TOD-capable meter alone does not automatically mean this mode applies.";
    default:
      return "";
  }
}

function calcDomesticTelescopicEnergy(monthlyUnits) {
  let remaining = monthlyUnits;
  let total = 0;
  const slabs = [
    [50, 3.25],
    [50, 4.05],
    [50, 5.10],
    [50, 6.95],
    [50, 8.20]
  ];

  for (const [cap, rate] of slabs) {
    const used = Math.max(0, Math.min(remaining, cap));
    total += used * rate;
    remaining -= used;
    if (remaining <= 0) break;
  }
  return round2(total);
}

function calcDomesticNonTelescopicEnergy(monthlyUnits) {
  let rate = 6.4;
  if (monthlyUnits > 500) rate = 8.8;
  else if (monthlyUnits > 400) rate = 7.9;
  else if (monthlyUnits > 350) rate = 7.6;
  else if (monthlyUnits > 300) rate = 7.25;
  return round2(monthlyUnits * rate);
}

function calcDomesticTodEnergy(normalUnits, peakUnits, offPeakUnits) {
  const rulingTariff = 8.8;
  return round2(
    normalUnits * rulingTariff * 1.0 +
    peakUnits * rulingTariff * 1.2 +
    offPeakUnits * rulingTariff * 0.9
  );
}

function calculateBillEstimate(entry, settings) {
  const unitsT1 = Math.max(0, round2(entry.endT1 - settings.startT1));
  const unitsT2 = Math.max(0, round2(entry.endT2 - settings.startT2));
  const unitsT3 = Math.max(0, round2(entry.endT3 - settings.startT3));
  const totalUnits = round2(unitsT1 + unitsT2 + unitsT3);

  const monthlyUnits = round2(totalUnits / 2);
  let energyCharge = 0;

  if (settings.tariffMode === TariffMode.DOMESTIC_TOD_OVER_500) {
    energyCharge = calcDomesticTodEnergy(unitsT1, unitsT2, unitsT3);
  } else if (settings.tariffMode === TariffMode.DOMESTIC_TELESCOPIC) {
    energyCharge = calcDomesticTelescopicEnergy(monthlyUnits) * 2;
  } else {
    energyCharge = calcDomesticNonTelescopicEnergy(monthlyUnits) * 2;
  }

  const fixedCharge = clampNumber(settings.fixedCharge);
  const dutyCharge = clampNumber(settings.dutyCharge);
  const otherCharges = clampNumber(entry.otherCharges);
  const totalAmount = round2(energyCharge + fixedCharge + dutyCharge + otherCharges);

  return {
    unitsT1,
    unitsT2,
    unitsT3,
    totalUnits,
    monthlyUnits,
    energyCharge: round2(energyCharge),
    totalAmount
  };
}

function bindTabs() {
  const buttons = document.querySelectorAll(".nav-btn");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

function renderMeta() {
  document.getElementById("appVersionText").textContent = `Version ${APP_META.version}`;
  document.getElementById("appUpdatedText").textContent = `Last updated ${APP_META.lastUpdated}`;
  document.getElementById("appMetaBadge").textContent = `v${APP_META.version} · ${APP_META.lastUpdated}`;

  const links = APP_META.officialDocs
    .map(doc => `<a href="${doc.url}" target="_blank" rel="noreferrer">${doc.title}</a>`)
    .join("");
  document.getElementById("officialDocLinks").innerHTML = links;
}

function renderSettings() {
  const s = getSettings();
  document.getElementById("billingStartDate").value = s.billingStartDate || "";
  document.getElementById("dueDateMode").value = s.dueDateMode;
  document.getElementById("customDueDate").value = s.customDueDate || "";
  document.getElementById("tariffMode").value = s.tariffMode;
  document.getElementById("startT1").value = s.startT1;
  document.getElementById("startT2").value = s.startT2;
  document.getElementById("startT3").value = s.startT3;
  document.getElementById("fixedCharge").value = s.fixedCharge;
  document.getElementById("dutyCharge").value = s.dutyCharge;
  document.getElementById("reminderTime").value = s.reminderTime || "20:00";

  syncDueDateMode();
  syncTariffHelp();
  renderBillMeta();
}

function syncDueDateMode() {
  const dueMode = document.getElementById("dueDateMode").value;
  const wrap = document.getElementById("customDueDateWrap");
  wrap.classList.toggle("hidden", dueMode !== "custom");

  if (dueMode === "default") {
    const startDate = document.getElementById("billingStartDate").value;
    document.getElementById("customDueDate").value = computeDefaultDueDate(startDate);
  }
}

function syncTariffHelp() {
  const mode = document.getElementById("tariffMode").value;
  const help = `${getTariffModeHelp(mode)} For your home, choose the exact mode shown by KSEB in the real bill.`;
  document.getElementById("tariffModeHelp").textContent = help;
  document.getElementById("dashboardTariffHelp").textContent = help;
}

function saveSettings() {
  const dueDateMode = document.getElementById("dueDateMode").value;
  const billingStartDate = document.getElementById("billingStartDate").value;
  const customDueDate = dueDateMode === "custom"
    ? document.getElementById("customDueDate").value
    : computeDefaultDueDate(billingStartDate);

  const settings = {
    billingStartDate,
    dueDateMode,
    customDueDate,
    tariffMode: document.getElementById("tariffMode").value,
    startT1: clampNumber(document.getElementById("startT1").value),
    startT2: clampNumber(document.getElementById("startT2").value),
    startT3: clampNumber(document.getElementById("startT3").value),
    fixedCharge: clampNumber(document.getElementById("fixedCharge").value),
    dutyCharge: clampNumber(document.getElementById("dutyCharge").value),
    reminderTime: document.getElementById("reminderTime").value || "20:00"
  };

  saveJSON(STORAGE_KEYS.settings, settings);
  showToast("Settings saved");
  renderDashboard();
}

function getEntryFormData() {
  return {
    date: document.getElementById("entryDate").value,
    endT1: clampNumber(document.getElementById("endT1").value),
    endT2: clampNumber(document.getElementById("endT2").value),
    endT3: clampNumber(document.getElementById("endT3").value),
    otherCharges: clampNumber(document.getElementById("otherCharges").value),
    notes: document.getElementById("entryNotes").value.trim()
  };
}

function previewEntry() {
  const settings = getSettings();
  const entry = getEntryFormData();
  const result = calculateBillEstimate(entry, settings);

  const preview = document.getElementById("entryPreview");
  preview.classList.remove("hidden");
  preview.innerHTML = `
    <div class="preview-grid">
      <div><strong>T1 units:</strong> ${result.unitsT1}</div>
      <div><strong>T2 units:</strong> ${result.unitsT2}</div>
      <div><strong>T3 units:</strong> ${result.unitsT3}</div>
      <div><strong>Total units:</strong> ${result.totalUnits}</div>
      <div><strong>Energy charge:</strong> ${formatMoney(result.energyCharge)}</div>
      <div><strong>Total amount:</strong> ${formatMoney(result.totalAmount)}</div>
    </div>
  `;
}

function saveEntry() {
  const settings = getSettings();
  const entry = getEntryFormData();

  if (!entry.date) {
    showToast("Please select entry date");
    return;
  }

  const result = calculateBillEstimate(entry, settings);
  const saved = {
    ...entry,
    ...result,
    dueDate: getEffectiveDueDate(settings),
    tariffMode: settings.tariffMode,
    createdAt: new Date().toISOString()
  };

  const entries = getEntries();
  entries.unshift(saved);
  saveJSON(STORAGE_KEYS.entries, entries);

  showToast("Entry saved");
  clearEntryForm();
  renderDashboard();
  renderHistory();
  renderStats();
}

function clearEntryForm() {
  document.getElementById("entryDate").value = "";
  document.getElementById("endT1").value = "";
  document.getElementById("endT2").value = "";
  document.getElementById("endT3").value = "";
  document.getElementById("otherCharges").value = "0";
  document.getElementById("entryNotes").value = "";
  document.getElementById("entryPreview").classList.add("hidden");
}

function renderDashboard() {
  const settings = getSettings();
  const latest = getEntries()[0];

  if (!latest) {
    document.getElementById("metricUnits").textContent = "0";
    document.getElementById("metricEnergy").textContent = "₹0";
    document.getElementById("metricDueDate").textContent = formatDate(getEffectiveDueDate(settings));
    syncTariffHelp();
    return;
  }

  document.getElementById("metricUnits").textContent = latest.totalUnits;
  document.getElementById("metricEnergy").textContent = formatMoney(latest.energyCharge);
  document.getElementById("metricDueDate").textContent = formatDate(latest.dueDate || getEffectiveDueDate(settings));
  syncTariffHelp();
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const entries = getEntries();

  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">No bill entries yet.</div>`;
    return;
  }

  list.innerHTML = entries.map((e, index) => `
    <article class="history-card glass">
      <div class="history-top">
        <div>
          <h3>Entry ${entries.length - index}</h3>
          <p class="muted">${formatDate(e.date)} · Due ${formatDate(e.dueDate)}</p>
        </div>
        <button class="btn small danger" onclick="deleteEntry(${index})">Delete</button>
      </div>
      <div class="history-grid">
        <div><span>Total units</span><strong>${e.totalUnits}</strong></div>
        <div><span>Energy</span><strong>${formatMoney(e.energyCharge)}</strong></div>
        <div><span>Total bill</span><strong>${formatMoney(e.totalAmount)}</strong></div>
        <div><span>Tariff mode</span><strong>${e.tariffMode}</strong></div>
      </div>
      <p class="muted">T1 ${e.unitsT1}, T2 ${e.unitsT2}, T3 ${e.unitsT3}</p>
      ${e.notes ? `<p>${escapeHtml(e.notes)}</p>` : ""}
    </article>
  `).join("");
}

function renderStats() {
  const entries = getEntries();
  const totalEntries = entries.length;

  let avgUnits = 0;
  let avgAmount = 0;

  if (entries.length) {
    avgUnits = round2(entries.reduce((sum, e) => sum + Number(e.totalUnits || 0), 0) / entries.length);
    avgAmount = round2(entries.reduce((sum, e) => sum + Number(e.totalAmount || 0), 0) / entries.length);
  }

  document.getElementById("avgUnits").textContent = avgUnits;
  document.getElementById("avgAmount").textContent = formatMoney(avgAmount);
  document.getElementById("totalEntries").textContent = totalEntries;
}

function deleteEntry(index) {
  const entries = getEntries();
  entries.splice(index, 1);
  saveJSON(STORAGE_KEYS.entries, entries);
  renderDashboard();
  renderHistory();
  renderStats();
  showToast("Entry deleted");
}

window.deleteEntry = deleteEntry;

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function renderBillMeta() {
  const meta = loadJSON(STORAGE_KEYS.billMeta, null);
  const el = document.getElementById("lastBillMeta");
  if (!meta) {
    el.textContent = "No bill uploaded yet.";
    return;
  }
  el.textContent = `${meta.name} · ${(meta.size / 1024).toFixed(1)} KB · uploaded ${new Date(meta.uploadedAt).toLocaleString("en-IN")}`;
}

function bindSettingsEvents() {
  document.getElementById("dueDateMode").addEventListener("change", syncDueDateMode);
  document.getElementById("billingStartDate").addEventListener("change", syncDueDateMode);
  document.getElementById("tariffMode").addEventListener("change", syncTariffHelp);
  document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);

  document.getElementById("lastBillUpload").addEventListener("change", e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const meta = {
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: new Date().toISOString()
    };
    saveJSON(STORAGE_KEYS.billMeta, meta);
    renderBillMeta();
    showToast("Bill file metadata saved");
  });

  document.getElementById("notifyBtn").addEventListener("click", requestNotifications);
  document.getElementById("testNotifyBtn").addEventListener("click", triggerTestNotification);
}

function bindEntryEvents() {
  document.getElementById("previewEntryBtn").addEventListener("click", previewEntry);
  document.getElementById("saveEntryBtn").addEventListener("click", saveEntry);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function initTheme() {
  const theme = localStorage.getItem(STORAGE_KEYS.theme) || "dark";
  applyTheme(theme);

  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    localStorage.setItem(STORAGE_KEYS.theme, next);
    applyTheme(next);
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    console.log("SW registered", reg);
  } catch (err) {
    console.error("SW registration failed", err);
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    showToast("Notifications not supported");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    showToast("Notifications enabled");
  } else {
    showToast("Notification permission denied");
  }
}

async function triggerTestNotification() {
  if (!("serviceWorker" in navigator)) {
    showToast("Service worker not supported");
    return;
  }

  const permission = Notification.permission;
  if (permission !== "granted") {
    showToast("Enable notifications first");
    return;
  }

  const reg = await navigator.serviceWorker.ready;
  if (reg.active) {
    reg.active.postMessage({
      type: "SHOW_LOCAL_NOTIFICATION",
      payload: {
        title: "KSEB Tracker",
        body: "This is a test notification from your app.",
        url: "./"
      }
    });
    showToast("Test notification triggered");
  }
}

function bindInstallPrompt() {
  const btn = document.getElementById("installBtn");

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredPrompt = e;
    btn.classList.remove("hidden");
  });

  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.classList.add("hidden");
  });
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function seedDefaults() {
  const settings = getSettings();
  if (!settings.tariffMode) {
    saveJSON(STORAGE_KEYS.settings, defaultSettings);
  }
}

function setTodayDefault() {
  const entryDate = document.getElementById("entryDate");
  if (!entryDate.value) {
    entryDate.value = new Date().toISOString().slice(0, 10);
  }
}

function init() {
  seedDefaults();
  bindTabs();
  renderMeta();
  renderSettings();
  renderDashboard();
  renderHistory();
  renderStats();
  bindSettingsEvents();
  bindEntryEvents();
  initTheme();
  registerServiceWorker();
  bindInstallPrompt();
  setTodayDefault();
}

document.addEventListener("DOMContentLoaded", init);
