const { QueryTypes } = require('sequelize');
const sequelize = require('../db/conn');
const { TIPOS_EVENTO } = require('../models/Evento');
const { STATUS_PEDIDO } = require('../models/Pedido');
const { ErroApi } = require('../lib/erros');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { apresentarCliente } = require('../lib/apresentacao');

const DIA = 24 * 60 * 60 * 1000;
const consultar = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

function hojeEmSaoPaulo() {
    return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Período das métricas em datas locais (AAAA-MM-DD), inclusivo nas pontas.
 * Padrão: últimos 30 dias, incluindo hoje. Máximo: 366 dias.
 */
function lerPeriodo(query) {
    const formato = /^\d{4}-\d{2}-\d{2}$/;
    const ate = query.ate || hojeEmSaoPaulo();
    const de = query.de || new Date(Date.parse(`${ate}T12:00:00Z`) - 29 * DIA).toISOString().slice(0, 10);
    const inicio = new Date(`${de}T00:00:00-03:00`);
    const fim = new Date(Date.parse(`${ate}T00:00:00-03:00`) + DIA);
    if (!formato.test(de) || !formato.test(ate) || Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', 'Use o formato AAAA-MM-DD em "de" e "ate".');
    }
    if (fim <= inicio || fim - inicio > 366 * DIA) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', 'O período deve ter de 1 a 366 dias, com "de" antes de "ate".');
    }
    return { de, ate, inicio, fim };
}

function lerLimite(valor, padrao = 10, maximo = 50) {
    const limite = valor === undefined ? padrao : Number(valor);
    if (!Number.isSafeInteger(limite) || limite < 1 || limite > maximo) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', `limite deve ser um inteiro de 1 a ${maximo}.`);
    }
    return limite;
}

// GET /metricas/resumo?de=&ate=
async function resumo(req, res) {
    const periodo = lerPeriodo(req.query);
    const intervalo = { inicio: periodo.inicio, fim: periodo.fim };
    const [porStatus, [vendas], porTipo] = await Promise.all([
        consultar(`SELECT status, COUNT(*) AS total FROM pedidos
                   WHERE data_pedido >= :inicio AND data_pedido < :fim GROUP BY status`, intervalo),
        consultar(`SELECT COALESCE(SUM(i.quantidade), 0) AS unidades, COUNT(DISTINCT p.id_cliente) AS clientes
                   FROM pedidos p JOIN itens_pedido i ON i.id_pedido = p.id_pedido
                   WHERE p.data_pedido >= :inicio AND p.data_pedido < :fim AND p.status <> 'Cancelado'`, intervalo),
        consultar(`SELECT tipo, COUNT(*) AS total FROM eventos
                   WHERE criado_em >= :inicio AND criado_em < :fim GROUP BY tipo`, intervalo)
    ]);
    const statusContados = Object.fromEntries(STATUS_PEDIDO.map((status) => [status, 0]));
    for (const linha of porStatus) statusContados[linha.status] = Number(linha.total);
    const eventos = Object.fromEntries(TIPOS_EVENTO.map((tipo) => [tipo, 0]));
    for (const linha of porTipo) eventos[linha.tipo] = Number(linha.total);

    return res.status(200).json({
        periodo: { de: periodo.de, ate: periodo.ate },
        pedidos: {
            total: Object.values(statusContados).reduce((soma, total) => soma + total, 0),
            por_status: statusContados
        },
        // Unidades e clientes consideram só pedidos não cancelados.
        unidades_pedidas: Number(vendas.unidades),
        clientes_que_compraram: Number(vendas.clientes),
        eventos
    });
}

