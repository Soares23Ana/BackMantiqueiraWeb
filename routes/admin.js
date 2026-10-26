const express = require('express');
const adminUsuarioControlador = require('../controllers/adminUsuarioControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirGestaoDeEquipe } = require('../middlewares/roleMiddleware');

const router = express.Router();

// Gestão de usuários: só equipe com pode_gerenciar_equipe.
router.use(autenticarToken, exigirGestaoDeEquipe);

router.get('/usuarios', adminUsuarioControlador.listar);
router.post('/usuarios', adminUsuarioControlador.criar);
router.patch('/usuarios/:id', adminUsuarioControlador.atualizar);

module.exports = router;
