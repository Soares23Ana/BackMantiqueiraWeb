const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

// Pedido de nova senha feito pelo cliente na tela de login. Fica pendente (atendido_em nulo) até a equipe atender.
const SolicitacaoRedefinicao = sequelize.define('SolicitacaoRedefinicao', {
    id_solicitacao: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: { type: DataTypes.INTEGER, allowNull: false },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    atendido_em: { type: DataTypes.DATE, allowNull: true },
    atendido_por: { type: DataTypes.INTEGER, allowNull: true }
}, {
    tableName: 'solicitacoes_redefinicao',
    timestamps: false
});

module.exports = SolicitacaoRedefinicao;
