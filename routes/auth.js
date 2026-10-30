const express = require('express');
const router = express.Router();
const usuarioControlador = require('../controllers/usuarioControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { limitadorLogin, limitadorCadastro } = require('../middlewares/seguranca');

router.post('/register', limitadorCadastro, usuarioControlador.cadastrar);
router.post('/login', limitadorLogin, usuarioControlador.autenticar);
router.get('/me', autenticarToken, usuarioControlador.obterSessao);

module.exports = router;
