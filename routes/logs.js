const { Router } = require('express');
const { check } = require('express-validator');

const { validarJWT, validarCampos, esAdminRole } = require('../middlewares');

const { crearLog,
        obtenerLogs,
        obtenerLog,
        actualizarLog, 
        borrarLog } = require('../controllers/logs');
const { existeLogPorId } = require('../helpers/db-validators');

const router = Router();

/**
 * {{url}}/api/logs
 */

//  Obtener todas los logs - publico
router.get('/', obtenerLogs );

// Obtener una log por id - publico
router.get('/:id',[
    check('id', 'No es un id de Mongo válido').isMongoId(),
    check('id').custom( existeLogPorId ),
    validarCampos,
], obtenerLog );

// Crear log - privado - cualquier persona con un token válido
router.post('/', [ 
    validarJWT,
    check('titulo','El titulo es obligatorio').not().isEmpty(),
    check('tipo','El tipo es obligatorio').not().isEmpty(),
    check('detalleTipo','El detalle tipo es obligatorio').not().isEmpty(),
    check('descripcion','La descripcion es obligatoria').not().isEmpty(),
    check('solucion','La solucion es obligatoria').not().isEmpty(),
    validarCampos
], crearLog );

// Actualizar log - privado - cualquiera con token válido
router.put('/:id',[
    validarJWT,
    check('titulo','El titulo es obligatorio').not().isEmpty(),
    check('tipo','El tipo es obligatorio').not().isEmpty(),
    check('detalleTipo','El detalle tipo es obligatorio').not().isEmpty(),
    check('descripcion','La descripcion es obligatoria').not().isEmpty(),
    check('solucion','La solucion es obligatoria').not().isEmpty(),
    check('id').custom( existeLogPorId ),
    validarCampos
],actualizarLog );

// Borrar un log - Admin
router.delete('/:id',[
    validarJWT,
    esAdminRole,
    check('id', 'No es un id de Mongo válido').isMongoId(),
    check('id').custom( existeLogPorId ),
    validarCampos,
],borrarLog);



module.exports = router;