const express = require('express');
const campanhaControlador = require('../controllers/campanhaControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { autenticacaoOpcional } = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

const router = express.Router();
const equipe = [autenticarToken, exigirEquipe];

// Público (antes de "/:id"): quem estiver logado vê o estoque exato dos produtos, como na vitrine.
router.get('/ativas', autenticacaoOpcional, campanhaControlador.listarAtivas);

router.get('/', ...equipe, campanhaControlador.listar);
router.post('/', ...equipe, campanhaControlador.criar);
router.get('/:id', ...equipe, campanhaControlador.obter);
router.patch('/:id', ...equipe, campanhaControlador.atualizar);
router.delete('/:id', ...equipe, campanhaControlador.excluir);

module.exports = router;
