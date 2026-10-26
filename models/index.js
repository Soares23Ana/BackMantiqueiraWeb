const Usuario = require('./Usuario');
const Fornecedor = require('./Fornecedor');
const Produto = require('./Produto');
const Pedido = require('./Pedido');
const ItemPedido = require('./ItemPedido');
const Banner = require('./Banner');
const Endereco = require('./Endereco');
const Categoria = require('./Categoria');
const Marca = require('./Marca');
const MovimentacaoEstoque = require('./MovimentacaoEstoque');
const PedidoHistorico = require('./PedidoHistorico');
const BlocoCms = require('./BlocoCms');
const Configuracao = require('./Configuracao');
const SincronizacaoLog = require('./SincronizacaoLog');
const Campanha = require('./Campanha');
const CampanhaProduto = require('./CampanhaProduto');

Campanha.belongsToMany(Produto, {
    through: CampanhaProduto,
    foreignKey: 'id_campanha',
    otherKey: 'id_produto',
    as: 'produtos'
});
Produto.belongsToMany(Campanha, {
    through: CampanhaProduto,
    foreignKey: 'id_produto',
    otherKey: 'id_campanha',
    as: 'campanhas'
});

SincronizacaoLog.belongsTo(Usuario, {
    foreignKey: 'id_usuario',
    as: 'usuario'
});

Pedido.hasMany(PedidoHistorico, {
    foreignKey: 'id_pedido',
    as: 'historico'
});
PedidoHistorico.belongsTo(Usuario, {
    foreignKey: 'id_usuario',
    as: 'usuario'
});

Fornecedor.hasMany(Produto, {
    foreignKey: 'id_fornecedor',
    as: 'produtos'
});
Produto.belongsTo(Fornecedor, {
    foreignKey: 'id_fornecedor',
    as: 'fornecedor'
});

Categoria.hasMany(Produto, {
    foreignKey: 'id_categoria',
    as: 'produtos'
});
Produto.belongsTo(Categoria, {
    foreignKey: 'id_categoria',
    as: 'categoria'
});
Marca.hasMany(Produto, {
    foreignKey: 'id_marca',
    as: 'produtos'
});
Produto.belongsTo(Marca, {
    foreignKey: 'id_marca',
    as: 'marca'
});
Produto.hasMany(MovimentacaoEstoque, {
    foreignKey: 'id_produto',
    as: 'movimentacoes'
});
MovimentacaoEstoque.belongsTo(Produto, {
    foreignKey: 'id_produto',
    as: 'produto'
});
MovimentacaoEstoque.belongsTo(Usuario, {
    foreignKey: 'id_usuario',
    as: 'usuario'
});

Usuario.hasMany(Pedido, {
    foreignKey: 'id_cliente',
    as: 'pedidosComoCliente'
});
Usuario.hasMany(Endereco, {
    foreignKey: 'id_usuario',
    as: 'enderecos'
});
Endereco.belongsTo(Usuario, {
    foreignKey: 'id_usuario',
    as: 'usuario'
});
Pedido.belongsTo(Usuario, {
    foreignKey: 'id_cliente',
    as: 'cliente'
});
Usuario.hasMany(Pedido, {
    foreignKey: 'id_funcionario',
    as: 'pedidosComoFuncionario'
});
Pedido.belongsTo(Usuario, {
    foreignKey: 'id_funcionario',
    as: 'funcionario'
});

Pedido.hasMany(ItemPedido, {
    foreignKey: 'id_pedido',
    as: 'itens'
});
ItemPedido.belongsTo(Pedido, {
    foreignKey: 'id_pedido',
    as: 'pedido'
});
Produto.hasMany(ItemPedido, {
    foreignKey: 'id_produto',
    as: 'itensPedido'
});
ItemPedido.belongsTo(Produto, {
    foreignKey: 'id_produto',
    as: 'produto'
});

module.exports = {
    Usuario,
    Fornecedor,
    Produto,
    Pedido,
    ItemPedido,
    Banner,
    Endereco,
    Categoria,
    Marca,
    MovimentacaoEstoque,
    PedidoHistorico,
    BlocoCms,
    Configuracao,
    SincronizacaoLog,
    Campanha,
    CampanhaProduto
};
