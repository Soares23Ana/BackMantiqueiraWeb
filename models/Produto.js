const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Produto = sequelize.define('Produto', {
    id_produto: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    sku: {
        type: DataTypes.STRING(40),
        allowNull: false,
        unique: true
    },
    id_fornecedor: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    id_categoria: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    id_marca: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    nome: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    descricao: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    destaques: {
        type: DataTypes.JSON,
        allowNull: true
    },
    imagem_url: {
        type: DataTypes.STRING(2048),
        allowNull: true
    },
    // Mantido apenas como dado de cadastro: nunca aparece em rotas públicas nem entra em pedidos.
    preco: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    },
    quantidade_estoque: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    estoque_minimo: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10
    },
    multiplo_venda: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
    },
    ativo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    criado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    atualizado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'produtos',
    timestamps: true,
    createdAt: 'criado_em',
    updatedAt: 'atualizado_em'
});

module.exports = Produto;
