const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Produto, Pedido, ItemPedido, Endereco, PedidoHistorico } = require('../models');
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');
const { alterarEstoque } = require('./estoque');

// Fluxo operacional: cada status só avança para o próximo.
const PROXIMO_STATUS = {
    'Aguardando Separação': 'Em Separação',
    'Em Separação': 'Saiu para Entrega',
    'Saiu para Entrega': 'Entregue'
};
// Até onde o pedido pode ser cancelado (cliente: só antes da separação começar).
const CANCELAVEL_PELA_EQUIPE = ['Aguardando Separação', 'Em Separação'];
const CANCELAVEL_PELO_CLIENTE = ['Aguardando Separação'];

function podeCancelar(pedido, usuario) {
    if (usuario.tipo === 'cliente') {
        return Number(pedido.id_cliente) === Number(usuario.id) && CANCELAVEL_PELO_CLIENTE.includes(pedido.status);
    }
    return usuario.tipo === 'equipe' && CANCELAVEL_PELA_EQUIPE.includes(pedido.status);
}

async function registrarHistorico(pedido, statusAnterior, { idUsuario, observacao = null, transacao }) {
    await PedidoHistorico.create({
        id_pedido: pedido.id_pedido,
        status_anterior: statusAnterior,
        status_novo: pedido.status,
        id_usuario: idUsuario,
        observacao
    }, { transaction: transacao });
}

// Simula a notificação ao cliente; o envio real ficou fora do escopo.
function notificar(pedido) {
    logger.info('[NOTIFICAÇÃO AUTOMÁTICA] Status do pedido atualizado.', {
        id_pedido: pedido.id_pedido,
        status: pedido.status
    });
}

function hojeEmSaoPaulo() {
    return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function somarDias(dataIso, dias) {
    const data = new Date(`${dataIso}T12:00:00Z`);
    data.setUTCDate(data.getUTCDate() + dias);
    return data.toISOString().slice(0, 10);
}

/**
 * Valida o corpo do checkout. Itens repetidos são somados.
 * Retorna { itens, idEndereco, observacao, dataEntregaDesejada }.
 */
function validarCheckout(corpo) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'O corpo da requisição deve ser um objeto.');
    }
    const erros = [];
    for (const campo of Object.keys(corpo)) {
        if (!['itens', 'id_endereco', 'observacao', 'data_entrega_desejada'].includes(campo)) {
            erros.push({ campo, mensagem: `Campo não permitido: ${campo}.` });
        }
    }

    const quantidades = new Map();
    if (!Array.isArray(corpo.itens) || corpo.itens.length === 0 || corpo.itens.length > 100) {
        erros.push({ campo: 'itens', mensagem: 'Informe de 1 a 100 itens no pedido.' });
    } else {
        corpo.itens.forEach((item, indice) => {
            const idProduto = item && Number(item.id_produto);
            const quantidade = item && Number(item.quantidade);
            if (!item || typeof item !== 'object' || !Number.isSafeInteger(idProduto) || idProduto <= 0 ||
                !Number.isSafeInteger(quantidade) || quantidade <= 0 || quantidade > 100000) {
                erros.push({ campo: `itens[${indice}]`, mensagem: 'Cada item precisa de id_produto e quantidade inteiros positivos.' });
                return;
            }
            quantidades.set(idProduto, (quantidades.get(idProduto) || 0) + quantidade);
        });
    }

    let idEndereco = null;
    if (corpo.id_endereco !== undefined && corpo.id_endereco !== null) {
        idEndereco = Number(corpo.id_endereco);
        if (!Number.isSafeInteger(idEndereco) || idEndereco <= 0) {
            erros.push({ campo: 'id_endereco', mensagem: 'Endereço inválido.' });
        }
    }

    let observacao = null;
    if (corpo.observacao !== undefined && corpo.observacao !== null) {
        if (typeof corpo.observacao !== 'string' || corpo.observacao.trim().length > 500) {
            erros.push({ campo: 'observacao', mensagem: 'A observação deve ser um texto de até 500 caracteres.' });
        } else {
            observacao = corpo.observacao.trim() || null;
        }
    }

    let dataEntregaDesejada = null;
    if (corpo.data_entrega_desejada !== undefined && corpo.data_entrega_desejada !== null) {
        const valor = corpo.data_entrega_desejada;
        const hoje = hojeEmSaoPaulo();
        const valida = typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) &&
            !Number.isNaN(Date.parse(`${valor}T00:00:00Z`)) &&
            new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;
        if (!valida) {
            erros.push({ campo: 'data_entrega_desejada', mensagem: 'Use o formato AAAA-MM-DD.' });
        } else if (valor <= hoje || valor > somarDias(hoje, 90)) {
            erros.push({ campo: 'data_entrega_desejada', mensagem: 'A data de entrega desejada deve estar entre amanhã e os próximos 90 dias.' });
        } else {
            dataEntregaDesejada = valor;
        }
    }

    if (erros.length > 0) {
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }
    const itens = [...quantidades.entries()]
        .map(([id_produto, quantidade]) => ({ id_produto, quantidade }))
        .sort((a, b) => a.id_produto - b.id_produto);
    return { itens, idEndereco, observacao, dataEntregaDesejada };
}

