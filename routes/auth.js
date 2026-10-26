const express = require('express');
const router = express.Router();
const usuarioControlador = require('../controllers/usuarioControlador');
const {
    regrasCadastro,
    validarRequisicao
} = require('../helpers/validacaoUsuario');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');
const { limitadorLogin } = require('../middlewares/seguranca');

router.post('/register', regrasCadastro(), validarRequisicao, usuarioControlador.cadastrar);
router.post('/login', limitadorLogin, usuarioControlador.autenticar);
router.get('/me', autenticarToken, usuarioControlador.obterSessao);
router.get('/users', autenticarToken, verificarPerfil(['gerente', 'admin']), usuarioControlador.listarTodos);

module.exports = router;