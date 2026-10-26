const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Configuracao = sequelize.define('Configuracao', {
    chave: {
        type: DataTypes.STRING(60),
        primaryKey: true
    },
    valor: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    publica: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    id_usuario: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    tableName: 'configuracoes',
    timestamps: true,
    createdAt: false,
    updatedAt: 'atualizado_em'
});

module.exports = Configuracao;
