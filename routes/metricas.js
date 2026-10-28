const express = require('express');
const metricaControlador = require('../controllers/metricaControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

const router = express.Router();

router.use(autenticarToken, exigirEquipe);

router.get('/resumo', metricaControlador.resumo);
router.get('/buscas', metricaControlador.buscas);
router.get('/produtos-mais-pedidos', metricaControlador.produtosMaisPedidos);
router.get('/clientes-inativos', metricaControlador.clientesInativos);
router.get('/funil', metricaControlador.funil);
router.get('/produtos-vistos', metricaControlador.produtosVistos);
router.get('/banners-campanhas', metricaControlador.bannersCampanhas);
router.get('/pedidos-por-dia', metricaControlador.pedidosPorDia);
router.get('/ciclo-pedido', metricaControlador.cicloPedido);

module.exports = router;
