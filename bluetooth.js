// Bluetooth-модуль для PocketNet
const BLUETOOTH = {
    SERVICE_UUID: '12345678-1234-1234-1234-123456789abc',
    CHARACTERISTIC_UUID: 'abcdef01-1234-1234-1234-123456789abc',
    
    device: null,
    server: null,
    characteristic: null,
    
    isSupported() {
        return 'bluetooth' in navigator;
    },
    
    async sendData(data, onProgress, onStatus) {
        try {
            onStatus('🔍 Поиск устройства...');
            
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.SERVICE_UUID] }]
            });
            
            onStatus('🔗 Подключение...');
            this.server = await this.device.gatt.connect();
            
            const service = await this.server.getPrimaryService(this.SERVICE_UUID);
            this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);
            
            onStatus('📡 Ожидание готовности получателя...');
            
            // Ждём сигнал READY от получателя
            await this.characteristic.startNotifications();
            const readyPromise = new Promise((resolve) => {
                this.characteristic.addEventListener('characteristicvaluechanged', function handler(event) {
                    const value = new TextDecoder().decode(event.target.value);
                    if (value === 'READY') {
                        this.removeEventListener('characteristicvaluechanged', handler);
                        resolve();
                    }
                });
            });
            
            await readyPromise;
            
            onStatus('📤 Передача данных...');
            
            // Разбиваем данные на чанки (BLE ограничение ~512 байт)
            const chunkSize = 400;
            const totalChunks = Math.ceil(data.length / chunkSize);
            
            for (let i = 0; i < totalChunks; i++) {
                const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
                await this.characteristic.writeValue(new TextEncoder().encode(chunk));
                if (onProgress) onProgress((i + 1) / totalChunks * 100);
            }
            
            onStatus('✅ Передача завершена!');
            return true;
            
        } catch(e) {
            onStatus('❌ Ошибка: ' + e.message);
            return false;
        } finally {
            this.disconnect();
        }
    },
    
    async receiveData(onProgress, onStatus) {
        try {
            onStatus('🔍 Создание сервера...');
            
            // Создаём сервер для приёма
            const service = {
                uuid: this.SERVICE_UUID,
                characteristics: [{
                    uuid: this.CHARACTERISTIC_UUID,
                    properties: ['write', 'notify'],
                    onWrite: (event) => {
                        const value = event.target.value;
                        const chunk = new TextDecoder().decode(value);
                        this._receivedChunks.push(chunk);
                        if (onProgress) onProgress(this._receivedChunks.length * 5);
                    }
                }]
            };
            
            this._receivedChunks = [];
            
            const server = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.SERVICE_UUID] }],
                acceptAllDevices: false
            });
            
            onStatus('🔗 Ожидание подключения отправителя...');
            
            // Ждём данные
            const result = await new Promise((resolve, reject) => {
                let timeout = setTimeout(() => reject(new Error('Таймаут ожидания')), 30000);
                const checkComplete = setInterval(() => {
                    if (this._receivedChunks.length > 0) {
                        clearTimeout(timeout);
                        clearInterval(checkComplete);
                        resolve(this._receivedChunks.join(''));
                    }
                }, 500);
            });
            
            onStatus('✅ Данные получены!');
            return result;
            
        } catch(e) {
            onStatus('❌ Ошибка: ' + e.message);
            return null;
        }
    },
    
    disconnect() {
        if (this.characteristic) this.characteristic = null;
        if (this.server) {
            this.server.disconnect();
            this.server = null;
        }
        this.device = null;
    }
};