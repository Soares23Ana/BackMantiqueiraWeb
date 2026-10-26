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
    // CNPJ do cliente (14 dígitos, único): é a credencial de login. A equipe não tem CNPJ.
    cnpj: {
        type: DataTypes.STRING(14),
        allowNull: true,
        unique: true
    },
    // Valor anterior que não pôde virar um CNPJ válido e único na migração 004 (aguarda correção).
    cnpj_original: {
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
    ativo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
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
