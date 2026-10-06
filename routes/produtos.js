const express = require('express');
const router = express.Router();
const produtoControlador = require('../controllers/produtoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');

router.get('/', autenticarToken, produtoControlador.listarTodos);
router.post(
    '/',
    autenticarToken,
    verificarPerfil(['admin', 'gerente']),
    produtoControlador.cadastrar
);

module.exports = router;