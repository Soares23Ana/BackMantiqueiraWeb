const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Favorito = sequelize.define('Favorito', {
    id_usuario: { type: DataTypes.INTEGER, primaryKey: true },
    id_produto: { type: DataTypes.INTEGER, primaryKey: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    tableName: 'favoritos',
    timestamps: false
});

module.exports = Favorito;
