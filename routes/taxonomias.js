const express = require('express');
const { Categoria, Marca } = require('../models');
const { criarControladorTaxonomia } = require('../controllers/taxonomiaControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { autenticacaoOpcional } = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

function criarRotas(controlador) {
    const router = express.Router();
    const gestao = [autenticarToken, exigirEquipe];
    router.get('/', autenticacaoOpcional, controlador.listar);
    router.post('/', ...gestao, controlador.criar);
    router.put('/:id', ...gestao, controlador.atualizar);
    router.patch('/:id', ...gestao, controlador.atualizar);
    router.delete('/:id', ...gestao, controlador.excluir);
    return router;
}

module.exports = {
    categorias: criarRotas(criarControladorTaxonomia(Categoria, { rotulo: 'Categoria', artigo: 'a', chave: 'categoria', comOrdem: true })),
    marcas: criarRotas(criarControladorTaxonomia(Marca, { rotulo: 'Marca', artigo: 'a', chave: 'marca' }))
};
