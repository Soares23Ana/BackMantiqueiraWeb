const { QueryTypes, Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Produto, Carrinho, Evento } = require('../models');
const configuracoes = require('./configuracoes');

const DIA = 24 * 60 * 60 * 1000;

// Eventos de uso do cliente que entram no histórico (a visita anônima não: ela não é do cliente).
const EVENTOS_DO_CLIENTE = ['produto_visto', 'carrinho_adicionar', 'checkout_iniciado', 'pedido_concluido'];

// Filtro tipo=... e a que grupo cada tipo de entrada pertence.
const TIPOS_FILTRO = ['cadastro', 'pedido', 'carrinho', 'acesso', 'nota'];

/**
 * Todas as fontes do histórico numa única consulta (UNION ALL), para ordenar e paginar no banco.
 * Colunas: tipo (grupo), subtipo, data, ref (id do registro de origem), a, b (textos) e n, m (números).
 * O texto final (título e detalhe) é montado em JS por montarEntrada.
 */
const FONTES = `
    SELECT 'cadastro' AS tipo, 'cadastro' AS subtipo, u.criado_em AS data, u.id_usuario AS ref,
           NULL AS a, NULL AS b, NULL AS n, NULL AS m
    FROM usuarios u WHERE u.id_usuario = :id

    UNION ALL
    SELECT 'pedido', 'pedido_criado', p.data_pedido, p.id_pedido,
           p.status, NULL,
           (SELECT COUNT(*) FROM itens_pedido i WHERE i.id_pedido = p.id_pedido),
           (SELECT COALESCE(SUM(i.quantidade), 0) FROM itens_pedido i WHERE i.id_pedido = p.id_pedido)
    FROM pedidos p WHERE p.id_cliente = :id

    UNION ALL
    SELECT 'pedido', IF(h.status_novo = 'Cancelado', 'pedido_cancelado', 'pedido_status'), h.criado_em, h.id_pedido,
           h.status_novo, h.observacao, NULL, NULL
    FROM pedido_historico h JOIN pedidos p ON p.id_pedido = h.id_pedido
    WHERE p.id_cliente = :id AND h.status_anterior IS NOT NULL

    UNION ALL
    SELECT 'carrinho', 'carrinho_atualizado', c.atualizado_em, c.id_carrinho,
           NULL, NULL, JSON_LENGTH(c.itens),
           (SELECT COALESCE(SUM(jt.quantidade), 0) FROM JSON_TABLE(c.itens, '$[*]' COLUMNS (quantidade INT PATH '$.quantidade')) jt)
    FROM carrinhos c WHERE c.id_usuario = :id AND JSON_LENGTH(c.itens) > 0

    UNION ALL
    SELECT 'carrinho', 'carrinho_abandonado', DATE_ADD(c.atualizado_em, INTERVAL :diasAbandono DAY), c.id_carrinho,
           NULL, NULL, :diasAbandono, NULL
    FROM carrinhos c
    WHERE c.id_usuario = :id AND JSON_LENGTH(c.itens) > 0 AND c.atualizado_em <= :corteAbandono
      AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.id_cliente = c.id_usuario AND p.data_pedido > c.atualizado_em)

    UNION ALL
    SELECT 'carrinho', 'carrinho_contato', k.criado_em, k.id_contato, k.observacao, f.nome, NULL, NULL
    FROM carrinho_contatos k LEFT JOIN usuarios f ON f.id_usuario = k.id_funcionario WHERE k.id_usuario = :id

    UNION ALL
    SELECT 'acesso', e.tipo, e.criado_em, COALESCE(e.id_produto, e.id_pedido), pr.nome, NULL, e.quantidade, NULL
    FROM eventos e LEFT JOIN produtos pr ON pr.id_produto = e.id_produto
    WHERE e.id_usuario = :id AND e.tipo IN (:eventos)

    UNION ALL
    SELECT 'nota', 'nota', n.criado_em, n.id_nota, n.texto, a.nome, NULL, NULL
    FROM notas_cliente n LEFT JOIN usuarios a ON a.id_usuario = n.id_autor WHERE n.id_cliente = :id`;

