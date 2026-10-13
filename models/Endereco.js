const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Endereco = sequelize.define('Endereco', {
    id_endereco: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    id_usuario: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    cep: {
        type: DataTypes.STRING(9),
        allowNull: false
    },
    logradouro: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    numero: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    complemento: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    bairro: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    cidade: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    estado: {
        type: DataTypes.STRING(2),
        allowNull: false
    },
    referencia: {
        type: DataTypes.STRING(200),
        allowNull: true
    },
    principal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    }
}, {
    tableName: 'enderecos',
    timestamps: false
});

module.exports = Endereco;
