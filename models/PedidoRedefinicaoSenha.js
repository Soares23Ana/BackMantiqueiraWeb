const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const STATUS = ['pendente', 'atendido', 'dispensado', 'expirado'];

// Pedido de nova senha feito pelo cliente na tela de login. Pendente até a equipe enviar o link (atendido) ou
// dispensar; pendentes velhos viram expirado na limpeza diária. Nunca guarda token nem link.
const PedidoRedefinicaoSenha = sequelize.define('PedidoRedefinicaoSenha', {
    id_pedido: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    id_usuario: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM(...STATUS), allowNull: false, defaultValue: 'pendente' },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    atendido_em: { type: DataTypes.DATE, allowNull: true },
    atendido_por: { type: DataTypes.INTEGER, allowNull: true }
}, {
    tableName: 'pedidos_redefinicao_senha',
    timestamps: false
});

PedidoRedefinicaoSenha.STATUS = STATUS;

module.exports = PedidoRedefinicaoSenha;