const plural = (n, singular, pluralTexto) => `${n} ${Number(n) === 1 ? singular : pluralTexto}`;

// Texto final de uma entrada do histórico.
function montarEntrada(linha) {
    const base = { tipo: linha.tipo, data: linha.data };
    switch (linha.subtipo) {
        case 'cadastro':
            return { ...base, titulo: 'Cadastro criado', detalhe: null, referencia: { tipo: 'cliente', id: linha.ref } };
        case 'pedido_criado':
            return {
                ...base,
                titulo: `Pedido #${linha.ref} feito`,
                detalhe: `${plural(linha.n, 'item', 'itens')}, ${plural(linha.m, 'unidade', 'unidades')}.`,
                referencia: { tipo: 'pedido', id: linha.ref }
            };
        case 'pedido_status':
            return {
                ...base,
                titulo: `Pedido #${linha.ref}: ${linha.a}`,
                detalhe: linha.b || null,
                referencia: { tipo: 'pedido', id: linha.ref }
            };
        case 'pedido_cancelado':
            return {
                ...base,
                titulo: `Pedido #${linha.ref} cancelado`,
                detalhe: linha.b ? `Motivo: ${linha.b}` : null,
                referencia: { tipo: 'pedido', id: linha.ref }
            };
        case 'carrinho_atualizado':
            return {
                ...base,
                titulo: 'Carrinho atualizado',
                detalhe: `${plural(linha.n, 'item', 'itens')}, ${plural(linha.m, 'unidade', 'unidades')}.`,
                referencia: { tipo: 'carrinho', id: linha.ref }
            };
        case 'carrinho_abandonado':
            return {
                ...base,
                titulo: 'Carrinho abandonado',
                detalhe: `Parado há ${plural(linha.n, 'dia', 'dias')} ou mais, sem pedido.`,
                referencia: { tipo: 'carrinho', id: linha.ref }
            };
        case 'carrinho_contato':
            return {
                ...base,
                titulo: 'Contato sobre o carrinho abandonado',
                detalhe: [linha.b && `Por ${linha.b}.`, linha.a].filter(Boolean).join(' ') || null,
                referencia: { tipo: 'carrinho_contato', id: linha.ref }
            };
        case 'produto_visto':
            return { ...base, titulo: 'Viu um produto', detalhe: linha.a, referencia: { tipo: 'produto', id: linha.ref } };
        case 'carrinho_adicionar':
            return {
                ...base,
                titulo: 'Adicionou ao carrinho',
                detalhe: [linha.a, linha.n && `${linha.n} un.`].filter(Boolean).join(' — ') || null,
                referencia: { tipo: 'produto', id: linha.ref }
            };
        case 'checkout_iniciado':
            return { ...base, titulo: 'Iniciou o checkout', detalhe: null, referencia: null };
        case 'pedido_concluido':
            return {
                ...base,
                titulo: `Concluiu o pedido${linha.ref ? ` #${linha.ref}` : ''}`,
                detalhe: null,
                referencia: linha.ref ? { tipo: 'pedido', id: linha.ref } : null
            };
        default: // nota
            return {
                ...base,
                titulo: `Nota${linha.b ? ` de ${linha.b}` : ''}`,
                detalhe: linha.a,
                referencia: { tipo: 'nota', id: linha.ref }
            };
    }
}

/**
 * Histórico do cliente, do mais recente para o mais antigo: cadastro, pedidos (criação, mudanças de status e
 * cancelamentos), carrinho (última atualização, abandono e contatos), acessos (eventos do cliente) e notas.
 * Filtros: tipo (um dos TIPOS_FILTRO), de e ate (datas já convertidas em Date; ate é exclusivo).
 */
