const { response, request } = require('express');


const wspGet = async(req = request, res = response) => {
    try{
        
        const mode = req.query['hub.mode'];
		const token = req.query['hub.verify_token'];
		const challenge = req.query['hub.challenge'];
		console.log('mode', mode);
		console.log('token', token);
		console.log('challenge', challenge);

		// Verifica si el token es válido
		if (mode && token === 'steyner') {
			console.log('Webhook verificado');
			return res.status(200).send(challenge);
		} else {
			console.error('Verificación fallida');
			return res.sendStatus(403);
		}
    } catch(err) {
        console.error('Error en catch', err);
        res.status(500).json(err);
    }
}

const wspPost = async(req, res = response) => {
    try{
        const body = req.body;

        // IMPORTANTE: Responde 200 OK de inmediato a Meta para evitar reenvíos
        res.status(200).send('EVENT_RECEIVED');

		console.log('body', body);
		console.log('body string', JSON.stringify(body));

        // Estructura del JSON de Meta para verificar que es un mensaje de WhatsApp
        if (body.object === 'whatsapp_business_account') {
            const entry = body.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            // Comprobamos si el evento contiene un mensaje nuevo
            if (value?.messages?.[0]) {
                const message = value.messages[0];
                const fromNumber = message.from; // Teléfono de la persona que te escribió
                
                // Verificamos si el mensaje es de tipo texto
                if (message.type === 'text') {
                    const messageText = message.text.body; // El texto que escribió el usuario
                    
                    console.log(`[WhatsApp] Mensaje de ${fromNumber}: "${messageText}"`);

                    // PROCESAR RESPUESTA: Aquí creas la lógica de tu bot
                    let respuestaBot = `Recibí tu mensaje que dice: "${messageText}". Soy un agente en desarrollo.`;

                    // LLAMAMOS A LA FUNCIÓN PARA ENVIAR LA RESPUESTA
                    await enviarMensajeWhatsApp(fromNumber, respuestaBot);
                }
            }
        }
    } catch(err) {
        console.log(err);
        res.status(500).json(err);
    }
}

//FUNCIÓN POST SALIENTE: Aquí usamos el Phone Number ID y el Access Token
async function enviarMensajeWhatsApp(toRealNumber, textResponse) {
    const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
    const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;

    const url = `https://facebook.com${WA_PHONE_NUMBER_ID}/messages`;
    
    const data = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toRealNumber, // Número del usuario que capturamos en el webhook
        type: "text",
        text: {
            preview_url: false,
            body: textResponse // El texto de respuesta
        }
    };

    const config = {
        headers: {
            'Authorization': `Bearer ${WA_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        }
    };

    try {
        const response = await axios.post(url, data, config);
        console.log(`[Meta API] Respuesta enviada con éxito al número ${toRealNumber}`);
    } catch (error) {
        console.error("[Meta API] Error al enviar el mensaje:", error.response?.data || error.message);
    }
}

module.exports = {
    wspGet,
    wspPost,
}