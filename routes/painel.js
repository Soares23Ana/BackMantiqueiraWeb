const express = require('express');
const router = express.Router();
const painelControlador = require('../controllers/painelControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

router.get(
    '/alertas-reposicao',
    autenticarToken,
    exigirEquipe,
    painelControlador.obterAlertasReposicao
);
router.get(
    '/contadores',
    autenticarToken,
    exigirEquipe,
    painelControlador.obterContadores
);
router.get(
    '/',
    autenticarToken,
    exigirEquipe,
    painelControlador.obterEstatisticas
);

module.exports = router;
