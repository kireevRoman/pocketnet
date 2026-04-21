// UI-модуль PocketNet
const UI = {
    elements: {},
    
    init() {
        this.elements = {
            statusText: document.getElementById('statusText'),
            syncLabel: document.getElementById('syncLabel'),
            searchInput: document.getElementById('searchInput'),
            publicList: document.getElementById('publicList'),
            articleView: document.getElementById('articleView'),
            viewTitle: document.getElementById('viewTitle'),
            viewContent: document.getElementById('viewContent'),
            backBtn: document.getElementById('viewBackBtn') || document.getElementById('backBtn'),
            syncBtn: document.getElementById('syncBtn'),
            shareBtn: document.getElementById('shareBtn'),
            syncDialog: document.getElementById('syncDialog'),
            closeSyncDialog: document.getElementById('closeSyncDialog'),
            bleStatus: document.getElementById('bleStatus'),
            bleStatusText: document.getElementById('bleStatusText'),
            syncProgress: document.getElementById('syncProgress'),
            syncProgressBar: document.getElementById('syncProgressBar'),
            syncProgressText: document.getElementById('syncProgressText'),
            startSendBtn: document.getElementById('startSendBtn'),
            startReceiveBtn: document.getElementById('startReceiveBtn'),
            exportBtn: document.getElementById('exportBtn'),
            importBtn: document.getElementById('importBtn'),
            exportArea: document.getElementById('exportArea'),
            exportText: document.getElementById('exportText'),
            copyExportBtn: document.getElementById('copyExportBtn'),
            importArea: document.getElementById('importArea'),
            importText: document.getElementById('importText'),
            applyImportBtn: document.getElementById('applyImportBtn')
        };
    },
    
    setStatus(msg, isError = false) {
        if (this.elements.statusText) {
            this.elements.statusText.innerText = msg;
            if (!isError) {
                setTimeout(() => {
                    if (this.elements.statusText.innerText === msg) {
                        this.elements.statusText.innerText = '';
                    }
                }, 3000);
            }
        }
    },
    
    setSyncLabel(text) {
        if (this.elements.syncLabel) {
            this.elements.syncLabel.innerText = text;
        }
    },
    
    showBleStatus(text, type = 'waiting') {
        if (this.elements.bleStatusText) {
            this.elements.bleStatusText.innerText = text;
        }
        if (this.elements.bleStatus) {
            this.elements.bleStatus.className = `ble-status ${type}`;
        }
    },
    
    showProgress(percent, text) {
        if (this.elements.syncProgress) {
            this.elements.syncProgress.classList.remove('hidden');
        }
        if (this.elements.syncProgressBar) {
            this.elements.syncProgressBar.value = percent;
        }
        if (this.elements.syncProgressText) {
            this.elements.syncProgressText.innerText = text;
        }
    },
    
    hideProgress() {
        if (this.elements.syncProgress) {
            this.elements.syncProgress.classList.add('hidden');
        }
    },
    
    renderArticles(articles, onCardClick) {
        if (!this.elements.publicList) return;
        
        if (!articles || articles.length === 0) {
            this.elements.publicList.innerHTML = '<div class="empty">📭 Нет статей</div>';
            return;
        }
        
        this.elements.publicList.innerHTML = articles.map(a => `
            <div class="card" data-id="${a.id}">
                <div class="title">${this.escape(a.title)}</div>
                <div class="meta">
                    <span>${this.escape(a.category || 'Общее')}</span>
                    <span>${new Date(a.timestamp).toLocaleDateString()}</span>
                    ${a.source ? `<span>📡 ${this.escape(a.source)}</span>` : ''}
                </div>
            </div>
        `).join('');
        
        this.elements.publicList.querySelectorAll('.card').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id, 10);
                if (onCardClick) onCardClick(id);
            });
        });
    },
    
    showArticle(article) {
        if (!article) return;
        if (this.elements.publicList) this.elements.publicList.style.display = 'none';
        if (this.elements.articleView) this.elements.articleView.style.display = 'block';
        if (this.elements.viewTitle) this.elements.viewTitle.innerHTML = this.escape(article.title);
        if (this.elements.viewContent) {
            this.elements.viewContent.innerHTML = (article.content || '').replace(/\n/g, '<br>');
        }
    },
    
    hideArticle() {
        if (this.elements.publicList) this.elements.publicList.style.display = 'block';
        if (this.elements.articleView) this.elements.articleView.style.display = 'none';
    },
    
    escape(str) {
        if (!str) return '';
        return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]);
    },
    
    showDialog() {
        if (this.elements.syncDialog && typeof this.elements.syncDialog.showModal === 'function') {
            this.elements.syncDialog.showModal();
        }
    },
    
    hideDialog() {
        if (this.elements.syncDialog && typeof this.elements.syncDialog.close === 'function') {
            this.elements.syncDialog.close();
        }
        this.hideProgress();
        this.showBleStatus('⚡ Готов к синхронизации', 'waiting');
    },
    
    showExportArea(text) {
        if (this.elements.exportArea) {
            this.elements.exportArea.classList.remove('hidden');
        }
        if (this.elements.exportText) {
            this.elements.exportText.value = text;
        }
    },
    
    hideExportArea() {
        if (this.elements.exportArea) {
            this.elements.exportArea.classList.add('hidden');
        }
    },
    
    showImportArea() {
        if (this.elements.importArea) {
            this.elements.importArea.classList.remove('hidden');
        }
    },
    
    hideImportArea() {
        if (this.elements.importArea) {
            this.elements.importArea.classList.add('hidden');
        }
        if (this.elements.importText) {
            this.elements.importText.value = '';
        }
    }
};