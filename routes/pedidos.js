const express = require('express');
const router = express.Router();
const pedidoControlador = require('../controllers/pedidoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');

router.use(autenticarToken);

router.post('/', verificarPerfil(['cliente']), pedidoControlador.criarPedido);
router.get('/', verificarPerfil(['equipe']), pedidoControlador.listarPedidos);
// Deve vir antes de "/:id_pedido" para "meus" não ser lido como id.
router.get('/meus', verificarPerfil(['cliente']), pedidoControlador.listarMeusPedidos);
// Equipe vê qualquer pedido; cliente só o próprio (a checagem de dono fica no controlador).
router.get('/:id_pedido', verificarPerfil(['equipe', 'cliente']), pedidoControlador.obterPedido);
router.get('/:id_pedido/repetir', verificarPerfil(['cliente']), pedidoControlador.repetirPedido);
router.put('/:id_pedido/status', verificarPerfil(['equipe']), pedidoControlador.atualizarStatus);
router.patch('/:id_pedido/status', verificarPerfil(['equipe']), pedidoControlador.atualizarStatus);
router.post('/:id_pedido/cancelar', verificarPerfil(['equipe', 'cliente']), pedidoControlador.cancelarPedido);

module.exports = router;
