const express = require('express');
const router = express.Router();
const cmsControlador = require('../controllers/cmsControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');
const { receberImagem, verificarConteudoImagem } = require('../middlewares/uploadImagem');

router.get('/', cmsControlador.listarBanners);
router.post(
    '/',
    autenticarToken,
    exigirEquipe,
    receberImagem,
    verificarConteudoImagem,
    cmsControlador.salvarBanner
);

module.exports = router;
