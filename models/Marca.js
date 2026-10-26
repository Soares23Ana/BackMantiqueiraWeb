const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Marca = sequelize.define('Marca', {
    id_marca: {
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
    ativo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: 'marcas',
    timestamps: true,
    createdAt: 'criado_em',
    updatedAt: 'atualizado_em'
});

module.exports = Marca;
