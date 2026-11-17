const express = require('express');
const adminUsuarioControlador = require('../controllers/adminUsuarioControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe, exigirGestaoDeEquipe } = require('../middlewares/roleMiddleware');
const { executarAgora } = require('../jobs');
const { limitadorRedefinicaoGerar } = require('../middlewares/seguranca');
const redefinicaoSenhaControlador = require('../controllers/redefinicaoSenhaControlador');

const router = express.Router();

// POST /admin/jobs/:nome/executar (equipe): roda o job agora, respeitando a trava do MySQL, e devolve o relatório.
router.post('/jobs/:nome/executar', autenticarToken, exigirEquipe, async (req, res) => {
    const relatorio = await executarAgora(req.params.nome);
    return res.status(200).json({ mensagem: 'Job executado.', ...relatorio });
});

// Gestão de usuários: só equipe com pode_gerenciar_equipe.
router.use(autenticarToken, exigirGestaoDeEquipe);

router.get('/usuarios', adminUsuarioControlador.listar);
router.post('/usuarios', adminUsuarioControlador.criar);
router.patch('/usuarios/:id', adminUsuarioControlador.atualizar);
router.post('/usuarios/:id/redefinicao-senha', limitadorRedefinicaoGerar, redefinicaoSenhaControlador.gerarParaEquipe);

module.exports = router;
