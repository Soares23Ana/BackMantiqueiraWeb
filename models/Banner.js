const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const Banner = sequelize.define('Banner', {
    id_banner: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    titulo: {
        type: DataTypes.STRING(150),
        allowNull: false
    },
    link: {
        type: DataTypes.STRING(2048),
        allowNull: true
    },
    imagem_url: {
        type: DataTypes.STRING(2048),
        allowNull: false
    },
    // Posição na vitrine (menor aparece primeiro).
    ordem: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    ativo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    },
    // Janela de exibição opcional: fora dela o banner não aparece no site.
    inicio_em: {
        type: DataTypes.DATE,
        allowNull: true
    },
    fim_em: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'conteudo_cms',
    timestamps: true,
    createdAt: 'criado_em',
    updatedAt: 'atualizado_em'
});

module.exports = Banner;
