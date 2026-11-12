const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

// Contato da equipe com um cliente de carrinho abandonado.
const CarrinhoContato = sequelize.define('CarrinhoContato', {
    id_contato: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: { type: DataTypes.INTEGER, allowNull: false },
    observacao: { type: DataTypes.STRING(500), allowNull: true },
    id_funcionario: { type: DataTypes.INTEGER, allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    tableName: 'carrinho_contatos',
    timestamps: false
});

module.exports = CarrinhoContato;
