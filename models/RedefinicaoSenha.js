const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

// Link de redefinição de senha de uso único. Guarda só o SHA-256 do token, nunca o token.
const RedefinicaoSenha = sequelize.define('RedefinicaoSenha', {
    id_redefinicao: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: { type: DataTypes.INTEGER, allowNull: false },
    token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    expira_em: { type: DataTypes.DATE, allowNull: false },
    usado_em: { type: DataTypes.DATE, allowNull: true },
    criado_por: { type: DataTypes.INTEGER, allowNull: true }
}, {
    tableName: 'redefinicoes_senha',
    timestamps: false
});

module.exports = RedefinicaoSenha;
