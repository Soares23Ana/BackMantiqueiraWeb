const { Op } = require('sequelize');
const { Usuario, Produto, Pedido } = require('../models');

async function contarIndicadoresOperacionais() {
    const [pedidosPendentes, estoqueBaixo] = await Promise.all([
        Pedido.count({
            where: { status: { [Op.in]: ['Aguardando Separação', 'Em Separação'] } }
        }),
        Produto.count({ where: { quantidade_estoque: { [Op.lte]: 10 } } })
    ]);
    return { pedidosPendentes, estoqueBaixo };
}

async function obterEstatisticas(req, res) {
    try {
        const [indicadores, clientesAtivos] = await Promise.all([
            contarIndicadoresOperacionais(),
            Usuario.count({ where: { tipo: 'cliente' } })
        ]);

        return res.status(200).json({
            ...indicadores,
            clientesAtivos
        });
    } catch (erro) {
        console.error('Erro ao obter estatísticas do painel:', erro);
        return res.status(500).json({ mensagem: 'Erro ao carregar estatísticas do painel.' });
    }
}

async function obterContadores(req, res) {
    try {
        return res.status(200).json(await contarIndicadoresOperacionais());
    } catch (erro) {
        console.error('Erro ao obter contadores operacionais:', erro);
        return res.status(500).json({ mensagem: 'Erro ao carregar contadores operacionais.' });
    }
}

async function obterAlertasReposicao(req, res) {
    try {
        const produtos = await Produto.findAll({
            where: { quantidade_estoque: { [Op.lte]: 10 } },
            attributes: ['id_produto', 'nome', 'descricao', 'quantidade_estoque'],
            order: [['quantidade_estoque', 'ASC'], ['nome', 'ASC']]
        });
        const alertas = produtos.map((produto) => {
            const estoqueAtual = Number(produto.quantidade_estoque);
            return {
                produto: {
                    id_produto: produto.id_produto,
                    nome: produto.nome,
                    descricao: produto.descricao
                },
                estoque_atual: estoqueAtual,
                sugestao_compra: 50 - estoqueAtual
            };
        });
        return res.status(200).json({ alertas });
    } catch (erro) {
        console.error('Erro ao obter alertas de reposição:', erro);
        return res.status(500).json({ mensagem: 'Erro ao carregar alertas de reposição.' });
    }
}

module.exports = { obterEstatisticas, obterContadores, obterAlertasReposicao };
