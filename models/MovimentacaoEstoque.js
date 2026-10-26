const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const MovimentacaoEstoque = sequelize.define('MovimentacaoEstoque', {
    id_movimentacao: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    id_produto: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    tipo: {
        type: DataTypes.ENUM('ajuste', 'pedido', 'cancelamento', 'importacao'),
        allowNull: false
    },
    // Variação aplicada (negativa na saída). estoque_anterior + quantidade = estoque_novo.
    quantidade: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    estoque_anterior: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    estoque_novo: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    observacao: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    id_usuario: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    id_pedido: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    criado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'movimentacoes_estoque',
    timestamps: false
});

module.exports = MovimentacaoEstoque;
