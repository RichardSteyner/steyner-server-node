const { response, request } = require('express');
const say = require('say');
const recorder = require('node-record-lpcm16');

const fs = require('fs');
const path = require('path');

const pocsGetWithRecording = async(req = request, res = response) => {
    try{

        const msg = 'OK'
        const fileName = 'audio.wav';
        const { text = '' } = req.query;

        // Redirigir la salida de la consola a un archivo
        const file = fs.createWriteStream(path.join(__dirname, fileName), { encoding: 'binary' });
        const recording = recorder.record(
            {
                recorder: 'sox'
            }
        );
        recording.stream()
            .pipe(file);

        console.log('Empieza a grabar')

        //Reproducir el sonido
        //say.speak(text);
        say.speak(text, null, 1.0, (err) => {
            if (err) {
                console.error('Error en speak', err);
                return res.status(500).json(err);
            }
            console.log('Text has been spoken.');
            setTimeout(()=> {
                recording.stop();
                console.log('Recording STOP.');
                file.end();
                console.log('FILE END.');
            }, 2000)
            
          }
        );
        console.log('res');
        res.json({
            msg
        });
    } catch(err) {
        console.error('Error en catch', err);
        res.status(500).json(err);
    }
}

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