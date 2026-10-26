const { Op } = require('sequelize');
const { Usuario, Produto, Pedido, ItemPedido, PedidoHistorico } = require('../models');
const { STATUS_PEDIDO } = require('../models/Pedido');
const { ErroApi } = require('../lib/erros');
const { ehEquipe } = require('../lib/perfis');
const { somenteDigitos } = require('../lib/cnpj');
const { apresentarCliente } = require('../lib/apresentacao');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const servicoPedidos = require('../servicos/pedidos');
const { disponibilidade } = require('../servicos/estoque');

const INCLUDE_ITENS = {
    model: ItemPedido,
    as: 'itens',
    attributes: ['id_produto', 'quantidade'],
    // Consulta separada: mantém a paginação correta (um pedido não vira várias linhas).
    separate: true,
    include: [{ model: Produto, as: 'produto', attributes: ['id_produto', 'sku', 'nome', 'imagem_url'] }]
};
const INCLUDE_CLIENTE = {
    model: Usuario,
    as: 'cliente',
    attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj', 'email', 'telefone']
};
const INCLUDE_FUNCIONARIO = {
    model: Usuario,
    as: 'funcionario',
    attributes: ['id_usuario', 'nome', 'cargo'],
    required: false
};

// Formato único de pedido nas respostas. Não há valores financeiros.
function apresentarPedido(pedido, usuario, { comHistorico = false } = {}) {
    const dados = {
        id_pedido: pedido.id_pedido,
        status: pedido.status,
        data_pedido: pedido.data_pedido,
        data_entrega_desejada: pedido.data_entrega_desejada,
        data_entrega: pedido.data_entrega,
        observacao: pedido.observacao,
        motivo_cancelamento: pedido.motivo_cancelamento,
        endereco_entrega: pedido.endereco_entrega,
        itens: (pedido.itens || []).map((item) => ({
            id_produto: item.id_produto,
            sku: item.produto ? item.produto.sku : null,
            nome: item.produto ? item.produto.nome : null,
            imagem_url: item.produto ? item.produto.imagem_url : null,
            quantidade: item.quantidade
        })),
        total_itens: (pedido.itens || []).reduce((soma, item) => soma + item.quantidade, 0),
        pode_cancelar: servicoPedidos.podeCancelar(pedido, usuario)
    };
    if (ehEquipe(usuario)) {
        dados.cliente = pedido.cliente ? apresentarCliente(pedido.cliente) : null;
        dados.funcionario = pedido.funcionario || null;
        dados.proximo_status = servicoPedidos.PROXIMO_STATUS[pedido.status] || null;
    }
    if (comHistorico) {
        dados.historico = (pedido.historico || []).map((registro) => ({
            status_anterior: registro.status_anterior,
            status_novo: registro.status_novo,
            observacao: registro.observacao,
            data: registro.criado_em,
            usuario: registro.usuario
                ? { id_usuario: registro.usuario.id_usuario, nome: registro.usuario.nome, tipo: registro.usuario.tipo }
                : null
        }));
    }
    return dados;
}

function lerIdPedido(valor) {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'Identificador de pedido inválido.');
    }
    return id;
}

function lerStatus(valor) {
    if (valor === undefined || valor === '') return null;
    const lista = String(valor).split(',').map((status) => status.trim());
    const invalido = lista.find((status) => !STATUS_PEDIDO.includes(status));
    if (invalido) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', `Status inválido: ${invalido}. Use: ${STATUS_PEDIDO.join(', ')}.`);
    }
    return lista;
}

// Período em datas locais (AAAA-MM-DD), inclusivo nas duas pontas.
function lerPeriodo(de, ate) {
    const condicao = {};
    const valida = (data) => /^\d{4}-\d{2}-\d{2}$/.test(data) && !Number.isNaN(Date.parse(`${data}T00:00:00-03:00`));
    if (de !== undefined) {
        if (!valida(de)) throw new ErroApi(400, 'FILTRO_INVALIDO', 'Use o formato AAAA-MM-DD em "de".');
        condicao[Op.gte] = new Date(`${de}T00:00:00-03:00`);
    }
    if (ate !== undefined) {
        if (!valida(ate)) throw new ErroApi(400, 'FILTRO_INVALIDO', 'Use o formato AAAA-MM-DD em "ate".');
        const fim = new Date(`${ate}T00:00:00-03:00`);
        fim.setUTCDate(fim.getUTCDate() + 1);
        condicao[Op.lt] = fim;
    }
    return Object.getOwnPropertySymbols(condicao).length > 0 ? condicao : null;
}

