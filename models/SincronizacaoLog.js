const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const SincronizacaoLog = sequelize.define('SincronizacaoLog', {
    id_sincronizacao: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    tipo: {
        type: DataTypes.ENUM('importacao_manual', 'carga_completa', 'estoque'),
        allowNull: false
    },
    origem: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    simulado: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    status: {
        type: DataTypes.ENUM('em_andamento', 'sucesso', 'parcial', 'falha'),
        allowNull: false,
        defaultValue: 'em_andamento'
    },
    linhas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    criados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    atualizados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    inalterados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    desativados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    com_erro: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    movimentacoes_estoque: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    relatorio: {
        type: DataTypes.JSON,
        allowNull: true
    },
    mensagem: {
        type: DataTypes.STRING(500),
        allowNull: true
    },
    id_usuario: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    iniciado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    finalizado_em: {
        type: DataTypes.DATE,
        allowNull: true
    },
    duracao_ms: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
}, {
    tableName: 'sincronizacoes_log',
    timestamps: false
});

module.exports = SincronizacaoLog;
