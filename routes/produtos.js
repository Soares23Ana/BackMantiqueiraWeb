const express = require('express');
const router = express.Router();
const produtoControlador = require('../controllers/produtoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { autenticacaoOpcional } = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');
const { receberImagem, verificarConteudoImagem } = require('../middlewares/uploadImagem');

const gestao = [autenticarToken, exigirEquipe];

// Públicas: quem estiver logado vê mais detalhes (estoque exato; equipe vê preço e inativos). Escrita: equipe.
router.get('/', autenticacaoOpcional, produtoControlador.listar);
router.get('/sugestoes', autenticacaoOpcional, produtoControlador.sugestoes);
router.get('/filtros', autenticacaoOpcional, produtoControlador.filtrosDisponiveis);
router.get('/:id', autenticacaoOpcional, produtoControlador.obter);

router.post('/', ...gestao, produtoControlador.cadastrar);
router.put('/:id', ...gestao, produtoControlador.atualizarCompleto);
router.patch('/:id', ...gestao, produtoControlador.atualizarParcial);
router.delete('/:id', ...gestao, produtoControlador.desativar);
router.post('/:id/imagem', ...gestao, receberImagem, verificarConteudoImagem, produtoControlador.enviarImagem);

router.patch('/:id/estoque', ...gestao, produtoControlador.ajustarEstoque);
router.get('/:id/movimentacoes', ...gestao, produtoControlador.listarMovimentacoes);

module.exports = router;