// POST /pedidos (cliente)
async function criarPedido(req, res) {
    const pedido = await servicoPedidos.criarPedido(req.usuario.id, req.body);
    const completo = await Pedido.findByPk(pedido.id_pedido, { include: [INCLUDE_ITENS] });
    return res.status(201).json({
        mensagem: 'Pedido criado com sucesso.',
        pedido: apresentarPedido(completo, req.usuario)
    });
}

/**
 * GET /pedidos (equipe). Filtros: status (vários separados por vírgula), id_cliente,
 * de/ate (data do pedido) e busca (número do pedido, nome, razão social, e-mail ou CNPJ do cliente).
 */
async function listarPedidos(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 20, limiteMaximo: 100 });
    const where = {};
    const status = lerStatus(req.query.status);
    if (status) where.status = { [Op.in]: status };
    if (req.query.id_cliente !== undefined) {
        const idCliente = Number(req.query.id_cliente);
        if (!Number.isSafeInteger(idCliente) || idCliente <= 0) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', 'id_cliente inválido.');
        }
        where.id_cliente = idCliente;
    }
    const periodo = lerPeriodo(req.query.de, req.query.ate);
    if (periodo) where.data_pedido = periodo;

    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 100) : '';
    if (busca) {
        const opcoes = [
            { '$cliente.nome$': { [Op.like]: `%${busca}%` } },
            { '$cliente.razao_social$': { [Op.like]: `%${busca}%` } },
            { '$cliente.email$': { [Op.like]: `%${busca}%` } }
        ];
        const digitos = somenteDigitos(busca);
        if (/^#?\d+$/.test(busca)) opcoes.push({ id_pedido: Number(digitos) });
        if (digitos.length >= 4) opcoes.push({ '$cliente.cnpj$': { [Op.like]: `%${digitos}%` } });
        where[Op.or] = opcoes;
    }

    const { rows, count } = await Pedido.findAndCountAll({
        where,
        include: [INCLUDE_CLIENTE, INCLUDE_FUNCIONARIO, INCLUDE_ITENS],
        order: [['data_pedido', 'DESC'], ['id_pedido', 'DESC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    return res.status(200).json({
        pedidos: rows.map((pedido) => apresentarPedido(pedido, req.usuario)),
        paginacao: montarPaginacao(count, paginacao)
    });
}

// GET /pedidos/meus (cliente): os pedidos do próprio cliente, mais recentes primeiro.
async function listarMeusPedidos(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 20, limiteMaximo: 100 });
    const where = { id_cliente: req.usuario.id };
    const status = lerStatus(req.query.status);
    if (status) where.status = { [Op.in]: status };

    const { rows, count } = await Pedido.findAndCountAll({
        where,
        include: [INCLUDE_ITENS],
        order: [['data_pedido', 'DESC'], ['id_pedido', 'DESC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    return res.status(200).json({
        pedidos: rows.map((pedido) => apresentarPedido(pedido, req.usuario)),
        paginacao: montarPaginacao(count, paginacao)
    });
}

// GET /pedidos/:id_pedido: equipe vê qualquer pedido; cliente só o próprio (o de outro aparece como inexistente).
async function obterPedido(req, res) {
    const idPedido = lerIdPedido(req.params.id_pedido);
    const pedido = await Pedido.findByPk(idPedido, {
        include: [
            INCLUDE_CLIENTE,
            INCLUDE_FUNCIONARIO,
            INCLUDE_ITENS,
            {
                model: PedidoHistorico,
                as: 'historico',
                separate: true,
                order: [['criado_em', 'ASC'], ['id_historico', 'ASC']],
                include: [{ model: Usuario, as: 'usuario', attributes: ['id_usuario', 'nome', 'tipo'] }]
            }
        ]
    });
    const ehDono = pedido && Number(pedido.id_cliente) === Number(req.usuario.id);
    if (!pedido || (!ehEquipe(req.usuario) && !ehDono)) {
        throw new ErroApi(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.');
    }
    return res.status(200).json({ pedido: apresentarPedido(pedido, req.usuario, { comHistorico: true }) });
}

// PUT/PATCH /pedidos/:id_pedido/status { status, observacao? } (equipe)
async function atualizarStatus(req, res) {
    const idPedido = lerIdPedido(req.params.id_pedido);
    const { status, observacao } = req.body || {};
    if (status === 'Cancelado') {
        throw new ErroApi(422, 'VALIDACAO', 'Para cancelar, use POST /pedidos/:id_pedido/cancelar com o motivo.');
    }
    if (!STATUS_PEDIDO.includes(status)) {
        throw new ErroApi(422, 'VALIDACAO', 'Status do pedido inválido.', [{ campo: 'status', mensagem: `Use: ${STATUS_PEDIDO.join(', ')}.` }]);
    }
    if (observacao !== undefined && observacao !== null && (typeof observacao !== 'string' || observacao.length > 500)) {
        throw new ErroApi(422, 'VALIDACAO', 'A observação deve ser um texto de até 500 caracteres.');
    }
    const pedido = await servicoPedidos.avancarStatus(idPedido, status, req.usuario, observacao ? observacao.trim() : null);
    return res.status(200).json({
        mensagem: 'Status do pedido atualizado.',
        pedido: {
            id_pedido: pedido.id_pedido,
            status: pedido.status,
            data_entrega: pedido.data_entrega,
            id_funcionario: pedido.id_funcionario
        }
    });
}

// POST /pedidos/:id_pedido/cancelar { motivo } (cliente dono ou equipe)
async function cancelarPedido(req, res) {
    const idPedido = lerIdPedido(req.params.id_pedido);
    const motivo = req.body && typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';
    if (motivo.length < 3 || motivo.length > 500) {
        throw new ErroApi(422, 'VALIDACAO', 'Informe o motivo do cancelamento (3 a 500 caracteres).',
            [{ campo: 'motivo', mensagem: 'Informe o motivo do cancelamento (3 a 500 caracteres).' }]);
    }
    const pedido = await servicoPedidos.cancelarPedido(idPedido, req.usuario, motivo);
    return res.status(200).json({
        mensagem: 'Pedido cancelado. O estoque dos itens foi devolvido.',
        pedido: { id_pedido: pedido.id_pedido, status: pedido.status, motivo_cancelamento: pedido.motivo_cancelamento }
    });
}

/**
 * GET /pedidos/:id_pedido/repetir (cliente dono): sugere os itens de um pedido anterior ajustados ao
 * catálogo de agora. Não reserva estoque; o checkout valida tudo de novo.
 * ajuste por item: null (igual ao anterior), ajustado_ao_multiplo, reduzido_ao_estoque, indisponivel ou produto_inativo.
 */
async function repetirPedido(req, res) {
    const idPedido = lerIdPedido(req.params.id_pedido);
    const pedido = await Pedido.findByPk(idPedido, {
        attributes: ['id_pedido', 'id_cliente'],
        include: [{
            model: ItemPedido,
            as: 'itens',
            attributes: ['id_produto', 'quantidade'],
            include: [{
                model: Produto,
                as: 'produto',
                attributes: ['id_produto', 'sku', 'nome', 'imagem_url', 'ativo', 'quantidade_estoque', 'estoque_minimo', 'multiplo_venda']
            }]
        }]
    });
    if (!pedido || Number(pedido.id_cliente) !== Number(req.usuario.id)) {
        throw new ErroApi(404, 'PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado.');
    }

    const itens = pedido.itens.map(({ quantidade: anterior, produto }) => {
        const multiplo = Math.max(produto.multiplo_venda, 1);
        // Múltiplo de venda pode ter mudado: arredonda para baixo, com no mínimo um múltiplo.
        const ajustada = Math.max(Math.floor(anterior / multiplo), 1) * multiplo;
        const maximoAgora = Math.floor(produto.quantidade_estoque / multiplo) * multiplo;
        let sugerida = Math.min(ajustada, maximoAgora);
        let ajuste = null;
        if (!produto.ativo) {
            sugerida = 0;
            ajuste = 'produto_inativo';
        } else if (maximoAgora === 0) {
            ajuste = 'indisponivel';
        } else if (sugerida < ajustada) {
            ajuste = 'reduzido_ao_estoque';
        } else if (ajustada !== anterior) {
            ajuste = 'ajustado_ao_multiplo';
        }
        return {
            id_produto: produto.id_produto,
            sku: produto.sku,
            nome: produto.nome,
            imagem_url: produto.imagem_url,
            multiplo_venda: multiplo,
            disponibilidade: produto.ativo ? disponibilidade(produto) : 'indisponivel',
            estoque: produto.quantidade_estoque,
            quantidade_anterior: anterior,
            quantidade_sugerida: sugerida,
            ajuste
        };
    });

    return res.status(200).json({
        id_pedido_origem: pedido.id_pedido,
        itens,
        // Pronto para enviar em POST /pedidos (só os itens com quantidade sugerida).
        itens_para_checkout: itens
            .filter((item) => item.quantidade_sugerida > 0)
            .map((item) => ({ id_produto: item.id_produto, quantidade: item.quantidade_sugerida })),
        itens_ajustados: itens.filter((item) => item.ajuste !== null).length
    });
}

module.exports = {
    criarPedido,
    listarPedidos,
    listarMeusPedidos,
    obterPedido,
    atualizarStatus,
    cancelarPedido,
    repetirPedido
};
