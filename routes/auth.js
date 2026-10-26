const express = require('express');
const router = express.Router();
const usuarioControlador = require('../controllers/usuarioControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');
const { limitadorLogin, limitadorCadastro } = require('../middlewares/seguranca');
const { GESTAO } = require('../lib/perfis');

router.post('/register', limitadorCadastro, usuarioControlador.cadastrar);
router.post('/login', limitadorLogin, usuarioControlador.autenticar);
router.get('/me', autenticarToken, usuarioControlador.obterSessao);
router.get('/users', autenticarToken, verificarPerfil(GESTAO), usuarioControlador.listarTodos);

module.exports = router;
