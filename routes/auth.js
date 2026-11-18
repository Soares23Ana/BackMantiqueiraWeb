const express = require('express');
const router = express.Router();
const usuarioControlador = require('../controllers/usuarioControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { limitadorLogin, limitadorCadastro, limitadorRedefinicaoPublica, limitadorSolicitacaoRedefinicao } = require('../middlewares/seguranca');
const redefinicaoSenhaControlador = require('../controllers/redefinicaoSenhaControlador');

router.post('/register', limitadorCadastro, usuarioControlador.cadastrar);
router.post('/login', limitadorLogin, usuarioControlador.autenticar);
router.post('/solicitar-redefinicao', limitadorSolicitacaoRedefinicao, redefinicaoSenhaControlador.solicitar);
router.post('/redefinir-senha/validar', limitadorRedefinicaoPublica, redefinicaoSenhaControlador.validar);
router.post('/redefinir-senha', limitadorRedefinicaoPublica, redefinicaoSenhaControlador.redefinir);
router.get('/me', autenticarToken, usuarioControlador.obterSessao);

module.exports = router;
