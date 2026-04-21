// PocketNet Core v2.0
(function(){
    class PocketNet {
        constructor(){
            this.publicArticles = [];
            this.searchQuery = '';
            this.currentViewArticleId = null;

            this.apiUrl = '/api/portal.bin';
            this.deltaUrl = '/api/delta.bin';

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
                const stream = new DecompressionStream('gzip');
                const writer = stream.writable.getWriter();
                writer.write(new Uint8Array(buffer));
                writer.close();
                const decompressed = await new Response(stream.readable).arrayBuffer();
                return new TextDecoder().decode(decompressed);
            }catch(e){
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

        bindEvents(){
            const searchInput = document.getElementById('searchInput');
            if(searchInput){
                searchInput.addEventListener('input', (e) => {
                    this.searchQuery = e.target.value;
                    this.render();
                });
            }

            document.getElementById('viewBackBtn').onclick = () => this.backToList();
        }

        async init(){
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
