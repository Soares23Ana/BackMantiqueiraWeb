const express = require('express');
const router = express.Router();
const pedidoControlador = require('../controllers/pedidoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');
const { EQUIPE, GESTAO } = require('../lib/perfis');

router.use(autenticarToken);

router.post('/', verificarPerfil(['cliente']), pedidoControlador.criarPedido);
router.get('/', verificarPerfil(EQUIPE), pedidoControlador.listarPedidos);
// Deve vir antes de "/:id_pedido" para "meus" não ser lido como id.
router.get('/meus', verificarPerfil(['cliente']), pedidoControlador.listarMeusPedidos);
// Equipe vê qualquer pedido; cliente só o próprio (a checagem de dono fica no controlador).
router.get('/:id_pedido', verificarPerfil([...EQUIPE, 'cliente']), pedidoControlador.obterPedido);
router.put('/:id_pedido/status', verificarPerfil(GESTAO), pedidoControlador.atualizarStatus);
router.patch('/:id_pedido/status', verificarPerfil(GESTAO), pedidoControlador.atualizarStatus);
router.post('/:id_pedido/cancelar', verificarPerfil([...GESTAO, 'cliente']), pedidoControlador.cancelarPedido);

module.exports = router;
