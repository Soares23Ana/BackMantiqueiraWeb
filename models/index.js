const Usuario = require('./Usuario');
const Fornecedor = require('./Fornecedor');
const Produto = require('./Produto');
const Pedido = require('./Pedido');
const ItemPedido = require('./ItemPedido');
const Banner = require('./Banner');

Fornecedor.hasMany(Produto, {
    foreignKey: 'id_fornecedor',
    as: 'produtos'
});
Produto.belongsTo(Fornecedor, {
    foreignKey: 'id_fornecedor',
    as: 'fornecedor'
});

Usuario.hasMany(Pedido, {
    foreignKey: 'id_cliente',
    as: 'pedidosComoCliente'
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

module.exports = { Usuario, Fornecedor, Produto, Pedido, ItemPedido, Banner };
