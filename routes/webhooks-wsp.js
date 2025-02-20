
const { Router } = require('express');
const { check } = require('express-validator');

const {
    validarCampos,
    validarJWT,
    esAdminRole
} = require('../middlewares');

const { wspGet,
        wspPost, } = require('../controllers/webhooks-wsp');

const router = Router();

router.get('/', [
], wspGet );

router.post('/',[
], wspPost );


module.exports = router;