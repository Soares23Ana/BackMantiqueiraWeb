const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Usuario = sequelize.define('Usuario', {
    id_usuario: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    nome: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    razao_social: {
        type: DataTypes.STRING(150),
        allowNull: true
    },
    email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true
    },
    senha: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    cnpj_cpf: {
        type: DataTypes.STRING(18),
        allowNull: true
    },
    telefone: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    tipo: {
        type: DataTypes.ENUM('cliente', 'funcionario', 'gerente', 'admin'),
        allowNull: false,
        defaultValue: 'cliente'
    },
    cargo: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    criado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'usuarios',
    timestamps: false
});

module.exports = Usuario;
