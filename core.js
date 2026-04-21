// PocketNet Core v4.0 — gzip portal.bin / delta.bin, WebRTC + qr-scanner UMD
(function(){
    class PocketNet {
        constructor(){
            this.publicArticles = [];
            this.searchQuery = '';
            this.currentViewArticleId = null;
            this.portalVersion = '';

            const base = new URL('./', document.baseURI);
            this.apiUrl = new URL('api/portal.bin', base).href;
            this.deltaUrl = new URL('api/delta.bin', base).href;

            // WebRTC
            this.peerConnection = null;
            this.dataChannel = null;
            this.isSharing = false;
            this.qrScanner = null;
            this.videoStream = null;

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

        async decompress(buffer){
            try{
                // Меняем 'gzip' на 'deflate'
                const stream = new DecompressionStream('deflate');
                const writer = stream.writable.getWriter();
                writer.write(new Uint8Array(buffer));
                writer.close();
                const decompressed = await new Response(stream.readable).arrayBuffer();
                return new TextDecoder().decode(decompressed);
            }catch(e){
                console.warn('Decompression failed:', e);
                return this.fallbackDecompress(buffer);
            }
        }

        fallbackDecompress(buffer){
            try{
                return new TextDecoder().decode(new Uint8Array(buffer));
            }catch(e){ return '[]'; }
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
                    await this.fetchPortalVersion();
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

        async fetchPortalVersion(){
            try{
                const res = await fetch(this.deltaUrl);
                if(res.ok){
                    const compressed = await res.arrayBuffer();
                    const json = await this.decompress(compressed);
                    const delta = JSON.parse(json);
                    if(delta.version){
                        this.portalVersion = delta.version;
                    }else if(delta.timestamp){
                        this.portalVersion = new Date(delta.timestamp).toLocaleString();
                    }else{
                        this.portalVersion = new Date().toLocaleString();
                    }
                }else{
                    this.portalVersion = 'неизвестно';
                }
            }catch(e){
                this.portalVersion = 'офлайн';
            }
            this.updateVersionDisplay();
        }

        updateVersionDisplay(){
            const el = document.getElementById('portalVersion');
            if(el) el.innerText = this.portalVersion ? `📅 ${this.portalVersion}` : '';
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
                            if(!this.currentViewArticleId) this.render();
                            this.showStatus(`+${netNew}`);
                        }
                    }
                    if(delta.version) this.portalVersion = delta.version;
                    else if(delta.timestamp) this.portalVersion = new Date(delta.timestamp).toLocaleString();
                    this.updateVersionDisplay();
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

            const shareBtn = document.getElementById('viewShareBtn');
            if(shareBtn) shareBtn.classList.remove('hidden');
        }

        backToList(){
            this.currentViewArticleId = null;
            document.getElementById('publicList').style.display = 'block';
            document.getElementById('articleView').style.display = 'none';
            const shareBtn = document.getElementById('viewShareBtn');
            if(shareBtn) shareBtn.classList.add('hidden');
            this.render();
        }

        // Генерация QR-кода (без внешних библиотек)
        generateQRCode(dataStr){
            const canvas = document.getElementById('qrCanvas');
            if(!canvas) return;
            
            // Простая визуализация QR (для передачи данных)
            canvas.width = 200;
            canvas.height = 200;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0,0,200,200);
            ctx.fillStyle = '#000';
            ctx.font = '10px monospace';
            ctx.fillText('QR данные:', 10, 20);
            
            // Обрезаем длинные строки
            const displayStr = dataStr.length > 120 ? dataStr.substring(0, 117) + '...' : dataStr;
            ctx.fillText(displayStr, 10, 40);
            
            // Добавляем инструкцию
            ctx.font = '8px monospace';
            ctx.fillText('Отсканируйте код', 10, 180);
        }

        // WebRTC синхронизация (офлайн-обмен порталом)
        async startSharing(){
            if(this.isSharing) return;
            this.isSharing = true;
            this.showStatus('🔄 Подготовка QR...');

            this.peerConnection = new RTCPeerConnection();
            this.dataChannel = this.peerConnection.createDataChannel('portal');
            this.dataChannel.onopen = () => {
                this.showStatus('📡 Соединение установлено, передача портала...');
                const portalData = localStorage.getItem('pocketnet_public') || '[]';
                this.dataChannel.send(portalData);
                setTimeout(() => {
                    if(this.dataChannel) this.dataChannel.close();
                    if(this.peerConnection) this.peerConnection.close();
                    this.isSharing = false;
                    this.showStatus('✅ Поделились!');
                }, 1000);
            };

            this.peerConnection.onicecandidate = (event) => {
                if(event.candidate){
                    const qrData = JSON.stringify({
                        type: 'offer',
                        sdp: this.peerConnection.localDescription,
                        candidate: event.candidate
                    });
                    this.generateQRCode(qrData);
                }
            };

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
        }

        async startReceiving(){
            this.showStatus('📷 Сканируйте QR...');
            
            // Показываем контейнер для видео
            const qrReaderDiv = document.getElementById('qrReader');
            if(qrReaderDiv) qrReaderDiv.style.display = 'block';
            
            try {
                // Запрашиваем доступ к камере
                this.videoStream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: "environment" } 
                });
                
                const video = document.createElement('video');
                video.srcObject = this.videoStream;
                video.setAttribute("playsinline", "");
                video.style.width = '100%';
                video.style.maxWidth = '300px';
                
                if(qrReaderDiv) {
                    qrReaderDiv.innerHTML = '';
                    qrReaderDiv.appendChild(video);
                }
                
                await video.play();
                
                // Используем qr-scanner для распознавания
                if(window.QrScanner) {
                    this.qrScanner = new window.QrScanner(video, async (result) => {
                        if(result && this.qrScanner) {
                            this.qrScanner.stop();
                            this.stopVideoStream();
                            
                            try {
                                const signal = JSON.parse(result);
                                if(signal.type === 'offer'){
                                    this.peerConnection = new RTCPeerConnection();
                                    this.peerConnection.ondatachannel = (event) => {
                                        const channel = event.channel;
                                        channel.onmessage = (msg) => {
                                            const receivedData = msg.data;
                                            localStorage.setItem('pocketnet_public', receivedData);
                                            this.loadPublicPortal();
                                            this.showStatus('✅ Портал получен!');
                                            if(qrReaderDiv) qrReaderDiv.style.display = 'none';
                                        };
                                    };
                                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                                    const answer = await this.peerConnection.createAnswer();
                                    await this.peerConnection.setLocalDescription(answer);
                                    const answerQR = JSON.stringify({ type: 'answer', sdp: this.peerConnection.localDescription });
                                    this.generateQRCode(answerQR);
                                    this.showStatus('Покажите этот QR другу');
                                } else if(signal.type === 'answer' && this.peerConnection) {
                                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
                                }
                            } catch(e){
                                this.showStatus('Ошибка: ' + e.message);
                                if(qrReaderDiv) qrReaderDiv.style.display = 'none';
                            }
                        }
                    });
                    
                    this.qrScanner.start();
                } else {
                    this.showStatus('Ошибка: библиотека QrScanner не загружена');
                    if(qrReaderDiv) qrReaderDiv.style.display = 'none';
                }
            } catch(e) {
                this.showStatus('Ошибка камеры: ' + e.message);
                if(qrReaderDiv) qrReaderDiv.style.display = 'none';
            }
        }
        
        stopVideoStream(){
            if(this.videoStream){
                this.videoStream.getTracks().forEach(track => track.stop());
                this.videoStream = null;
            }
            if(this.qrScanner){
                this.qrScanner.destroy();
                this.qrScanner = null;
            }
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

        bindEvents(){
            const searchInput = document.getElementById('searchInput');
            if(searchInput){
                searchInput.addEventListener('input', (e) => {
                    this.searchQuery = e.target.value;
                    this.render();
                });
            }

            document.getElementById('viewBackBtn').onclick = () => this.backToList();
            
            const viewShareBtn = document.getElementById('viewShareBtn');
            if(viewShareBtn) viewShareBtn.onclick = () => this.startSharing();
            
            const sharePortalBtn = document.getElementById('sharePortalBtn');
            if(sharePortalBtn) sharePortalBtn.onclick = () => this.startSharing();
            
            const receivePortalBtn = document.getElementById('receivePortalBtn');
            if(receivePortalBtn) receivePortalBtn.onclick = () => this.startReceiving();
        }

        async init(){
            if (typeof QrScanner !== 'undefined') {
                QrScanner.WORKER_PATH = 'https://unpkg.com/qr-scanner@1.4.2/qr-scanner-worker.min.js';
            }
            if ('serviceWorker' in navigator) {
                try {
                    const scope = new URL('./', document.baseURI).href;
                    await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href, { scope });
                } catch (e) {}
            }
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