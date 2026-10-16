const { response, request } = require('express');
const jwt = require('jsonwebtoken');

const Usuario = require('../models/usuario');

// Rutas donde se aceptan los tokens intercambiados que emite el MCP (mínimo privilegio):
// con ellos NO se puede llamar a /api/usuarios, /api/uploads, etc.
const EXCHANGE_PATHS = (process.env.OAUTH_EXCHANGE_ALLOWED_PATHS || '/api/logs')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

const validarJWT = async( req = request, res = response, next ) => {

    const token = req.header('x-token');

    if ( !token ) {
        return res.status(401).json({
            msg: 'No hay token en la petición'
        });
    }

    try {

        let uid;
        const decoded = jwt.decode( token, { complete: true } );

        if ( decoded && decoded.header && decoded.header.alg === 'ES256' ) {
            // Token intercambiado emitido por el authorization server para el MCP:
            // lleva la identidad del usuario que autorizó el MCP.
            const path = req.originalUrl.split('?')[0];
            if ( !EXCHANGE_PATHS.some( (p) => path === p || path.startsWith( p + '/' ) ) ) {
                return res.status(403).json({
                    msg: 'Token no autorizado para esta ruta'
                });
            }
            const { verifyExchangedToken } = require('../oauth/exchange');
            uid = verifyExchangedToken( token ).sub;
        } else {
            // Token de sesión de siempre (login tradicional). Se fija el algoritmo explícitamente.
            ({ uid } = jwt.verify( token, process.env.SECRETORPRIVATEKEY, { algorithms: ['HS256'] } ));
        }

        // leer el usuario que corresponde al uid
        const usuario = await Usuario.findById( uid );

        if( !usuario ) {
            return res.status(401).json({
                msg: 'Token no válido - usuario no existe DB'
            })
        }

        // Verificar si el uid tiene estado true
        if ( !usuario.estado ) {
            return res.status(401).json({
                msg: 'Token no válido - usuario con estado: false'
            })
        }

        req.usuario = usuario;
        next();

    } catch (error) {

        console.log(error);
        res.status(401).json({
            msg: 'Token no válido'
        })
    }

}

module.exports = {
    validarJWT
}
