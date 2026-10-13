const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const ItemPedido = sequelize.define('ItemPedido', {
    id_pedido: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false
    },
    id_produto: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        allowNull: false
    },
    quantidade: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
}, {
    tableName: 'itens_pedido',
    timestamps: false
});

module.exports = ItemPedido;
