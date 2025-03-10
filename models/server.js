const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');

const { dbConnection } = require('../database/config');

class Server {

    constructor() {
        this.app  = express();
        this.port = process.env.PORT;

        this.paths = {
            auth:       '/api/auth',
            buscar:     '/api/buscar',
            categorias: '/api/categorias',
            productos:  '/api/productos',
            usuarios:   '/api/usuarios',
            uploads:    '/api/uploads',
            logs:    '/api/logs',
            leads:    '/api/leads',
            pocs:    '/api/pocs',
            wsp:    '/api/webhooks-wsp',
        }


        // Conectar a base de datos
        this.conectarDB();

        // Middlewares
        this.middlewares();
    }

    async conectarDB() {
        await dbConnection();
    }


    middlewares() {

        // CORS
        this.app.use( cors( {
			origin: [
                    'http://localhost', 'http://localhost:4200',
                    'https://log-api-lwc.herokuapp.com', 'http://log-api-lwc.herokuapp.com', 
                    'http://log-app-production.up.railway.app', 'https://log-app-production.up.railway.app',
                    'https://www.codifacil.club', 'http://www.codifacil.club'
                ]
		} ) );

        // Lectura y parseo del body
        this.app.use( express.json() );

        // Rutas de mi aplicación
        this.routes();

        // Directorio Público
        this.app.use( express.static('public') );

        const path = require('path');
        this.app.get('*', (req, res) => {
            res.sendFile(
                path.resolve(path.join(__dirname, "../"), 'public', 'index.html')
            );
        });

        // Fileupload - Carga de archivos
        this.app.use( fileUpload({
            useTempFiles : true,
            tempFileDir : '/tmp/',
            createParentPath: true
        }));

    }

    routes() {
        
        this.app.use( this.paths.auth, require('../routes/auth'));
        this.app.use( this.paths.buscar, require('../routes/buscar'));
        this.app.use( this.paths.categorias, require('../routes/categorias'));
        this.app.use( this.paths.productos, require('../routes/productos'));
        this.app.use( this.paths.usuarios, require('../routes/usuarios'));
        this.app.use( this.paths.uploads, require('../routes/uploads'));
        this.app.use( this.paths.logs, require('../routes/logs'));
        this.app.use( this.paths.leads, require('../routes/leads'));
        this.app.use( this.paths.pocs, require('../routes/pocs'));
		this.app.use( this.paths.wsp, require('../routes/webhooks-wsp.js'));
    }

    listen() {
        this.app.listen( this.port, () => {
            console.log('Servidor corriendo en puerto', this.port );
        });
    }

}




module.exports = Server;
