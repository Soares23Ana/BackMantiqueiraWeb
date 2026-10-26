const express = require('express');
const router = express.Router();
const usuarioControlador = require('../controllers/usuarioControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirGestaoDeEquipe } = require('../middlewares/roleMiddleware');
const { limitadorLogin, limitadorCadastro } = require('../middlewares/seguranca');

router.post('/register', limitadorCadastro, usuarioControlador.cadastrar);
router.post('/login', limitadorLogin, usuarioControlador.autenticar);
router.get('/me', autenticarToken, usuarioControlador.obterSessao);
// Lista antiga de usuários: mesma permissão de GET /admin/usuarios.
router.get('/users', autenticarToken, exigirGestaoDeEquipe, usuarioControlador.listarTodos);

module.exports = router;
