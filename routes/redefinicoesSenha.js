const express = require('express');
const controlador = require('../controllers/pedidosRedefinicaoSenhaControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');
const { limitadorRedefinicaoGerar } = require('../middlewares/seguranca');

const router = express.Router();

// Pedidos de nova senha feitos pelos clientes: mesma autorização de "gerar link por cliente" (equipe).
router.use(autenticarToken, exigirEquipe);

router.get('/pedidos', controlador.listar);
router.post('/pedidos/:id/enviar-link', limitadorRedefinicaoGerar, controlador.enviarLink);
router.post('/pedidos/:id/dispensar', controlador.dispensar);

module.exports = router;
