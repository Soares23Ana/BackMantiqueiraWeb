// requerer somente o metodo DataTypes do Sequelize
const { DataTypes } = require('sequelize');
// requerer a conexao com banco
const conn = require('../db/conn');

// definir o model user
const User = conn.define('User', {
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    image: {
        type: DataTypes.STRING,
        allowNull: true, // Geralmente a foto de perfil não é obrigatória logo no cadastro
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false,
    }
});

module.exports = User;