// Endereço de entrega: o informado (precisa ser do cliente) ou o principal.
async function resolverEndereco(idCliente, idEndereco, transacao) {
    const endereco = await Endereco.findOne({
        where: idEndereco ? { id_endereco: idEndereco, id_usuario: idCliente } : { id_usuario: idCliente },
        order: [['principal', 'DESC'], ['id_endereco', 'ASC']],
        transaction: transacao
    });
    if (!endereco) {
        throw idEndereco
            ? new ErroApi(422, 'VALIDACAO', 'Endereço não encontrado.', [{ campo: 'id_endereco', mensagem: 'Endereço não encontrado.' }])
            : new ErroApi(422, 'ENDERECO_OBRIGATORIO', 'Cadastre um endereço de entrega antes de fazer o pedido.');
    }
    const { id_usuario: _dono, ...copia } = endereco.toJSON();
    return copia;
}

/**
 * Verifica todos os itens de uma vez e devolve a lista de problemas
 * (produto inexistente, inativo, fora do múltiplo de venda ou sem estoque suficiente).
 */
function verificarItens(itens, produtosPorId) {
    const problemas = [];
    for (const item of itens) {
        const produto = produtosPorId.get(item.id_produto);
        const base = { id_produto: item.id_produto, solicitado: item.quantidade };
        if (!produto) {
            problemas.push({ ...base, disponivel: 0, motivo: 'produto_inexistente' });
            continue;
        }
        const multiplo = Math.max(produto.multiplo_venda, 1);
        // Maior quantidade que pode ser pedida agora, respeitando o múltiplo de venda.
        const disponivel = Math.floor(produto.quantidade_estoque / multiplo) * multiplo;
        const detalhe = { ...base, sku: produto.sku, nome: produto.nome, disponivel, multiplo_venda: multiplo };
        if (!produto.ativo) {
            problemas.push({ ...detalhe, disponivel: 0, motivo: 'produto_inativo' });
        } else if (item.quantidade % multiplo !== 0) {
            problemas.push({ ...detalhe, motivo: 'multiplo_de_venda' });
        } else if (item.quantidade > produto.quantidade_estoque) {
            problemas.push({ ...detalhe, motivo: 'estoque_insuficiente' });
        }
    }
    return problemas;
}

/**
 * Cria o pedido do cliente. Produtos, pedido, itens, baixa de estoque, movimentações e histórico
 * são gravados na mesma transação; o bloqueio das linhas de produto (em ordem de id, para evitar
 * deadlock) impede que dois pedidos simultâneos usem o mesmo estoque.
 */
async function criarPedido(idCliente, corpo) {
    const { itens, idEndereco, observacao, dataEntregaDesejada } = validarCheckout(corpo);

    return sequelize.transaction(async (transacao) => {
        const endereco = await resolverEndereco(idCliente, idEndereco, transacao);
        const produtos = await Produto.findAll({
            where: { id_produto: { [Op.in]: itens.map((item) => item.id_produto) } },
            order: [['id_produto', 'ASC']],
            transaction: transacao,
            lock: transacao.LOCK.UPDATE
        });
        const produtosPorId = new Map(produtos.map((produto) => [produto.id_produto, produto]));
        const problemas = verificarItens(itens, produtosPorId);
        if (problemas.length > 0) {
            throw new ErroApi(409, 'ITENS_INDISPONIVEIS',
                `${problemas.length} item(ns) do pedido precisa(m) de ajuste.`, problemas);
        }

        const pedido = await Pedido.create({
            id_cliente: idCliente,
            id_endereco: endereco.id_endereco,
            endereco_entrega: endereco,
            observacao,
            data_entrega_desejada: dataEntregaDesejada,
            status: 'Aguardando Separação'
        }, { transaction: transacao });

        await ItemPedido.bulkCreate(
            itens.map((item) => ({ id_pedido: pedido.id_pedido, id_produto: item.id_produto, quantidade: item.quantidade })),
            { transaction: transacao }
        );
        for (const item of itens) {
            const produto = produtosPorId.get(item.id_produto);
            await alterarEstoque(produto, produto.quantidade_estoque - item.quantidade, {
                tipo: 'pedido',
                observacao: `Pedido #${pedido.id_pedido}.`,
                idUsuario: idCliente,
                idPedido: pedido.id_pedido,
                transacao
            });
        }
        await registrarHistorico(pedido, null, { idUsuario: idCliente, transacao });
        return pedido;
    });
}

