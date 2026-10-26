const express = require('express');
const clienteControlador = require('../controllers/clienteControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

const router = express.Router();
const acessoGestor = [autenticarToken, exigirEquipe];

router.get('/', ...acessoGestor, clienteControlador.listarClientes);
router.get('/:id/detalhes', ...acessoGestor, clienteControlador.obterDetalhesCliente);
router.put('/:id', ...acessoGestor, clienteControlador.atualizarCliente);

module.exports = router;
