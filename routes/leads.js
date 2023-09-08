
const { Router } = require('express');
const { check } = require('express-validator');

const {
    validarCampos,
    validarJWT,
    esAdminRole,
    tieneRole
} = require('../middlewares');


const { esRoleValido, emailExiste, existeUsuarioPorId } = require('../helpers/db-validators');

const { leadsGet,
        leadsPut,
        leadsPost,
        leadsDelete,
        leadsPatch } = require('../controllers/leads');

const router = Router();


router.get('/', [
    validarJWT,
    esAdminRole
], leadsGet );

router.put('/:id',[
    validarJWT,
    check('id', 'No es un ID válido').isMongoId(),
    validarCampos
], leadsPut );

router.post('/',[
    check('name', 'El nombre es obligatorio').not().isEmpty(),
    check('email', 'El correo no es válido').isEmail(),
    validarCampos
], leadsPost );

router.delete('/:id',[
    validarJWT,
    esAdminRole,
    check('id', 'No es un ID válido').isMongoId(),
    validarCampos
], leadsDelete );

router.patch('/', leadsPatch );


module.exports = router;