async function listarHistorico(idCliente, { tipo, de, ate, limite, offset }) {
    const dias = await configuracoes.obterNumero('carrinho_abandonado_dias');
    const replacements = {
        id: idCliente,
        eventos: EVENTOS_DO_CLIENTE,
        diasAbandono: dias,
        corteAbandono: new Date(Date.now() - dias * DIA)
    };
    const filtros = [];
    if (tipo) {
        filtros.push('h.tipo = :tipo');
        replacements.tipo = tipo;
    }
    if (de) {
        filtros.push('h.data >= :de');
        replacements.de = de;
    }
    if (ate) {
        filtros.push('h.data < :ate');
        replacements.ate = ate;
    }
    const where = filtros.length > 0 ? `WHERE ${filtros.join(' AND ')}` : '';
    // Entradas do mesmo instante: ordem estável pelo subtipo e pelo registro de origem.
    const [linhas, [contagem]] = await Promise.all([
        sequelize.query(`SELECT h.* FROM (${FONTES}) h ${where} ORDER BY h.data DESC, h.subtipo ASC, h.ref DESC LIMIT :limite OFFSET :offset`,
            { replacements: { ...replacements, limite, offset }, type: QueryTypes.SELECT }),
        sequelize.query(`SELECT COUNT(*) AS total FROM (${FONTES}) h ${where}`, { replacements, type: QueryTypes.SELECT })
    ]);
    return { entradas: linhas.map(montarEntrada), total: Number(contagem.total) };
}

/**
 * Carrinho atual do cliente para o GET /clientes/:id/detalhes: itens, última atualização, se está abandonado
 * (mesma regra de GET /carrinhos-abandonados) e o último contato da equipe depois dessa atualização.
 */
async function obterCarrinhoAtual(idCliente) {
    const carrinho = await Carrinho.findOne({ where: { id_usuario: idCliente } });
    if (!carrinho || carrinho.itens.length === 0) return null;
    const dias = await configuracoes.obterNumero('carrinho_abandonado_dias');
    const produtos = await Produto.findAll({
        where: { id_produto: { [Op.in]: carrinho.itens.map((item) => item.id_produto) } },
        attributes: ['id_produto', 'sku', 'nome']
    });
    const porId = new Map(produtos.map((produto) => [produto.id_produto, produto]));
    const [{ pedidos }] = await sequelize.query(
        'SELECT COUNT(*) AS pedidos FROM pedidos WHERE id_cliente = :id AND data_pedido > :atualizado',
        { replacements: { id: idCliente, atualizado: carrinho.atualizado_em }, type: QueryTypes.SELECT }
    );
    const diasParado = Math.floor((Date.now() - carrinho.atualizado_em.getTime()) / DIA);
    const [contato] = await sequelize.query(
        'SELECT MAX(criado_em) AS contatado_em FROM carrinho_contatos WHERE id_usuario = :id AND criado_em >= :atualizado',
        { replacements: { id: idCliente, atualizado: carrinho.atualizado_em }, type: QueryTypes.SELECT }
    );
    return {
        itens: carrinho.itens.filter((item) => porId.has(item.id_produto)).map((item) => ({
            id_produto: item.id_produto,
            sku: porId.get(item.id_produto).sku,
            nome: porId.get(item.id_produto).nome,
            quantidade: item.quantidade
        })),
        total_unidades: carrinho.itens.reduce((soma, item) => soma + item.quantidade, 0),
        ultimo_movimento_em: carrinho.atualizado_em,
        dias_parado: diasParado,
        abandonado: diasParado >= dias && Number(pedidos) === 0,
        contatado_em: contato.contatado_em
    };
}

// Data e hora do último evento de uso (qualquer tipo) do cliente, ou null.
async function ultimoEventoEm(idCliente) {
    const ultimo = await Evento.max('criado_em', { where: { id_usuario: idCliente } });
    return ultimo || null;
}

module.exports = { listarHistorico, obterCarrinhoAtual, ultimoEventoEm, TIPOS_FILTRO };
