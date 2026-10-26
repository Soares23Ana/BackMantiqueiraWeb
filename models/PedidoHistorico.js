const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');
const { STATUS_PEDIDO } = require('./Pedido');

const PedidoHistorico = sequelize.define('PedidoHistorico', {
    id_historico: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    id_pedido: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    // Nulo no primeiro registro (criação do pedido).
    status_anterior: {
        type: DataTypes.ENUM(...STATUS_PEDIDO),
        allowNull: true
    },
    status_novo: {
        type: DataTypes.ENUM(...STATUS_PEDIDO),
        allowNull: false
    },
    id_usuario: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    observacao: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    criado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'pedido_historico',
    timestamps: false
});

module.exports = PedidoHistorico;
