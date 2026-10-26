const { Fornecedor, Produto } = require('../models');
const logger = require('../lib/logger');

async function listarTodos(req, res) {
    try {
        const produtos = await Produto.findAll({
            include: [{
                model: Fornecedor,
                as: 'fornecedor',
                attributes: ['nome_fantasia']
            }]
        });
        return res.status(200).json(produtos);
    } catch (erro) {
        logger.error('Erro ao procurar produtos.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao procurar produtos.' });
    }
}

async function cadastrar(req, res) {
    const { id_fornecedor, nome, descricao, preco, quantidade_estoque } = req.body;
    if (!nome || preco === undefined || preco === null || preco === '') {
        return res.status(400).json({ mensagem: 'Nome e preço são obrigatórios.' });
    }

    try {
        const produto = await Produto.create({
            id_fornecedor: id_fornecedor || null,
            nome,
            descricao: descricao || null,
            preco,
            quantidade_estoque: quantidade_estoque ?? 0
        });
        return res.status(201).json({
            mensagem: 'Produto cadastrado com sucesso!',
            id_produto: produto.id_produto
        });
    } catch (erro) {
        logger.error('Erro ao cadastrar produto.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao cadastrar produto.' });
    }
}

module.exports = { listarTodos, cadastrar };
