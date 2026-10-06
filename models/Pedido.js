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
    status: {
        type: DataTypes.ENUM(
            'Pendente',
            'Separacao_Estoque',
            'Em_Rota_Mantiqueira',
            'Entregue',
            'Cancelado'
        ),
        allowNull: true,
        defaultValue: 'Pendente'
    }
}, {
    tableName: 'pedidos',
    timestamps: false
});

module.exports = Pedido;
