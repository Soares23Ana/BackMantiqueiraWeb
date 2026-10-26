const express = require('express');
const adminUsuarioControlador = require('../controllers/adminUsuarioControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');

const router = express.Router();

// Todas as rotas /admin são exclusivas do perfil admin.
router.use(autenticarToken, verificarPerfil(['admin']));

router.get('/usuarios', adminUsuarioControlador.listar);
router.post('/usuarios', adminUsuarioControlador.criar);
router.patch('/usuarios/:id', adminUsuarioControlador.atualizar);

module.exports = router;
