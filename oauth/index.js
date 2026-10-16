'use strict';

// Interruptor: mientras OAUTH_ENABLED no sea "true" este módulo no carga nada,
// así que puedes desplegar el código sin configurar claves y el backend sigue funcionando igual.
if (process.env.OAUTH_ENABLED !== 'true') {
    console.log('[oauth] Deshabilitado (OAUTH_ENABLED distinto de "true")');
    module.exports = null;
} else {
    module.exports = require('./router');
    console.log('[oauth] Authorization server habilitado');
}
