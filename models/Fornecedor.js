const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Fornecedor = sequelize.define('Fornecedor', {
    id_fornecedor: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nome_fantasia: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    cnpj: {
        type: DataTypes.STRING(18),
        allowNull: false,
        unique: true
    },
    email: {
        type: DataTypes.STRING(100),
        allowNull: true
    }
}, {
    tableName: 'fornecedores',
    timestamps: false
});

module.exports = Fornecedor;
