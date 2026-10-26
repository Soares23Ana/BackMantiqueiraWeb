const express = require('express');
const minhaContaControlador = require('../controllers/minhaContaControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');

const router = express.Router();
const somenteCliente = verificarPerfil(['cliente']);

router.use(autenticarToken);

router.get('/', minhaContaControlador.obter);
router.patch('/', minhaContaControlador.atualizar);
router.patch('/senha', minhaContaControlador.trocarSenha);

// Endereços de entrega são do cliente.
router.get('/enderecos', somenteCliente, minhaContaControlador.listarEnderecos);
router.post('/enderecos', somenteCliente, minhaContaControlador.adicionarEndereco);
router.patch('/enderecos/:id_endereco', somenteCliente, minhaContaControlador.atualizarEndereco);
router.delete('/enderecos/:id_endereco', somenteCliente, minhaContaControlador.removerEndereco);

module.exports = router;
