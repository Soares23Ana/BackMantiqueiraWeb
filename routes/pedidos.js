const express = require('express');
const router = express.Router();
const pedidoControlador = require('../controllers/pedidoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');

router.post(
    '/',
    autenticarToken,
    verificarPerfil(['cliente']),
    pedidoControlador.criarPedido
);
router.get(
    '/',
    autenticarToken,
    verificarPerfil(['gerente', 'funcionario', 'admin']),
    pedidoControlador.listarPedidos
);
router.get('/:id_pedido', autenticarToken, pedidoControlador.obterPedido);
router.put(
    '/:id_pedido/status',
    autenticarToken,
    verificarPerfil(['gerente', 'admin']),
    pedidoControlador.atualizarStatus
);
router.patch(
    '/:id_pedido/status',
    autenticarToken,
    verificarPerfil(['gerente', 'admin']),
    pedidoControlador.atualizarStatus
);

module.exports = router;
