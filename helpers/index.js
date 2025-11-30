

const dbValidators = require('./db-validators');
const generarJWT   = require('./generar-jwt');
const googleVerify = require('./google-verify');
const subirArchivo = require('./subir-archivo');
const uploadService = require('./upload-service');


module.exports = {
    ...dbValidators,
    ...generarJWT,
    ...googleVerify,
    ...subirArchivo,
	uploadService
}