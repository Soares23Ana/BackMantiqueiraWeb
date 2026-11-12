const express = require('express');
const suporteControlador = require('../controllers/suporteControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

const router = express.Router();
router.get('/', autenticarToken, exigirEquipe, suporteControlador.listarAuditoria);

module.exports = router;
