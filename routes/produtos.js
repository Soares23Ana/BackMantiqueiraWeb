const express = require('express');
const router = express.Router();
const produtoControlador = require('../controllers/produtoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { autenticacaoOpcional } = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');
const { receberImagem, verificarConteudoImagem } = require('../middlewares/uploadImagem');
const { EQUIPE, GESTAO } = require('../lib/perfis');

const gestao = [autenticarToken, verificarPerfil(GESTAO)];

// Públicas: quem estiver logado vê mais detalhes (estoque exato; equipe vê preço e inativos).
router.get('/', autenticacaoOpcional, produtoControlador.listar);
router.get('/sugestoes', autenticacaoOpcional, produtoControlador.sugestoes);
router.get('/filtros', autenticacaoOpcional, produtoControlador.filtrosDisponiveis);
router.get('/:id', autenticacaoOpcional, produtoControlador.obter);

router.post('/', ...gestao, produtoControlador.cadastrar);
router.put('/:id', ...gestao, produtoControlador.atualizarCompleto);
router.patch('/:id', ...gestao, produtoControlador.atualizarParcial);
router.delete('/:id', ...gestao, produtoControlador.desativar);
router.post('/:id/imagem', ...gestao, receberImagem, verificarConteudoImagem, produtoControlador.enviarImagem);

// Ajuste de estoque e histórico: toda a equipe (inclui o estoquista/funcionário).
router.patch('/:id/estoque', autenticarToken, verificarPerfil(EQUIPE), produtoControlador.ajustarEstoque);
router.get('/:id/movimentacoes', autenticarToken, verificarPerfil(EQUIPE), produtoControlador.listarMovimentacoes);

module.exports = router;
