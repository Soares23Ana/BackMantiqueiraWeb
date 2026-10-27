const { DataTypes } = require('sequelize');
const sequelize = require('../db/conn');

const TIPOS_EVENTO = [
    'busca', 'busca_sem_resultado', 'produto_visto', 'carrinho_adicionar',
    'checkout_iniciado', 'pedido_concluido', 'banner_clique', 'campanha_clique'
];

// Evento de uso para métricas. Sem IP; id_usuario só para quem está logado.
const Evento = sequelize.define('Evento', {
    id_evento: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
    },
    tipo: {
        type: DataTypes.ENUM(...TIPOS_EVENTO),
        allowNull: false
    },
    id_usuario: { type: DataTypes.INTEGER, allowNull: true },
    sessao: { type: DataTypes.STRING(64), allowNull: true },
    termo: { type: DataTypes.STRING(100), allowNull: true },
    resultados: { type: DataTypes.INTEGER, allowNull: true },
    id_produto: { type: DataTypes.INTEGER, allowNull: true },
    quantidade: { type: DataTypes.INTEGER, allowNull: true },
    id_pedido: { type: DataTypes.INTEGER, allowNull: true },
    id_banner: { type: DataTypes.INTEGER, allowNull: true },
    id_campanha: { type: DataTypes.INTEGER, allowNull: true },
    criado_em: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'eventos',
    timestamps: false
});

module.exports = Evento;
module.exports.TIPOS_EVENTO = TIPOS_EVENTO;
