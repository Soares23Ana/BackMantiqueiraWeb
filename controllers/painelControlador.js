const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Usuario, Produto, Pedido } = require('../models');
const configuracoes = require('../servicos/configuracoes');

// Estoque baixo: produto ativo com estoque menor ou igual ao estoque mínimo do próprio produto.
const ESTOQUE_BAIXO = {
    ativo: true,
    quantidade_estoque: { [Op.lte]: sequelize.col('estoque_minimo') }
};

async function contarIndicadoresOperacionais() {
    const [pedidosPendentes, estoqueBaixo] = await Promise.all([
        Pedido.count({
            where: { status: { [Op.in]: ['Aguardando Separação', 'Em Separação'] } }
        }),
        Produto.count({ where: ESTOQUE_BAIXO })
    ]);
    return { pedidosPendentes, estoqueBaixo };
}

async function obterEstatisticas(req, res) {
    const [indicadores, clientesAtivos] = await Promise.all([
        contarIndicadoresOperacionais(),
        Usuario.count({ where: { tipo: 'cliente', ativo: true } })
    ]);
    return res.status(200).json({
        ...indicadores,
        clientesAtivos
    });
}

async function obterContadores(req, res) {
    return res.status(200).json(await contarIndicadoresOperacionais());
}

/**
 * GET /painel/alertas-reposicao: produtos com estoque no mínimo ou abaixo dele, com a sugestão
 * de compra para chegar à meta de reposição (configuração "meta_reposicao", padrão 50).
 */
async function obterAlertasReposicao(req, res) {
    const meta = await configuracoes.obterNumero('meta_reposicao');
    const produtos = await Produto.findAll({
        where: ESTOQUE_BAIXO,
        attributes: ['id_produto', 'sku', 'nome', 'descricao', 'quantidade_estoque', 'estoque_minimo'],
        order: [['quantidade_estoque', 'ASC'], ['nome', 'ASC']]
    });
    const alertas = produtos.map((produto) => ({
        produto: {
            id_produto: produto.id_produto,
            sku: produto.sku,
            nome: produto.nome,
            descricao: produto.descricao
        },
        estoque_atual: produto.quantidade_estoque,
        estoque_minimo: produto.estoque_minimo,
        sugestao_compra: Math.max(meta - produto.quantidade_estoque, 0)
    }));
    return res.status(200).json({ meta_reposicao: meta, alertas });
}

module.exports = { obterEstatisticas, obterContadores, obterAlertasReposicao };