// GET /metricas/buscas?de=&ate=&limite=10: termos mais buscados e buscas sem resultado.
async function buscas(req, res) {
    const periodo = lerPeriodo(req.query);
    const limite = lerLimite(req.query.limite);
    const parametros = { inicio: periodo.inicio, fim: periodo.fim, limite };
    const [maisBuscadas, semResultado] = await Promise.all([
        consultar(`SELECT termo, COUNT(*) AS total, SUM(tipo = 'busca_sem_resultado') AS sem_resultado
                   FROM eventos
                   WHERE tipo IN ('busca', 'busca_sem_resultado') AND criado_em >= :inicio AND criado_em < :fim
                   GROUP BY termo ORDER BY total DESC, termo ASC LIMIT :limite`, parametros),
        consultar(`SELECT termo, COUNT(*) AS total, MAX(criado_em) AS ultima_vez
                   FROM eventos
                   WHERE tipo = 'busca_sem_resultado' AND criado_em >= :inicio AND criado_em < :fim
                   GROUP BY termo ORDER BY total DESC, termo ASC LIMIT :limite`, parametros)
    ]);
    return res.status(200).json({
        periodo: { de: periodo.de, ate: periodo.ate },
        mais_buscadas: maisBuscadas.map((linha) => ({
            termo: linha.termo,
            total: Number(linha.total),
            sem_resultado: Number(linha.sem_resultado)
        })),
        sem_resultado: semResultado.map((linha) => ({ termo: linha.termo, total: Number(linha.total), ultima_vez: linha.ultima_vez }))
    });
}

// GET /metricas/produtos-mais-pedidos?de=&ate=&limite=10: em unidades, sem pedidos cancelados.
async function produtosMaisPedidos(req, res) {
    const periodo = lerPeriodo(req.query);
    const limite = lerLimite(req.query.limite);
    const linhas = await consultar(`
        SELECT pr.id_produto, pr.sku, pr.nome, SUM(i.quantidade) AS unidades, COUNT(DISTINCT p.id_pedido) AS pedidos
        FROM itens_pedido i
        JOIN pedidos p ON p.id_pedido = i.id_pedido
        JOIN produtos pr ON pr.id_produto = i.id_produto
        WHERE p.data_pedido >= :inicio AND p.data_pedido < :fim AND p.status <> 'Cancelado'
        GROUP BY pr.id_produto, pr.sku, pr.nome
        ORDER BY unidades DESC, pr.nome ASC
        LIMIT :limite`, { inicio: periodo.inicio, fim: periodo.fim, limite });
    return res.status(200).json({
        periodo: { de: periodo.de, ate: periodo.ate },
        produtos: linhas.map((linha) => ({ ...linha, unidades: Number(linha.unidades), pedidos: Number(linha.pedidos) }))
    });
}

/**
 * GET /metricas/clientes-inativos?dias=60&pagina=: clientes ativos sem pedido (não cancelado) nos últimos
 * X dias, incluindo quem nunca comprou. Os que estão há mais tempo sem comprar vêm primeiro.
 */
async function clientesInativos(req, res) {
    const dias = req.query.dias === undefined ? 60 : Number(req.query.dias);
    if (!Number.isSafeInteger(dias) || dias < 1 || dias > 730) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', 'dias deve ser um inteiro de 1 a 730.');
    }
    const paginacao = lerPaginacao(req.query, { limitePadrao: 20, limiteMaximo: 100 });
    const corte = new Date(Date.now() - dias * DIA);
    const base = `
        SELECT u.id_usuario, u.nome, u.razao_social, u.cnpj, u.email, u.telefone, u.criado_em,
               MAX(p.data_pedido) AS ultimo_pedido_em, COUNT(p.id_pedido) AS total_pedidos
        FROM usuarios u
        LEFT JOIN pedidos p ON p.id_cliente = u.id_usuario AND p.status <> 'Cancelado'
        WHERE u.tipo = 'cliente' AND u.ativo = TRUE
        GROUP BY u.id_usuario
        HAVING ultimo_pedido_em IS NULL OR ultimo_pedido_em < :corte`;
    const [[{ total }], linhas] = await Promise.all([
        consultar(`SELECT COUNT(*) AS total FROM (${base}) AS inativos`, { corte }),
        consultar(`${base} ORDER BY ultimo_pedido_em IS NOT NULL, ultimo_pedido_em ASC, u.nome ASC
                   LIMIT :limite OFFSET :offset`, { corte, limite: paginacao.limite, offset: paginacao.offset })
    ]);
    return res.status(200).json({
        dias,
        clientes: linhas.map((linha) => ({ ...apresentarCliente(linha), total_pedidos: Number(linha.total_pedidos) })),
        paginacao: montarPaginacao(Number(total), paginacao)
    });
}

