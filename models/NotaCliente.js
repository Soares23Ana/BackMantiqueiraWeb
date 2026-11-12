const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

// Nota interna da equipe sobre um cliente (suporte). O cliente não vê.
const NotaCliente = sequelize.define('NotaCliente', {
    id_nota: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_cliente: { type: DataTypes.INTEGER, allowNull: false },
    texto: { type: DataTypes.STRING(1000), allowNull: false },
    id_autor: { type: DataTypes.INTEGER, allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    tableName: 'notas_cliente',
    timestamps: false
});

module.exports = NotaCliente;
