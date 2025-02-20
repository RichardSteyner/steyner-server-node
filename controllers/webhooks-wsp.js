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

        res.json({
            body: JSON.stringify(body)       
        });
    } catch(err) {
        console.log(err);
        res.status(500).json(err);
    }
}

module.exports = {
    wspGet,
    wspPost,
}