async function bloquearPedido(idPedido, transacao) {
    const pedido = await Pedido.findByPk(idPedido, { transaction: transacao, lock: transacao.LOCK.UPDATE });
    if (!pedido) {
        throw new ErroApi(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.');
    }
    return pedido;
}

/**
 * Avança o status (equipe). Só aceita o próximo passo do fluxo; para cancelar, use cancelarPedido.
 * Registra quem mudou (id_funcionario e histórico) e a data de entrega ao entregar.
 */
async function avancarStatus(idPedido, novoStatus, usuario, observacao = null) {
    const pedido = await sequelize.transaction(async (transacao) => {
        const atual = await bloquearPedido(idPedido, transacao);
        const anterior = atual.status;
        if (PROXIMO_STATUS[anterior] !== novoStatus) {
            throw new ErroApi(409, 'TRANSICAO_INVALIDA',
                `Não é possível mudar de "${anterior}" para "${novoStatus}".`,
                { status_atual: anterior, proximo_permitido: PROXIMO_STATUS[anterior] || null });
        }
        await atual.update({
            status: novoStatus,
            id_funcionario: usuario.id,
            data_entrega: novoStatus === 'Entregue' ? new Date() : atual.data_entrega
        }, { transaction: transacao });
        await registrarHistorico(atual, anterior, { idUsuario: usuario.id, observacao, transacao });
        return atual;
    });
    notificar(pedido);
    return pedido;
}

/**
 * Cancela o pedido e devolve o estoque de todos os itens na mesma transação.
 * Cliente: só o próprio pedido e só em "Aguardando Separação". Equipe: até "Em Separação".
 */
async function cancelarPedido(idPedido, usuario, motivo) {
    const pedido = await sequelize.transaction(async (transacao) => {
        const atual = await bloquearPedido(idPedido, transacao);
        if (usuario.tipo === 'cliente' && Number(atual.id_cliente) !== Number(usuario.id)) {
            // Para o cliente, pedido de outro é tratado como inexistente.
            throw new ErroApi(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.');
        }
        if (!podeCancelar(atual, usuario)) {
            const limite = usuario.tipo === 'cliente' ? '"Aguardando Separação"' : '"Aguardando Separação" ou "Em Separação"';
            throw new ErroApi(409, 'CANCELAMENTO_NAO_PERMITIDO',
                `Este pedido está "${atual.status}" e só pode ser cancelado em ${limite}.`,
                { status_atual: atual.status });
        }

        const itens = await ItemPedido.findAll({ where: { id_pedido: atual.id_pedido }, transaction: transacao });
        const produtos = await Produto.findAll({
            where: { id_produto: { [Op.in]: itens.map((item) => item.id_produto) } },
            order: [['id_produto', 'ASC']],
            transaction: transacao,
            lock: transacao.LOCK.UPDATE
        });
        const produtosPorId = new Map(produtos.map((produto) => [produto.id_produto, produto]));
        for (const item of itens) {
            const produto = produtosPorId.get(item.id_produto);
            await alterarEstoque(produto, produto.quantidade_estoque + item.quantidade, {
                tipo: 'cancelamento',
                observacao: `Cancelamento do pedido #${atual.id_pedido}: ${motivo}`.slice(0, 500),
                idUsuario: usuario.id,
                idPedido: atual.id_pedido,
                transacao
            });
        }

        const anterior = atual.status;
        await atual.update({
            status: 'Cancelado',
            motivo_cancelamento: motivo,
            ...(usuario.tipo !== 'cliente' && { id_funcionario: usuario.id })
        }, { transaction: transacao });
        await registrarHistorico(atual, anterior, { idUsuario: usuario.id, observacao: motivo, transacao });
        return atual;
    });
    notificar(pedido);
    return pedido;
}

module.exports = {
    criarPedido,
    avancarStatus,
    cancelarPedido,
    podeCancelar,
    PROXIMO_STATUS
};
