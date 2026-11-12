const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

// Trilha de auditoria: quem alterou o quê. O resumo traz só os campos alterados (antes/depois).
const Auditoria = sequelize.define('Auditoria', {
    id_auditoria: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    id_usuario: { type: DataTypes.INTEGER, allowNull: true },
    acao: { type: DataTypes.STRING(60), allowNull: false },
    entidade: { type: DataTypes.STRING(40), allowNull: false },
    id_entidade: { type: DataTypes.STRING(60), allowNull: true },
    resumo: { type: DataTypes.JSON, allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, {
    tableName: 'auditoria',
    timestamps: false
});

module.exports = Auditoria;
