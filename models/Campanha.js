const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Campanha = sequelize.define('Campanha', {
    id_campanha: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    titulo: {
        type: DataTypes.STRING(120),
        allowNull: false
    },
    // Rótulo exibido nos produtos (ex.: "Leve 8 pague 6"). Não aplica desconto.
    selo: {
        type: DataTypes.STRING(40),
        allowNull: true
    },
    inicio_em: {
        type: DataTypes.DATE,
        allowNull: false
    },
    fim_em: {
        type: DataTypes.DATE,
        allowNull: false
    },
    id_usuario: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    tableName: 'campanhas',
    timestamps: true,
    createdAt: 'criado_em',
    updatedAt: 'atualizado_em'
});

module.exports = Campanha;
