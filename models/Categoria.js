const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Categoria = sequelize.define('Categoria', {
    id_categoria: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nome: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    slug: {
        type: DataTypes.STRING(120),
        allowNull: false,
        unique: true
    },
    ordem: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    ativo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: 'categorias',
    timestamps: true,
    createdAt: 'criado_em',
    updatedAt: 'atualizado_em'
});

module.exports = Categoria;
