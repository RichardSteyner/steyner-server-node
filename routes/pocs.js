
const { Router } = require('express');
const { check } = require('express-validator');

const {
    validarCampos,
    validarJWT,
    esAdminRole
} = require('../middlewares');

const { pocsGet,
        pocsPost, } = require('../controllers/pocs');

const router = Router();

router.get('/', [
], pocsGet );

router.post('/',[
], pocsPost );


module.exports = router;