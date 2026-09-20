const express = require('express');
const router = express.Router();
const db = require('../db/conn');
const authMiddleware = require('../middlewares/authMiddleware');
const checkRole = require('../middlewares/roleMiddleware');

// 1. LISTAR TODOS OS PRODUTOS (Qualquer utilizador autenticado pode ver)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const [produtos] = await db.query(`
            SELECT p.*, f.nome_fantasia AS fornecedor 
            FROM produtos p 
            LEFT JOIN fornecedores f ON p.id_fornecedor = f.id_fornecedor
        `);
        return res.json(produtos);
    } catch (erro) {
        return res.status(500).json({ mensagem: "Erro ao procurar produtos", erro: erro.message });
    }
});

// 2. CADASTRAR PRODUTO (Apenas 'admin' e 'gerente')
router.post('/', authMiddleware, checkRole(['admin', 'gerente']), async (req, res) => {
    const { id_fornecedor, nome, descricao, preco, quantidade_estoque } = req.body;

    if (!nome || !preco) {
        return res.status(400).json({ mensagem: "Nome e preço são obrigatórios." });
    }

    try {
        const [resultado] = await db.query(
            'INSERT INTO produtos (id_fornecedor, nome, descricao, preco, quantidade_estoque) VALUES (?, ?, ?, ?, ?)',
            [id_fornecedor || null, nome, descricao || null, preco, quantidade_estoque || 0]
        );

        return res.status(201).json({ 
            mensagem: "Produto cadastrado com sucesso!", 
            id_produto: resultado.insertId 
        });
    } catch (erro) {
        return res.status(500).json({ mensagem: "Erro ao cadastrar produto", erro: erro.message });
    }
});

module.exports = router;