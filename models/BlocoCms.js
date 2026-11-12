const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

// Bloco de texto editável do site, identificado por uma chave (ex.: "sobre").
const BlocoCms = sequelize.define('BlocoCms', {
    id_bloco: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    chave: {
        type: DataTypes.STRING(60),
        allowNull: false,
        unique: true
    },
    titulo: {
        type: DataTypes.STRING(150),
        allowNull: true
    },
    conteudo: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    // Campos extras de blocos especiais (ex.: o pop-up guarda imagem, destino e janela de exibição).
    dados: {
        type: DataTypes.JSON,
        allowNull: true
    },
    ativo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: 'blocos_cms',
    timestamps: true,
    createdAt: false,
    updatedAt: 'atualizado_em'
});

module.exports = BlocoCms;
