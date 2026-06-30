const { generateAssertion } = require('./generateAssertion');

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
        this.ingestionApiUrl = process.env.SF_INGESTION_API_URL;
        this.apiName = 'LOGS_INGESTION_API';
        this.objectName = 'Logs';

        this.initTimeout();
    }

    //Ejemplo de Obtener Token de SF con client id y client secret
    async _getAccessToken() {
        const loginSFUrl = `${this.tenantUrl}/services/oauth2/token`;
        const assertionStr = this._buildJwtAssertion();
        const paramsSF = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.client_id,
            client_secret: this.client_secret
        });

        const responseSF = await fetch(loginSFUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: paramsSF
        });

        if (!responseSF.ok) {
            console.log(`Error obteniendo token: ${responseSF.statusText}`);
            throw new Error(`Error obteniendo token: ${responseSF.statusText}`);
        }

        const dataSF = await responseSF.json();
        console.log(dataSF);
        return dataSF.access_token;
    }

    // Generación de assertion JWT firmado con RS256
    _buildJwtAssertion() {
        const privateKeyPEM = Buffer.from(process.env.SF_JWT_PRIVATE_KEY, 'base64').toString('utf-8');
        return generateAssertion({
            iss: this.client_id,
            sub: process.env.USER_INTEGRATION,
            aud: `${this.tenantUrl}`,
            expiresIn: '3m',
            privateKey: privateKeyPEM 
        });
    }

    // 1. Método para obtener el Token de acceso directamente de Salesforce con JWT y luego obtener el token de Data 360
    async _getAccessTokenDataCloud() {
        const loginSFUrl = `${this.tenantUrl}/services/oauth2/token`;
        const assertionStr = this._buildJwtAssertion();
        const paramsSF = new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: assertionStr
        });

        const responseSF = await fetch(loginSFUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: paramsSF
        });

        if (!responseSF.ok) {
            console.log(`Error obteniendo token: ${responseSF.statusText}`);
            throw new Error(`Error obteniendo token: ${responseSF.statusText}`);
        }

        const dataSF = await responseSF.json();
        const accessTokenSF = dataSF.access_token;

        const loginA360Url = `${this.tenantUrl}/services/a360/token`;
        const paramsA360SF = new URLSearchParams({
            grant_type: 'urn:salesforce:grant-type:external:cdp',
            subject_token: accessTokenSF,
            subject_token_type: 'urn:ietf:params:oauth:token-type:access_token'
        });

        const responseA360 = await fetch(loginA360Url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: paramsA360SF
        });

        if (!responseSF.ok) {
            console.log(`Error obteniendo token de Data 360: ${responseA360.statusText}`);
            throw new Error(`Error obteniendo token: ${responseA360.statusText}`);
        }

        const dataA360 = await responseA360.json();
        console.log(dataA360);
        return dataA360.access_token;
    }

    // 2. Método público para agregar registros a la cola (Es instantáneo, no bloquea al usuario)
    add(logCodi) {
        // Mapeamos el objeto para que coincida exactamente con el esquema YAML
        const recordLogCodi = {
            idMongo: logCodi._id,
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
            const token = await this._getAccessTokenDataCloud();
            const endpoint = `${this.ingestionApiUrl}/api/v1/ingest/sources/${this.apiName}/${this.objectName}`;

            const payload = { data: recordsToSend };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const responseRaw = await response.text();

            console.log(`[Salesforce Response ${response.status}]:`, response.statusText);    

            if (!response.status.toString().startsWith('2')) {
                console.error(`[Salesforce Error]: Failed to send ${recordsToSend.length} records. Response:`, responseRaw);
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