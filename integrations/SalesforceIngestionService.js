class SalesforceIngestionService {
    constructor() {
        this.queue = [];
        this.batchSize = process.env.SF_BATCH_SIZE || 10; // Envía cuando junta 10 registros
        this.flushInterval = process.env.SF_FLUSH_INTERVAL || 3600000; // O cada 1 hora si no llega a 10
        this.timer = null;
        
        // Credenciales fijas
        this.client_id = process.env.SF_CLIENT_ID;
        this.client_secret = process.env.SF_CLIENT_SECRET;
        this.tenantUrl = process.env.SF_TENANT_URL || 'https://login.salesforce.com';
        this.apiName = 'LOGS_INGESTION_API';
        this.objectName = 'Logs';

        this.initTimeout();
    }

    // 1. Método para obtener el Token de acceso directamente de Salesforce
    async _getAccessToken() {
        const loginUrl = `${this.tenantUrl}/services/oauth2/token`;
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.client_id,
            client_secret: this.client_secret
        });

        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        if (!response.ok) {
            console.log(`Error obteniendo token: ${response.statusText}`);
            throw new Error(`Error obteniendo token: ${response.statusText}`);
        }

        const data = await response.json();
        return data.access_token;
    }

    // 2. Método público para agregar registros a la cola (Es instantáneo, no bloquea al usuario)
    add(logCodi) {
        // Mapeamos el objeto para que coincida exactamente con el esquema YAML
        const recordLogCodi = {
            idMongo: logCodi._id.toString(),
            title: logCodi.titulo,
            type: logCodi.tipo,
            subType: logCodi.detalleTipo,
            description: logCodi.descripcion,
            solution: logCodi.solucion,
            keyCode: logCodi.codigoClave || ""
        };

        //Verificar si existe el id en el queue sino existe se ahgrega
        const exists = this.queue.some(record => record.idMongo === recordLogCodi.idMongo);
        if (!exists) {
            this.queue.push(recordLogCodi);
        } else {
            //Reemplazar
            this.queue = this.queue.map(record => 
                record.idMongo === recordLogCodi.idMongo 
                    ? recordLogCodi 
                    : record
            );
        }

        // Si alcanzamos el límite del paquete, enviamos de inmediato
        if (this.queue.length >= this.batchSize) {
            this.flush();
        }
    }

    // Temporizador para enviar datos por tiempo acumulado
    initTimeout() {
        this.timer = setInterval(() => {
            if (this.queue.length > 0) {
                this.flush();
            }
        }, this.flushInterval);
    }

    // 3. El método que procesa y vacía la cola enviando la data por HTTP POST
    async flush() {
        // Extraemos los registros actuales de la cola para liberar memoria de inmediato
        const recordsToSend = this.queue.splice(0, this.batchSize);
        
        try {
            const token = await this._getAccessToken();
            const endpoint = `${this.tenantUrl}/api/v1/ingest/sources/${this.apiName}/${this.objectName}`;

            const payload = { data: recordsToSend };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Salesforce Error ${response.status}]:`, errorText);
            } else {
                console.log(`[Salesforce Success]: Sent ${recordsToSend.length} records correctly.`);
            }

        } catch (error) {
            console.error('[Salesforce Connection Error]: No se pudo procesar el lote.', error);
        }
    }
}

// Exportamos una única instancia (Singleton) 
// para mantener la cola centralizada

module.exports = new SalesforceIngestionService();