// Quem fez o evento: o usuário logado ou, para visitantes, a "sessao" enviada pelo front.
// Eventos sem nenhum dos dois ficam de fora das contagens de sessões.
const SESSAO_SQL = `CASE WHEN e.id_usuario IS NOT NULL THEN CONCAT('u', e.id_usuario)
                         WHEN e.sessao IS NOT NULL THEN CONCAT('s', e.sessao) END`;
const ETAPAS_FUNIL = ['produto_visto', 'carrinho_adicionar', 'checkout_iniciado', 'pedido_concluido'];

const taxa = (parte, todo) => (todo > 0 ? Math.round((parte / todo) * 10000) / 10000 : null);

/**
 * GET /metricas/funil?de=&ate=: sessões distintas em cada etapa e a taxa em relação à etapa anterior.
 * Cada etapa é contada sozinha no período (não exige que a mesma sessão tenha passado pelas anteriores).
 */
async function funil(req, res) {
    const periodo = lerPeriodo(req.query);
    const linhas = await consultar(`
        SELECT e.tipo, COUNT(DISTINCT ${SESSAO_SQL}) AS sessoes FROM eventos e
        WHERE e.tipo IN (:etapas) AND e.criado_em >= :inicio AND e.criado_em < :fim
        GROUP BY e.tipo`, { etapas: ETAPAS_FUNIL, inicio: periodo.inicio, fim: periodo.fim });
    const porTipo = Object.fromEntries(linhas.map((linha) => [linha.tipo, Number(linha.sessoes)]));
    const etapas = ETAPAS_FUNIL.map((etapa, indice) => {
        const sessoes = porTipo[etapa] || 0;
        const anterior = indice > 0 ? porTipo[ETAPAS_FUNIL[indice - 1]] || 0 : 0;
        return { etapa, sessoes, taxa_da_anterior: indice > 0 ? taxa(sessoes, anterior) : null };
    });
    return res.status(200).json({ periodo: { de: periodo.de, ate: periodo.ate }, etapas });
}

// GET /metricas/produtos-vistos?de=&ate=&limite=10: produtos mais abertos (visualizações e sessões distintas).
async function produtosVistos(req, res) {
    const periodo = lerPeriodo(req.query);
    const limite = lerLimite(req.query.limite);
    const linhas = await consultar(`
        SELECT e.id_produto, pr.sku, pr.nome, COUNT(*) AS visualizacoes, COUNT(DISTINCT ${SESSAO_SQL}) AS sessoes
        FROM eventos e
        LEFT JOIN produtos pr ON pr.id_produto = e.id_produto
        WHERE e.tipo = 'produto_visto' AND e.criado_em >= :inicio AND e.criado_em < :fim
        GROUP BY e.id_produto, pr.sku, pr.nome
        ORDER BY visualizacoes DESC, e.id_produto ASC
        LIMIT :limite`, { inicio: periodo.inicio, fim: periodo.fim, limite });
    return res.status(200).json({
        periodo: { de: periodo.de, ate: periodo.ate },
        produtos: linhas.map((linha) => ({
            id_produto: linha.id_produto,
            sku: linha.sku,
            nome: linha.nome,
            visualizacoes: Number(linha.visualizacoes),
            sessoes: Number(linha.sessoes)
        }))
    });
}

// Cliques de um tipo agrupados pelo item clicado. "coluna" e "tabela" vêm só do código, nunca da requisição.
function contarCliques(tipo, coluna, tabela, periodo) {
    return consultar(`
        SELECT e.${coluna} AS id, x.titulo, COUNT(*) AS cliques, COUNT(DISTINCT ${SESSAO_SQL}) AS sessoes
        FROM eventos e
        LEFT JOIN ${tabela} x ON x.${coluna} = e.${coluna}
        WHERE e.tipo = :tipo AND e.criado_em >= :inicio AND e.criado_em < :fim
        GROUP BY e.${coluna}, x.titulo
        ORDER BY cliques DESC, e.${coluna} ASC`, { tipo, inicio: periodo.inicio, fim: periodo.fim });
}

