const express = require('express');
const clienteControlador = require('../controllers/clienteControlador');
const suporteControlador = require('../controllers/suporteControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');
const { limitadorRedefinicaoGerar } = require('../middlewares/seguranca');
const redefinicaoSenhaControlador = require('../controllers/redefinicaoSenhaControlador');

const router = express.Router();
const acessoGestor = [autenticarToken, exigirEquipe];

router.get('/', ...acessoGestor, clienteControlador.listarClientes);
router.get('/redefinicoes-pendentes', ...acessoGestor, redefinicaoSenhaControlador.listarPendentes);
router.get('/:id/detalhes', ...acessoGestor, clienteControlador.obterDetalhesCliente);
router.get('/:id/historico', ...acessoGestor, clienteControlador.obterHistoricoCliente);
router.get('/:id/notas', ...acessoGestor, suporteControlador.listarNotas);
router.post('/:id/notas', ...acessoGestor, suporteControlador.criarNota);
router.delete('/:id/notas/:id_nota', ...acessoGestor, suporteControlador.excluirNota);
router.put('/:id', ...acessoGestor, clienteControlador.atualizarCliente);
router.put('/:id/senha', ...acessoGestor, clienteControlador.definirSenhaTemporaria);
router.post('/:id/redefinicao-senha', ...acessoGestor, limitadorRedefinicaoGerar, redefinicaoSenhaControlador.gerarParaCliente);

module.exports = router;
