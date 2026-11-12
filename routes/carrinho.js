const express = require('express');
const controlador = require('../controllers/carrinhoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const verificarPerfil = require('../middlewares/roleMiddleware');

// Carrinho e favoritos pertencem à conta do cliente: visitante recebe 401 e a equipe, 403.
const somenteCliente = [autenticarToken, verificarPerfil(['cliente'])];

const carrinho = express.Router();
carrinho.get('/', ...somenteCliente, controlador.obterCarrinho);
carrinho.put('/', ...somenteCliente, controlador.substituirCarrinho);
carrinho.delete('/', ...somenteCliente, controlador.limparCarrinho);

const favoritos = express.Router();
favoritos.get('/', ...somenteCliente, controlador.listarFavoritos);
favoritos.put('/:id_produto', ...somenteCliente, controlador.adicionarFavorito);
favoritos.delete('/:id_produto', ...somenteCliente, controlador.removerFavorito);

module.exports = { carrinho, favoritos };
