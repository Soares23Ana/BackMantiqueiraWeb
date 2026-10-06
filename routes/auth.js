const express = require('express');
const router = express.Router();
const usuarioControlador = require('../controllers/usuarioControlador');
const {
    regrasCadastro,
    validarRequisicao
} = require('../helpers/validacaoUsuario');
const autenticarToken = require('../middlewares/authMiddleware');
const { limitadorLogin } = require('../middlewares/seguranca');

router.post('/register', regrasCadastro(), validarRequisicao, usuarioControlador.cadastrar);
router.post('/login', limitadorLogin, usuarioControlador.autenticar);
router.get('/users', autenticarToken, usuarioControlador.listarTodos);

module.exports = router;