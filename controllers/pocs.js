const { response, request } = require('express');
const say = require('say');

const fs = require('fs');

const pocsGet = async(req = request, res = response) => {
    try{
        const fileName = 'audio.wav';
        const { text = '', returnMode = 'base64' } = req.query;

        //Reproducir el sonido
        //say.speak(text);
        //Exportar
        say.export(text, null, 1, fileName, (err) => {
            if (err) {
                console.error('Error en speak', err);
                return res.status(500).json(err);
            }
            console.log('Text has been saved.');

            if(returnMode === 'file') {
                res.setHeader('Content-Type', fileName);
                res.setHeader('Content-Disposition', 'attachment; filename=' + fileName);
                fs.createReadStream(fileName).pipe(res);
            } else {
                res.setHeader('Content-Type', 'application/json');
                const audioBuffer = fs.readFileSync(fileName);
                const base64File = audioBuffer.toString('base64');
                res.json({
                    base64File
                });
            }
        });
    } catch(err) {
        console.error('Error en catch', err);
        res.status(500).json(err);
    }
}

const pocsPost = async(req, res = response) => {
    try{
        
        res.json({
            
        });
    } catch(err) {
        console.log(err);
        res.status(500).json(err);
    }
}

module.exports = {
    pocsGet,
    pocsPost,
}