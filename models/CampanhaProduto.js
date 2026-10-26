const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const CampanhaProduto = sequelize.define('CampanhaProduto', {
    id_campanha: {
        type: DataTypes.INTEGER,
        primaryKey: true
    },
    id_produto: {
        type: DataTypes.INTEGER,
        primaryKey: true
    }
}, {
    tableName: 'campanhas_produtos',
    timestamps: false
});

module.exports = CampanhaProduto;
