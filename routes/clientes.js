const express = require('express');
const clienteControlador = require('../controllers/clienteControlador');
const suporteControlador = require('../controllers/suporteControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

const router = express.Router();
const acessoGestor = [autenticarToken, exigirEquipe];

router.get('/', ...acessoGestor, clienteControlador.listarClientes);
router.get('/:id/detalhes', ...acessoGestor, clienteControlador.obterDetalhesCliente);
router.get('/:id/notas', ...acessoGestor, suporteControlador.listarNotas);
router.post('/:id/notas', ...acessoGestor, suporteControlador.criarNota);
router.delete('/:id/notas/:id_nota', ...acessoGestor, suporteControlador.excluirNota);
router.put('/:id', ...acessoGestor, clienteControlador.atualizarCliente);
router.put('/:id/senha', ...acessoGestor, clienteControlador.definirSenhaTemporaria);

module.exports = router;
