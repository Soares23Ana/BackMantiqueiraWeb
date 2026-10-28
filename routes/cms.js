const express = require('express');
const router = express.Router();
const cmsControlador = require('../controllers/cmsControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { autenticacaoOpcional } = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');
const { receberImagem, verificarConteudoImagem } = require('../middlewares/uploadImagem');

const equipe = [autenticarToken, exigirEquipe];
const comImagem = [receberImagem, verificarConteudoImagem];

// Banners
router.get('/', cmsControlador.listarBanners);
router.get('/todos', ...equipe, cmsControlador.listarTodosBanners);
router.put('/ordem', ...equipe, cmsControlador.reordenarBanners);
router.post('/', ...equipe, ...comImagem, cmsControlador.salvarBanner);

// Blocos de conteúdo (antes de "/:id")
router.get('/blocos', autenticacaoOpcional, cmsControlador.listarBlocos);
router.get('/blocos/:chave', autenticacaoOpcional, cmsControlador.obterBloco);
router.put('/blocos/:chave', ...equipe, cmsControlador.salvarBloco);
router.patch('/blocos/:chave', ...equipe, cmsControlador.alterarAtivoBloco);
router.delete('/blocos/:chave', ...equipe, cmsControlador.excluirBloco);

router.patch('/:id', ...equipe, ...comImagem, cmsControlador.atualizarBanner);
router.delete('/:id', ...equipe, cmsControlador.excluirBanner);

module.exports = router;
