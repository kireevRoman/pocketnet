// PocketNet Core v3.0 — Bluetooth синхронизация
(function(){
    const SYNC_KEY = 'pocketnet_public';
    const SYNC_TIME_KEY = 'pocketnet_sync_time';
    
    class PocketNet {
        constructor() {
            this.articles = [];
            this.searchQuery = '';
            this.currentId = null;
            
            const base = new URL('./', document.baseURI);
            this.apiUrl = new URL('api/portal.bin', base).href;
            this.deltaUrl = new URL('api/delta.bin', base).href;
            
            this.init();
        }
        
        dedupe(articles) {
            if (!Array.isArray(articles)) return [];
            const map = new Map();
            for (const a of articles) {
                if (a && a.id != null) map.set(Number(a.id), a);
            }
            return Array.from(map.values()).sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
        }
        
        async decompress(buffer) {
            try {
                const stream = new DecompressionStream('gzip');
                const writer = stream.writable.getWriter();
                writer.write(new Uint8Array(buffer));
                writer.close();
                const decompressed = await new Response(stream.readable).arrayBuffer();
                return new TextDecoder().decode(decompressed);
            } catch(e) {
                return new TextDecoder().decode(new Uint8Array(buffer));
            }
        }
        
        async loadPortal() {
            try {
                const res = await fetch(this.apiUrl);
                if (res.ok) {
                    const compressed = await res.arrayBuffer();
                    const json = await this.decompress(compressed);
                    this.articles = this.dedupe(JSON.parse(json));
                    this.save();
                    UI.setStatus(`${this.articles.length} статей`);
                    this.updateSyncTime(new Date());
                } else {
                    this.loadCache();
                }
            } catch(e) {
                this.loadCache();
            }
            this.render();
        }
        
        save() {
            localStorage.setItem(SYNC_KEY, JSON.stringify(this.articles));
        }
        
        loadCache() {
            const cached = localStorage.getItem(SYNC_KEY);
            if (cached) {
                this.articles = this.dedupe(JSON.parse(cached));
                UI.setStatus('Офлайн');
            }
        }
        
        updateSyncTime(date) {
            localStorage.setItem(SYNC_TIME_KEY, date.toISOString());
            UI.setSyncLabel(`Портал обновлён: ${date.toLocaleString()}`);
        }
        
        getSyncTime() {
            const t = localStorage.getItem(SYNC_TIME_KEY);
            if (t) UI.setSyncLabel(`Портал обновлён: ${new Date(t).toLocaleString()}`);
            else UI.setSyncLabel('Портал: время неизвестно');
        }
        
        async checkUpdates() {
            try {
                const res = await fetch(this.deltaUrl);
                if (res.ok) {
                    const compressed = await res.arrayBuffer();
                    const json = await this.decompress(compressed);
                    const delta = JSON.parse(json);
                    if (delta.newArticles?.length) {
                        const before = this.articles.length;
                        this.articles.push(...delta.newArticles);
                        this.articles = this.dedupe(this.articles);
                        if (this.articles.length > before) {
                            this.save();
                            this.updateSyncTime(new Date());
                            if (!this.currentId) this.render();
                            UI.setStatus(`+${this.articles.length - before} новых`);
                        }
                    }
                }
            } catch(e) {}
        }
        
        render() {
            const search = this.searchQuery.toLowerCase();
            const filtered = this.articles.filter(a =>
                a.title.toLowerCase().includes(search) ||
                (a.content && a.content.toLowerCase().includes(search))
            );
            UI.renderArticles(filtered, (id) => this.showArticle(id));
        }
        
        showArticle(id) {
            const art = this.articles.find(a => a.id === id);
            if (art) {
                this.currentId = id;
                UI.showArticle(art);
            }
        }
        
        backToList() {
            this.currentId = null;
            UI.hideArticle();
            this.render();
        }
        
        // Синхронизация через Bluetooth
        async sendViaBluetooth() {
            if (!BLUETOOTH.isSupported()) {
                UI.setStatus('❌ Bluetooth не поддерживается', true);
                return;
            }
            
            const portalData = localStorage.getItem(SYNC_KEY);
            if (!portalData) {
                UI.setStatus('❌ Нет данных для отправки', true);
                return;
            }
            
            UI.showBleStatus('📤 Подготовка к отправке...', 'waiting');
            
            const success = await BLUETOOTH.sendData(
                portalData,
                (percent) => UI.showProgress(percent, `Передача: ${Math.round(percent)}%`),
                (msg) => UI.showBleStatus(msg, msg.includes('✅') ? 'success' : 'waiting')
            );
            
            if (success) {
                UI.setStatus('✅ Портал отправлен!');
                setTimeout(() => UI.hideDialog(), 1500);
            }
            UI.hideProgress();
        }
        
        async receiveViaBluetooth() {
            if (!BLUETOOTH.isSupported()) {
                UI.setStatus('❌ Bluetooth не поддерживается', true);
                return;
            }
            
            UI.showBleStatus('📥 Ожидание данных...', 'waiting');
            
            const data = await BLUETOOTH.receiveData(
                (percent) => UI.showProgress(percent, `Приём: ${Math.round(percent)}%`),
                (msg) => UI.showBleStatus(msg, msg.includes('✅') ? 'success' : 'waiting')
            );
            
            if (data) {
                localStorage.setItem(SYNC_KEY, data);
                await this.loadPortal();
                this.updateSyncTime(new Date());
                UI.setStatus('✅ Портал получен!');
                setTimeout(() => UI.hideDialog(), 1500);
            }
            UI.hideProgress();
        }
        
        // Ручная синхронизация
        exportPortal() {
            const data = localStorage.getItem(SYNC_KEY);
            if (!data) {
                UI.setStatus('❌ Нет данных для экспорта', true);
                return;
            }
            const compressed = btoa(unescape(encodeURIComponent(data)));
            const exportText = `POCKETNET|${compressed}`;
            UI.showExportArea(exportText);
            UI.setStatus('✅ Текст экспортирован');
        }
        
        importPortal(text) {
            if (!text.startsWith('POCKETNET|')) {
                UI.setStatus('❌ Неверный формат', true);
                return;
            }
            try {
                const compressed = text.substring('POCKETNET|'.length);
                const data = decodeURIComponent(escape(atob(compressed)));
                localStorage.setItem(SYNC_KEY, data);
                this.loadPortal();
                this.updateSyncTime(new Date());
                UI.setStatus('✅ Портал импортирован!');
                UI.hideDialog();
            } catch(e) {
                UI.setStatus('❌ Ошибка импорта', true);
            }
        }
        
        bindEvents() {
            const search = document.getElementById('searchInput');
            if (search) {
                search.addEventListener('input', (e) => {
                    this.searchQuery = e.target.value;
                    this.render();
                });
            }
            
            const back = document.getElementById('backBtn');
            if (back) back.onclick = () => this.backToList();
            
            const syncBtn = document.getElementById('syncBtn');
            if (syncBtn) syncBtn.onclick = () => UI.showDialog();
            
            const shareBtn = document.getElementById('shareBtn');
            if (shareBtn) shareBtn.onclick = () => UI.showDialog();
            
            const close = document.getElementById('closeSyncDialog');
            if (close) close.onclick = () => UI.hideDialog();
            
            const sendBtn = document.getElementById('startSendBtn');
            if (sendBtn) sendBtn.onclick = () => this.sendViaBluetooth();
            
            const receiveBtn = document.getElementById('startReceiveBtn');
            if (receiveBtn) receiveBtn.onclick = () => this.receiveViaBluetooth();
            
            const exportBtn = document.getElementById('exportBtn');
            if (exportBtn) exportBtn.onclick = () => this.exportPortal();
            
            const importBtn = document.getElementById('importBtn');
            if (importBtn) importBtn.onclick = () => UI.showImportArea();
            
            const copyBtn = document.getElementById('copyExportBtn');
            if (copyBtn) copyBtn.onclick = async () => {
                const text = document.getElementById('exportText');
                if (text && text.value) {
                    await navigator.clipboard.writeText(text.value);
                    UI.setStatus('📋 Скопировано');
                }
            };
            
            const applyBtn = document.getElementById('applyImportBtn');
            if (applyBtn) {
                applyBtn.onclick = () => {
                    const text = document.getElementById('importText');
                    if (text) this.importPortal(text.value);
                };
            }
        }
        
        async init() {
            UI.init();
            this.getSyncTime();
            await this.loadPortal();
            this.bindEvents();
            await this.checkUpdates();
            setInterval(() => this.checkUpdates(), 3600000);
            
            if ('serviceWorker' in navigator) {
                try {
                    await navigator.serviceWorker.register('sw.js');
                } catch(e) {}
            }
        }
    }
    
    window.PocketNet = PocketNet;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new PocketNet());
    } else {
        new PocketNet();
    }
})();