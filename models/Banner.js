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
    ativo: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    tableName: 'conteudo_cms',
    timestamps: false
});

module.exports = Banner;
