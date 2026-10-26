const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Usuario, Produto, Pedido, ItemPedido } = require('../models');
const logger = require('../lib/logger');

const STATUS_PEDIDO = [
    'Aguardando Separação',
    'Em Separação',
    'Saiu para Entrega',
    'Entregue',
];

function respostaErro(mensagem, status) {
    const erro = new Error(mensagem);
    erro.statusHttp = status;
    return erro;
}

function normalizarItens(itens) {
    if (!Array.isArray(itens) || itens.length === 0 || itens.length > 100) {
        throw respostaErro('Informe de 1 a 100 itens no pedido.', 400);
    }

    const quantidades = new Map();
    for (const item of itens) {
        if (!item || typeof item !== 'object') {
            throw respostaErro('Cada item deve ser um objeto com produto e quantidade.', 400);
        }
        const idProduto = Number(item.id_produto);
        const quantidade = Number(item.quantidade);
        if (!Number.isSafeInteger(idProduto) || idProduto <= 0 ||
            !Number.isSafeInteger(quantidade) || quantidade <= 0) {
            throw respostaErro('Cada item deve ter id_produto e quantidade inteiros positivos.', 400);
        }
        const total = (quantidades.get(idProduto) || 0) + quantidade;
        if (!Number.isSafeInteger(total)) {
            throw respostaErro('A quantidade informada é inválida.', 400);
        }
        quantidades.set(idProduto, total);
    }
    return [...quantidades.entries()]
        .map(([id_produto, quantidade]) => ({ id_produto, quantidade }))
        .sort((a, b) => a.id_produto - b.id_produto);
}

async function criarPedido(req, res) {
    let itens;
    try {
        itens = normalizarItens(req.body && req.body.itens);
    } catch (erro) {
        return res.status(erro.statusHttp || 400).json({ mensagem: erro.message });
    }

    try {
        const pedido = await sequelize.transaction(async (transacao) => {
            // O bloqueio impede que pedidos concorrentes reservem o mesmo estoque.
            const produtos = await Produto.findAll({
                where: { id_produto: { [Op.in]: itens.map((item) => item.id_produto) } },
                order: [['id_produto', 'ASC']],
                transaction: transacao,
                lock: transacao.LOCK.UPDATE
            });
            if (produtos.length !== itens.length) {
                throw respostaErro('Um ou mais produtos não foram encontrados.', 404);
            }

            const produtosPorId = new Map(produtos.map((produto) => [produto.id_produto, produto]));
            for (const item of itens) {
                const produto = produtosPorId.get(item.id_produto);
                if (item.quantidade > produto.quantidade_estoque) {
                    throw respostaErro(`Estoque insuficiente para o produto ${produto.nome}.`, 409);
                }
            }

            const novoPedido = await Pedido.create(
                { id_cliente: req.usuario.id, status: 'Aguardando Separação' },
                { transaction: transacao }
            );

            const itensPedido = itens.map((item) => {
                const produto = produtosPorId.get(item.id_produto);
                return {
                    id_pedido: novoPedido.id_pedido,
                    id_produto: produto.id_produto,
                    quantidade: item.quantidade
                };
            });
            await ItemPedido.bulkCreate(itensPedido, { transaction: transacao });

            // Pedido, itens e baixa de estoque são confirmados ou revertidos juntos.
            for (const item of itens) {
                const produto = produtosPorId.get(item.id_produto);
                await produto.update({
                    quantidade_estoque: produto.quantidade_estoque - item.quantidade
                }, { transaction: transacao });
            }
            return novoPedido;
        });

        return res.status(201).json({
            mensagem: 'Pedido criado com sucesso.',
            id_pedido: pedido.id_pedido,
            status: pedido.status
        });
    } catch (erro) {
        if (erro.statusHttp) {
            return res.status(erro.statusHttp).json({ mensagem: erro.message });
        }
        logger.error('Erro ao criar pedido.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao criar pedido.' });
    }
}

async function listarPedidos(req, res) {
    try {
        const pedidos = await Pedido.findAll({
            include: [
                {
                    model: Usuario,
                    as: 'cliente',
                    attributes: ['id_usuario', 'nome', 'email', 'telefone']
                },
                {
                    model: Usuario,
                    as: 'funcionario',
                    attributes: ['id_usuario', 'nome', 'cargo'],
                    required: false
                },
                {
                    model: ItemPedido,
                    as: 'itens',
                    attributes: ['id_pedido', 'id_produto', 'quantidade'],
                    include: [{
                        model: Produto,
                        as: 'produto',
                        attributes: ['id_produto', 'nome']
                    }]
                }
            ],
            order: [['data_pedido', 'DESC']]
        });
        return res.status(200).json({ pedidos });
    } catch (erro) {
        logger.error('Erro ao listar pedidos.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao listar pedidos.' });
    }
}

async function obterPedido(req, res) {
    const idPedido = Number(req.params.id_pedido);
    if (!Number.isSafeInteger(idPedido) || idPedido <= 0) {
        return res.status(400).json({ mensagem: 'Identificador de pedido inválido.' });
    }

    try {
        const pedido = await Pedido.findByPk(idPedido, {
            attributes: ['id_pedido', 'id_cliente', 'data_pedido', 'data_entrega', 'status'],
            include: [{
                model: ItemPedido,
                as: 'itens',
                attributes: ['id_pedido', 'id_produto', 'quantidade'],
                include: [{
                    model: Produto,
                    as: 'produto',
                    attributes: ['id_produto', 'nome']
                }]
            }]
        });
        if (!pedido) {
            return res.status(404).json({ mensagem: 'Pedido não encontrado.' });
        }

        if (req.usuario.tipo === 'cliente' && Number(req.usuario.id) !== Number(pedido.id_cliente)) {
            return res.status(403).json({
                mensagem: 'Acesso negado: este pedido não pertence ao cliente autenticado.'
            });
        }
        if (!['cliente', 'gerente', 'admin'].includes(req.usuario.tipo)) {
            return res.status(403).json({
                mensagem: 'Acesso negado: Não tem permissão para realizar esta operação.'
            });
        }

        return res.status(200).json({ pedido });
    } catch (erro) {
        logger.error('Erro ao obter pedido.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao obter pedido.' });
    }
}

async function atualizarStatus(req, res) {
    const idPedido = Number(req.params.id_pedido);
    const { status } = req.body || {};
    if (!Number.isSafeInteger(idPedido) || idPedido <= 0) {
        return res.status(400).json({ mensagem: 'Identificador de pedido inválido.' });
    }
    if (!STATUS_PEDIDO.includes(status)) {
        return res.status(400).json({ mensagem: 'Status do pedido inválido.' });
    }

    try {
        const pedido = await Pedido.findByPk(idPedido);
        if (!pedido) {
            return res.status(404).json({ mensagem: 'Pedido não encontrado.' });
        }
        await pedido.update({
            status,
            data_entrega: status === 'Entregue' ? new Date() : null
        });
        logger.info('[NOTIFICAÇÃO AUTOMÁTICA] Status do pedido atualizado.', { id_pedido: idPedido, status });
        return res.status(200).json({
            mensagem: 'Status do pedido atualizado.',
            pedido: {
                id_pedido: pedido.id_pedido,
                status: pedido.status,
                data_entrega: pedido.data_entrega
            }
        });
    } catch (erro) {
        logger.error('Erro ao atualizar status do pedido.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao atualizar status do pedido.' });
    }
}

module.exports = { criarPedido, listarPedidos, obterPedido, atualizarStatus };
