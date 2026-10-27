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

module.exports = { resumo, buscas, produtosMaisPedidos, clientesInativos };
