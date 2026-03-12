class KSEBTracker {
    constructor() {
        this.db = null;
        this.config = {};
        this.readings = [];
        this.init();
    }

    async init() {
        await this.initDB();
        await this.loadConfig();
        await this.loadData();
        this.bindEvents();
        this.updateUI();
        this.requestNotificationPermission();
        this.animateEntrance();
    }

    async initDB() {
        return new Promise((resolve) => {
            const request = indexedDB.open('KSEBTracker', 3);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                db.createObjectStore('readings', { keyPath: 'timestamp' });
                db.createObjectStore('config', { keyPath: 'key' });
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
        });
    }

    async loadConfig() {
        try {
            const defaultConfig = await (await fetch('/config-default.yaml')).text();
            this.config = this.parseYAML(defaultConfig);
            
            const stored = await this.getConfig();
            Object.assign(this.config, stored);
        } catch (e) {
            console.error('Using default config');
        }
    }

    parseYAML(text) {
        // Simple YAML parser for known structure
        const config = {};
        text.split('\n').forEach(line => {
            const match = line.match(/^(\w+[-\w]*): (.+)$/);
            if (match) config[match[1]] = match[2] === 'true' ? true : match[2] === 'false' ? false : JSON.parse(match[2]);
        });
        if (config.start_readings) {
            config.start_readings = JSON.parse(config.start_readings);
        }
        return config;
    }

    async getConfig() {
        if (!this.db) return {};
        return new Promise((resolve) => {
            const tx = this.db.transaction('config', 'readonly');
            const store = tx.objectStore('config');
            const req = store.get('userConfig');
            req.onsuccess = () => resolve(req.result?.value || {});
        });
    }

    async saveConfig(updates) {
        Object.assign(this.config, updates);
        const tx = this.db.transaction('config', 'readwrite');
        tx.objectStore('config').put({ key: 'userConfig', value: updates });
    }

    async loadData() {
        const tx = this.db.transaction('readings', 'readonly');
        const store = tx.objectStore('readings');
        const req = store.getAll();
        req.onsuccess = () => {
            this.readings = req.result.sort((a, b) => b.timestamp - a.timestamp);
        };
    }

    async saveReading(t1, t2, t3) {
        const reading = {
            t1, t2, t3,
            timestamp: Date.now(),
            date: new Date().toISOString().split('T')[0]
        };
        const tx = this.db.transaction('readings', 'readwrite');
        tx.objectStore('readings').put(reading);
        await this.loadData();
        return reading;
    }

    computeBill(readingsNow) {
        // Ported Python logic to JS
        const cfg = this.config;
        const startReadings = cfg.start_readings || {T1:0, T2:0, T3:0};
        const today = new Date();
        const billStart = new Date(cfg.bill_start_date + 'T00:00:00');
        const daysElapsed = Math.max(1, Math.floor((today - billStart) / (1000*60*60*24)));
        
        const used = {
            T1: readingsNow.T1 - startReadings.T1,
            T2: readingsNow.T2 - startReadings.T2,
            T3: readingsNow.T3 - startReadings.T3
        };
        const totalUnits = used.T1 + used.T2 + used.T3;
        
        // Monthly equivalent (pace-aware)
        const monthlyEquiv = totalUnits * cfg.billing_days / daysElapsed / 2;
        
        const multipliers = cfg.tod_multipliers || {T1:0.9, T2:1.25, T3:1.0};
        const shares = {T1: used.T1/totalUnits || 0, T2: used.T2/totalUnits || 0, T3: 1 - (shares.T1 + shares.T2)};
        
        let isTelescopic = monthlyEquiv <= 250;
        if (cfg.current_tariff_mode === 'telescopic') isTelescopic = true;
        if (cfg.current_tariff_mode === 'non-telescopic-tod') isTelescopic = false;
        
        // Simplified bill calc (full port would be longer, but functional)
        const ecTotal = totalUnits * (isTelescopic ? 5.5 : 8.0) * 1.05; // Avg rates
        const fc = isTelescopic ? 100 : 250;
        const fcNow = fc * (daysElapsed / cfg.billing_days * 2);
        const duty = ecTotal * 0.1;
        const fs = totalUnits * 0.1;
        const netPayable = ecTotal + duty + fs + fcNow;
        
        const projectedUnits = totalUnits * cfg.billing_days / daysElapsed;
        const projectedMonthly = projectedUnits / 2;
        const projectedEc = projectedUnits * (projectedMonthly <= 250 ? 5.5 : 8.0) * 1.05;
        const projectedTotal = projectedEc + duty*2 + fs*2 + fc*2;
        
        return {
            used, totalUnits, daysElapsed, monthlyEquiv,
            isTelescopic, ecTotal, fcNow, duty, fs, netPayable,
            projectedTotal, projectedUnits,
            tips: this.generateTips(totalUnits, daysElapsed)
        };
    }

    generateTips(units, days) {
        const dailyAvg = units / days;
        const tips = [];
        if (dailyAvg > 10) tips.push('High usage! Switch off peak appliances during T2 hours.');
        if (this.config.current_tariff_mode !== 'telescopic') tips.push('Reduce to <250 units/month to switch to cheaper telescopic tariff.');
        return tips;
    }

    bindEvents() {
        // Nav tabs
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelector('.nav-btn.active').classList.remove('active');
                e.target.classList.add('active');
                document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
                document.getElementById(e.target.dataset.tab).classList.add('active');
            });
        });

        // Save reading
        document.getElementById('save-reading').addEventListener('click', async () => {
            const t1 = parseFloat(document.getElementById('t1').value);
            const t2 = parseFloat(document.getElementById('t2').value);
            const t3 = parseFloat(document.getElementById('t3').value);
            await this.saveReading(t1, t2, t3);
            this.updateUI();
        });

        // Save config
        document.getElementById('save-config').addEventListener('click', () => {
            const updates = {
                bill_start_date: document.getElementById('bill-start').value,
                // Add other fields
            };
            this.saveConfig(updates);
            this.updateUI();
        });

        // Share
        document.getElementById('share-whatsapp').addEventListener('click', () => {
            const bill = this.computeBill({T1:0,T2:0,T3:0}); // Current bill
            const text = `KSEB Update: Used ${bill.totalUnits} units. Bill: ₹${bill.netPayable.toFixed(0)}`;
            const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
            window.open(url);
        });
    }

    async updateUI() {
        const latestReading = this.readings[0];
        if (latestReading) {
            const bill = this.computeBill({
                T1: latestReading.t1,
                T2: latestReading.t2,
                T3: latestReading.t3
            });
            this.renderBillSummary(bill);
            this.renderChart();
            this.renderHistory();
            this.renderSettings();
        }
        this.renderInfo();
    }

    renderBillSummary(bill) {
        document.getElementById('bill-summary').innerHTML = `
            <div class="metric">
                <span class="label">Current Bill</span>
                <span class="value">₹${bill.netPayable.toFixed(0)}</span>
            </div>
            <div class="metric">
                <span class="label">Projected Bill</span>
                <span class="value">₹${bill.projectedTotal.toFixed(0)}</span>
            </div>
            <div class="metric">
                <span class="label">Units Used</span>
                <span class="value">${bill.totalUnits.toFixed(0)}</span>
            </div>
        `;
        document.getElementById('predictions').innerHTML = bill.tips.map(tip => `<p>• ${tip}</p>`).join('');
    }

    renderChart() {
        const canvas = document.getElementById('usage-chart');
        const ctx = canvas.getContext('2d');
        // Simple line chart using canvas
        ctx.fillStyle = '#2196F3';
        ctx.fillRect(0, 200 - 50, 300, 50); // Dummy chart
    }

    renderHistory() {
        const list = document.getElementById('history-list');
        list.innerHTML = this.readings.slice(0,10).map(r => `
            <li>
                ${r.date}: T1:${r.t1} T2:${r.t2} T3:${r.t3}
                <button onclick="tracker.deleteReading('${r.timestamp}')">Delete</button>
            </li>
        `).join('');
    }

    renderSettings() {
        document.getElementById('editable-settings').innerHTML = `
            <label>Bill Start: <input id="bill-start" value="${this.config.bill_start_date}"></label>
        `;
        document.getElementById('info-settings').innerHTML = `
            <p>TOD Multipliers: T1:${this.config.tod_multipliers?.T1}, T2:${this.config.tod_multipliers?.T2}, T3:${this.config.tod_multipliers?.T3}</p>
        `;
    }

    async renderInfo() {
        const info = await (await fetch('/info.md')).text();
        document.getElementById('app-info').innerHTML = info.replace(/\n/g, '<br>');
        document.getElementById('info-settings').innerHTML = info.slice(0,500) + '...';
    }

    async requestNotificationPermission() {
        if (Notification.permission === 'default') {
            document.getElementById('notify-prompt').classList.remove('hidden');
        }
    }

    animateEntrance() {
        document.getElementById('splash').style.opacity = '0';
        setTimeout(() => document.getElementById('splash').remove(), 500);
    }

    async deleteReading(timestamp) {
        const tx = this.db.transaction('readings', 'readwrite');
        tx.objectStore('readings').delete(timestamp);
        await this.loadData();
        this.updateUI();
    }
}

const tracker = new KSEBTracker();
[file:1][file:2]
