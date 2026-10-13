const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

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
    id_funcionario: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    data_pedido: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    data_entrega: {
        type: DataTypes.DATE,
        allowNull: true
    },
    status: {
        type: DataTypes.ENUM(
            'Pendente',
            'Aguardando Separação',
            'Em Separação',
            'Saiu para Entrega',
            'Entregue',
            'Cancelado'
        ),
        allowNull: true,
        defaultValue: 'Aguardando Separação'
    }
}, {
    tableName: 'pedidos',
    timestamps: false
});

module.exports = Pedido;