// GET /metricas/banners-campanhas?de=&ate=: cliques por banner e por campanha (só os que tiveram clique).
async function bannersCampanhas(req, res) {
    const periodo = lerPeriodo(req.query);
    const [banners, campanhas] = await Promise.all([
        contarCliques('banner_clique', 'id_banner', 'conteudo_cms', periodo),
        contarCliques('campanha_clique', 'id_campanha', 'campanhas', periodo)
    ]);
    const apresentar = (chave) => (linha) => ({
        [chave]: linha.id, titulo: linha.titulo, cliques: Number(linha.cliques), sessoes: Number(linha.sessoes)
    });
    return res.status(200).json({
        periodo: { de: periodo.de, ate: periodo.ate },
        banners: banners.map(apresentar('id_banner')),
        campanhas: campanhas.map(apresentar('id_campanha'))
    });
}

// GET /metricas/pedidos-por-dia?de=&ate=: todos os dias do período, inclusive os sem pedido.
async function pedidosPorDia(req, res) {
    const periodo = lerPeriodo(req.query);
    const linhas = await consultar(`
        SELECT DATE_FORMAT(data_pedido, '%Y-%m-%d') AS dia, COUNT(*) AS total, SUM(status = 'Cancelado') AS cancelados
        FROM pedidos
        WHERE data_pedido >= :inicio AND data_pedido < :fim
        GROUP BY dia`, { inicio: periodo.inicio, fim: periodo.fim });
    const porDia = new Map(linhas.map((linha) => [linha.dia, linha]));
    const dias = [];
    for (let data = periodo.de; data <= periodo.ate;
        data = new Date(Date.parse(`${data}T12:00:00Z`) + DIA).toISOString().slice(0, 10)) {
        const linha = porDia.get(data);
        dias.push({ data, total: linha ? Number(linha.total) : 0, cancelados: linha ? Number(linha.cancelados) : 0 });
    }
    return res.status(200).json({ periodo: { de: periodo.de, ate: periodo.ate }, dias });
}

/**
 * GET /metricas/ciclo-pedido?de=&ate=: tempo médio entre cada etapa do fluxo, pelo pedido_historico,
 * para os pedidos feitos no período. Cada etapa considera só os pedidos que já passaram pelas duas pontas.
 */
async function cicloPedido(req, res) {
    const periodo = lerPeriodo(req.query);
    const [linha] = await consultar(`
        SELECT
            COUNT(TIMESTAMPDIFF(SECOND, aguardando, separacao)) AS n1, AVG(TIMESTAMPDIFF(SECOND, aguardando, separacao)) AS s1,
            COUNT(TIMESTAMPDIFF(SECOND, separacao, saiu)) AS n2, AVG(TIMESTAMPDIFF(SECOND, separacao, saiu)) AS s2,
            COUNT(TIMESTAMPDIFF(SECOND, saiu, entregue)) AS n3, AVG(TIMESTAMPDIFF(SECOND, saiu, entregue)) AS s3
        FROM (
            SELECT h.id_pedido,
                MIN(CASE WHEN h.status_novo = 'Aguardando Separação' THEN h.criado_em END) AS aguardando,
                MIN(CASE WHEN h.status_novo = 'Em Separação' THEN h.criado_em END) AS separacao,
                MIN(CASE WHEN h.status_novo = 'Saiu para Entrega' THEN h.criado_em END) AS saiu,
                MIN(CASE WHEN h.status_novo = 'Entregue' THEN h.criado_em END) AS entregue
            FROM pedido_historico h
            JOIN pedidos p ON p.id_pedido = h.id_pedido
            WHERE p.data_pedido >= :inicio AND p.data_pedido < :fim
            GROUP BY h.id_pedido
        ) AS tempos`, { inicio: periodo.inicio, fim: periodo.fim });
    const etapa = (de, para, pedidos, segundos) => ({
        de,
        para,
        pedidos: Number(pedidos),
        media_minutos: Number(pedidos) > 0 ? Math.round(Number(segundos) / 6) / 10 : null
    });
    return res.status(200).json({
        periodo: { de: periodo.de, ate: periodo.ate },
        etapas: [
            etapa('Aguardando Separação', 'Em Separação', linha.n1, linha.s1),
            etapa('Em Separação', 'Saiu para Entrega', linha.n2, linha.s2),
            etapa('Saiu para Entrega', 'Entregue', linha.n3, linha.s3)
        ]
    });
}

module.exports = {
    resumo, buscas, produtosMaisPedidos, clientesInativos,
    funil, produtosVistos, bannersCampanhas, pedidosPorDia, cicloPedido
};
