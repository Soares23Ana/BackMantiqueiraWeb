const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const STATUS_PEDIDO = ['Aguardando Separação', 'Em Separação', 'Saiu para Entrega', 'Entregue', 'Cancelado'];

const Pedido = sequelize.define('Pedido', {
    id_pedido: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    id_cliente: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    // Último usuário da equipe que mudou o status do pedido.
    id_funcionario: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    id_endereco: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    // Cópia do endereço no momento do pedido.
    endereco_entrega: {
        type: DataTypes.JSON,
        allowNull: true
    },
    observacao: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    data_pedido: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    data_entrega_desejada: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    data_entrega: {
        type: DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM(...STATUS_PEDIDO),
        allowNull: false,
        defaultValue: 'Aguardando Separação'
    },
    motivo_cancelamento: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    atualizado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'pedidos',
    timestamps: true,
    createdAt: false,
    updatedAt: 'atualizado_em'
});

module.exports = Pedido;
module.exports.STATUS_PEDIDO = STATUS_PEDIDO;
