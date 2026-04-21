// PocketNet Core v2.1
(function(){
    const SYNC_AT_KEY = 'pocketnet_portal_sync_at';

    const sigEncode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
    const sigDecode = (str) => JSON.parse(decodeURIComponent(escape(atob(str))));

    const waitIceGatheringComplete = (pc) => new Promise((resolve) => {
        if(pc.iceGatheringState === 'complete') return resolve();
        const onChange = () => {
            if(pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', onChange);
                resolve();
            }
        };
        pc.addEventListener('icegatheringstatechange', onChange);
        setTimeout(resolve, 8000);
    });

    class PocketNet {
        constructor(){
            this.publicArticles = [];
            this.searchQuery = '';
            this.currentViewArticleId = null;
            this._sharePc = null;
            this._shareDc = null;
            this._urlQr = null;

            const base = new URL('./', document.baseURI);
            this.apiUrl = new URL('api/portal.bin', base).href;
            this.deltaUrl = new URL('api/delta.bin', base).href;

            this.init();
        }

        dedupePublicArticles(articles){
            if(!Array.isArray(articles)) return [];
            const byId = new Map();
            for(const a of articles){
                if(a && a.id != null) byId.set(Number(a.id), a);
            }
            return Array.from(byId.values()).sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
        }

        _supportsDecompressionFormat(format){
            try{
                new DecompressionStream(format);
                return true;
            }catch(_){
                return false;
            }
        }

        async _decompressWithFormat(buffer, format){
            const stream = new DecompressionStream(format);
            const writer = stream.writable.getWriter();
            writer.write(new Uint8Array(buffer));
            writer.close();
            const decompressed = await new Response(stream.readable).arrayBuffer();
            return new TextDecoder().decode(decompressed);
        }

        async decompress(buffer){
            const u8 = new Uint8Array(buffer);
            if(u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b){
                try{ return await this._decompressWithFormat(buffer, 'gzip'); }catch(e){ /* fallthrough */ }
            }
            if(u8.length >= 4 && u8[0] === 0x28 && u8[1] === 0xb5 && u8[2] === 0x2f && u8[3] === 0xfd){
                if(this._supportsDecompressionFormat('zstd')){
                    try{ return await this._decompressWithFormat(buffer, 'zstd'); }catch(e){ /* fallthrough */ }
                }
            }
            if(u8.length >= 2 && u8[0] === 0x78 && (u8[1] === 0x01 || u8[1] === 0x9c || u8[1] === 0xda)){
                try{ return await this._decompressWithFormat(buffer, 'deflate'); }catch(e){ /* fallthrough */ }
            }
            if(this._supportsDecompressionFormat('deflate')){
                try{ return await this._decompressWithFormat(buffer, 'deflate'); }catch(e){ /* fallthrough */ }
            }
            if(this._supportsDecompressionFormat('gzip')){
                try{ return await this._decompressWithFormat(buffer, 'gzip'); }catch(e){ /* fallthrough */ }
            }
            return this.fallbackDecompress(buffer);
        }

        fallbackDecompress(buffer){
            try{
                return new TextDecoder().decode(new Uint8Array(buffer));
            }catch(e){ return '[]'; }
        }

        setPortalSyncedAt(iso){
            localStorage.setItem(SYNC_AT_KEY, iso);
            this.updatePortalSyncLabel();
        }

        getPortalSyncedAt(){
            return localStorage.getItem(SYNC_AT_KEY);
        }

        updatePortalSyncLabel(){
            const el = document.getElementById('portalSyncLabel');
            if(!el) return;
            const t = this.getPortalSyncedAt();
            if(!t){
                el.textContent = 'Портал: время последней синхронизации неизвестно';
                return;
            }
            el.textContent = `Портал обновлён: ${new Date(t).toLocaleString()}`;
        }

        async loadPublicPortal(){
            try{
                const res = await fetch(this.apiUrl);
                if(res.ok){
                    const compressed = await res.arrayBuffer();
                    const json = await this.decompress(compressed);
                    this.publicArticles = this.dedupePublicArticles(JSON.parse(json));
                    this.showStatus(`${this.publicArticles.length} статей`);
                    this.savePublicCache();
                    this.setPortalSyncedAt(new Date().toISOString());
                }else{
                    this.loadPublicCache();
                }
            }catch(e){
                this.loadPublicCache();
            }
            this.render();
        }

        savePublicCache(){
            localStorage.setItem('pocketnet_public', JSON.stringify(this.publicArticles));
        }

        loadPublicCache(){
            const cached = localStorage.getItem('pocketnet_public');
            if(cached){
                this.publicArticles = this.dedupePublicArticles(JSON.parse(cached));
                this.showStatus('Офлайн');
            }
        }

        async checkPublicUpdates(){
            try{
                const res = await fetch(this.deltaUrl);
                if(res.ok){
                    const compressed = await res.arrayBuffer();
                    const json = await this.decompress(compressed);
                    const delta = JSON.parse(json);
                    if(delta.newArticles?.length){
                        const lenBefore = this.publicArticles.length;
                        this.publicArticles.push(...delta.newArticles);
                        this.publicArticles = this.dedupePublicArticles(this.publicArticles);
                        const netNew = this.publicArticles.length - lenBefore;
                        if(netNew > 0){
                            this.savePublicCache();
                            this.setPortalSyncedAt(new Date().toISOString());
                            if(!this.currentViewArticleId) this.render();
                            this.showStatus(`+${netNew}`);
                        }
                    }
                }
            }catch(e){}
        }

        render(){
            const container = document.getElementById('publicList');
            const search = this.searchQuery.toLowerCase();
            const filtered = this.publicArticles.filter(a =>
                a.title.toLowerCase().includes(search) ||
                (a.content && a.content.toLowerCase().includes(search))
            );

            if(filtered.length === 0){
                container.innerHTML = '<div class="empty">Нет статей</div>';
                return;
            }

            container.innerHTML = filtered.map(a => `
                <div class="card" data-id="${a.id}">
                    <div class="title">${this.escape(a.title)}</div>
                    <div class="meta">
                        <span>${this.escape(a.category || 'Общее')}</span>
                        <span>${new Date(a.timestamp).toLocaleDateString()}</span>
                        ${a.source ? `<span>${this.escape(a.source)}</span>` : ''}
                    </div>
                </div>
            `).join('');

            document.querySelectorAll('#publicList .card').forEach(el => {
                el.addEventListener('click', () => {
                    const id = parseInt(el.dataset.id, 10);
                    this.showArticle(id);
                });
            });
        }

        showArticle(id){
            const art = this.publicArticles.find(a => a.id === id);
            if(!art) return;

            this.currentViewArticleId = id;

            document.getElementById('publicList').style.display = 'none';
            document.getElementById('articleView').style.display = 'block';

            document.getElementById('viewTitle').innerHTML = this.escape(art.title);
            document.getElementById('viewContent').innerHTML = (art.content || '').replace(/\n/g, '<br>');
        }

        backToList(){
            this.currentViewArticleId = null;
            document.getElementById('publicList').style.display = 'block';
            document.getElementById('articleView').style.display = 'none';
            this.render();
        }

        showStatus(msg){
            const el = document.getElementById('statusText');
            if(el) el.innerText = msg;
            setTimeout(() => {
                if(el && el.innerText === msg) el.innerText = '';
            }, 3000);
        }

        escape(str){
            if(!str) return '';
            return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]);
        }

        _rtcConfig(){
            return {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' }
                ]
            };
        }

        _closeSharePeer(){
            if(this._shareDc){
                try{ this._shareDc.close(); }catch(_){}
                this._shareDc = null;
            }
            if(this._sharePc){
                try{ this._sharePc.close(); }catch(_){}
                this._sharePc = null;
            }
        }

        _sendArticlesOver(dc){
            if(!dc || dc.readyState !== 'open') return;
            const payload = JSON.stringify({ type: 'articles', articles: this.publicArticles });
            dc.send(payload);
        }

        _mergeIncomingArticles(raw){
            let data;
            try{
                data = JSON.parse(raw);
            }catch(e){
                return;
            }
            if(data.type !== 'articles' || !Array.isArray(data.articles)) return;
            const before = this.publicArticles.length;
            this.publicArticles.push(...data.articles);
            this.publicArticles = this.dedupePublicArticles(this.publicArticles);
            this.savePublicCache();
            this.setPortalSyncedAt(new Date().toISOString());
            if(!this.currentViewArticleId) this.render();
            const added = this.publicArticles.length - before;
            this.showStatus(added > 0 ? `Синхронизация: +${added}` : 'Синхронизация: без изменений');
        }

        _wireDataChannel(dc){
            dc.onmessage = (ev) => this._mergeIncomingArticles(ev.data);
        }

        renderUrlQr(){
            const el = document.getElementById('shareUrlQr');
            if(!el || typeof QRCode === 'undefined') return;
            const url = new URL('./', location.href).href;
            if(this._urlQr){
                this._urlQr.clear();
            }
            try{
                this._urlQr = new QRCode(el, {
                    text: url,
                    width: 168,
                    height: 168,
                    colorDark: '#111111',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
            }catch(e){
                el.innerHTML = '<p class="qr-fallback">Не удалось построить QR (слишком длинная ссылка).</p>';
            }
        }

        renderSignalQr(containerId, text){
            const el = document.getElementById(containerId);
            if(!el || typeof QRCode === 'undefined') return;
            el.innerHTML = '';
            try{
                new QRCode(el, {
                    text,
                    width: 200,
                    height: 200,
                    colorDark: '#111111',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.L
                });
            }catch(e){
                el.innerHTML = '<p class="qr-fallback">Данные сигналинга слишком большие для одного QR — используйте копирование текста.</p>';
            }
        }

        handleOpenShare = () => {
            const dlg = document.getElementById('shareDialog');
            if(!dlg) return;
            if(typeof dlg.showModal === 'function'){
                dlg.showModal();
            }
            this.renderUrlQr();
            const hostStep = document.getElementById('webrtcHostStep');
            const guestStep = document.getElementById('webrtcGuestStep');
            const hostOut = document.getElementById('hostSignalOut');
            const guestIn = document.getElementById('guestSignalIn');
            const guestOut = document.getElementById('guestSignalOut');
            const hostAnswer = document.getElementById('hostAnswerIn');
            if(hostStep) hostStep.hidden = true;
            if(guestStep) guestStep.hidden = true;
            if(hostOut) hostOut.value = '';
            if(guestIn) guestIn.value = '';
            if(guestOut) guestOut.value = '';
            if(hostAnswer) hostAnswer.value = '';
            const hQr = document.getElementById('hostSignalQr');
            const gQr = document.getElementById('guestSignalQr');
            if(hQr) hQr.innerHTML = '';
            if(gQr) gQr.innerHTML = '';
            this._closeSharePeer();
        };

        handleCloseShare = () => {
            const dlg = document.getElementById('shareDialog');
            if(dlg && typeof dlg.close === 'function'){
                dlg.close();
            }
            this._closeSharePeer();
        };

        handleStartHost = async () => {
            this._closeSharePeer();
            const hostStep = document.getElementById('webrtcHostStep');
            const hostOut = document.getElementById('hostSignalOut');
            const hostAnswer = document.getElementById('hostAnswerIn');
            if(hostStep) hostStep.hidden = false;
            if(hostOut) hostOut.value = 'Создание приглашения…';
            if(hostAnswer) hostAnswer.value = '';

            const pc = new RTCPeerConnection(this._rtcConfig());
            this._sharePc = pc;
            const dc = pc.createDataChannel('pocketnet', { ordered: true });
            this._shareDc = dc;
            dc.onopen = () => this._sendArticlesOver(dc);
            this._wireDataChannel(dc);

            try{
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await waitIceGatheringComplete(pc);
                const pack = sigEncode({ v: 1, type: 'offer', sdp: pc.localDescription.sdp });
                if(hostOut) hostOut.value = pack;
                this.renderSignalQr('hostSignalQr', pack);
            }catch(e){
                if(hostOut) hostOut.value = 'Ошибка: ' + (e && e.message ? e.message : String(e));
            }
        };

        handleApplyHostAnswer = async () => {
            const hostAnswer = document.getElementById('hostAnswerIn');
            const pc = this._sharePc;
            if(!pc || !hostAnswer || !hostAnswer.value.trim()) return;
            try{
                const msg = sigDecode(hostAnswer.value.trim());
                if(msg.v !== 1 || msg.type !== 'answer' || !msg.sdp) throw new Error('Неверный ответ');
                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
                this.showStatus('Соединение устанавливается…');
            }catch(e){
                this.showStatus('Ошибка ответа: ' + (e && e.message ? e.message : String(e)));
            }
        };

        handleGuestCreateAnswer = async () => {
            this._closeSharePeer();
            const guestIn = document.getElementById('guestSignalIn');
            const guestOut = document.getElementById('guestSignalOut');
            const guestStep = document.getElementById('webrtcGuestStep');
            if(!guestIn || !guestIn.value.trim()){
                this.showStatus('Вставьте приглашение');
                return;
            }
            if(guestStep) guestStep.hidden = false;
            if(guestOut) guestOut.value = 'Создание ответа…';

            let msg;
            try{
                msg = sigDecode(guestIn.value.trim());
            }catch(e){
                if(guestOut) guestOut.value = 'Неверный формат приглашения';
                return;
            }
            if(msg.v !== 1 || msg.type !== 'offer' || !msg.sdp){
                if(guestOut) guestOut.value = 'Неверное приглашение';
                return;
            }

            const pc = new RTCPeerConnection(this._rtcConfig());
            this._sharePc = pc;
            pc.ondatachannel = (e) => {
                const ch = e.channel;
                this._shareDc = ch;
                ch.onopen = () => this._sendArticlesOver(ch);
                this._wireDataChannel(ch);
            };

            try{
                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await waitIceGatheringComplete(pc);
                const pack = sigEncode({ v: 1, type: 'answer', sdp: pc.localDescription.sdp });
                if(guestOut) guestOut.value = pack;
                this.renderSignalQr('guestSignalQr', pack);
            }catch(e){
                if(guestOut) guestOut.value = 'Ошибка: ' + (e && e.message ? e.message : String(e));
            }
        };

        bindEvents(){
            const searchInput = document.getElementById('searchInput');
            if(searchInput){
                searchInput.addEventListener('input', (e) => {
                    this.searchQuery = e.target.value;
                    this.render();
                });
            }

            document.getElementById('viewBackBtn').onclick = () => this.backToList();

            const shareBtn = document.getElementById('sharePortalBtn');
            if(shareBtn) shareBtn.addEventListener('click', this.handleOpenShare);

            const closeShare = document.getElementById('shareDialogClose');
            if(closeShare) closeShare.addEventListener('click', this.handleCloseShare);

            const startHost = document.getElementById('webrtcHostStart');
            if(startHost) startHost.addEventListener('click', () => { this.handleStartHost(); });

            const applyAnswer = document.getElementById('webrtcHostApply');
            if(applyAnswer) applyAnswer.addEventListener('click', () => { this.handleApplyHostAnswer(); });

            const guestGo = document.getElementById('webrtcGuestCreate');
            if(guestGo) guestGo.addEventListener('click', () => { this.handleGuestCreateAnswer(); });

            const copyHost = document.getElementById('copyHostSignal');
            if(copyHost) copyHost.addEventListener('click', async () => {
                const el = document.getElementById('hostSignalOut');
                if(!el || !el.value) return;
                try{
                    await navigator.clipboard.writeText(el.value);
                    this.showStatus('Скопировано');
                }catch(e){
                    el.select();
                    document.execCommand('copy');
                    this.showStatus('Скопировано');
                }
            });

            const copyGuest = document.getElementById('copyGuestSignal');
            if(copyGuest) copyGuest.addEventListener('click', async () => {
                const el = document.getElementById('guestSignalOut');
                if(!el || !el.value) return;
                try{
                    await navigator.clipboard.writeText(el.value);
                    this.showStatus('Скопировано');
                }catch(e){
                    el.select();
                    document.execCommand('copy');
                    this.showStatus('Скопировано');
                }
            });
        }

        async init(){
            if('serviceWorker' in navigator){
                try{
                    await navigator.serviceWorker.register(new URL('sw.js', document.baseURI));
                }catch(e){}
            }
            this.updatePortalSyncLabel();
            await this.loadPublicPortal();
            this.bindEvents();
            await this.checkPublicUpdates();
            setInterval(() => this.checkPublicUpdates(), 3600000);
        }
    }

    if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', () => new PocketNet());
    }else{
        new PocketNet();
    }
})();
