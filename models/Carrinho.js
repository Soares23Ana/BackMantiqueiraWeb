const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

// Carrinho do cliente guardado na API: uma linha por usuário, com a lista completa de itens em JSON.
const Carrinho = sequelize.define('Carrinho', {
    id_carrinho: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    itens: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    tableName: 'carrinhos',
    timestamps: true,
    createdAt: 'criado_em',
    updatedAt: 'atualizado_em'
});

module.exports = Carrinho;
