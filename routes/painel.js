const express = require('express');
const router = express.Router();
const painelControlador = require('../controllers/painelControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');

router.get(
    '/',
    autenticarToken,
    verificarPerfil(['gerente', 'funcionario', 'admin']),
    painelControlador.obterEstatisticas
);

module.exports = router;
