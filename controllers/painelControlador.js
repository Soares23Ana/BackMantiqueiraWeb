const { Op, fn } = require('sequelize');
const sequelize = require('../db/conn');
const { Usuario, Produto, Pedido, ItemPedido } = require('../models');

async function obterEstatisticas(req, res) {
    try {
        const [faturamento, pedidosPendentes, clientesAtivos, estoqueBaixo] = await Promise.all([
            // Pedidos cancelados não entram no faturamento do painel.
            ItemPedido.findOne({
                attributes: [[
                    fn('COALESCE', fn(
                        'SUM',
                        sequelize.literal('`ItemPedido`.`quantidade` * `ItemPedido`.`preco_unitario`')
                    ), 0),
                    'faturamentoTotal'
                ]],
                include: [{
                    model: Pedido,
                    as: 'pedido',
                    attributes: [],
                    required: true,
                    where: { status: { [Op.ne]: 'Cancelado' } }
                }],
                raw: true
            }),
            Pedido.count({
                where: { status: { [Op.in]: ['Pendente', 'Separacao_Estoque'] } }
            }),
            Usuario.count({ where: { tipo: 'cliente' } }),
            Produto.count({ where: { quantidade_estoque: { [Op.lte]: 10 } } })
        ]);

        return res.status(200).json({
            faturamentoTotal: Number(faturamento.faturamentoTotal),
            pedidosPendentes,
            clientesAtivos,
            estoqueBaixo
        });
    } catch (erro) {
        console.error('Erro ao obter estatísticas do painel:', erro);
        return res.status(500).json({ mensagem: 'Erro ao carregar estatísticas do painel.' });
    }
}

module.exports = { obterEstatisticas };
