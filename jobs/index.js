const cron = require('node-cron');
const config = require('../config/ambiente');
const logger = require('../lib/logger');
const { executarComTrava } = require('../lib/travaMysql');
const { processarPastaComTrava } = require('../servicos/sincronizacao');

const FUSO = 'America/Sao_Paulo';

// Jobs agendados. Cada execução segura uma trava do MySQL: com várias instâncias da API, só uma roda.
const DEFINICOES = [
    {
        nome: 'carga-completa',
        expressao: '0 0 * * *',
        descricao: 'Meia-noite: importa importacao/entrada/catalogo*.csv e desativa produtos ausentes.',
        executar: () => processarPastaComTrava('carga_completa')
    },
    {
        nome: 'estoque',
        expressao: '*/30 * * * *',
        descricao: 'A cada 30 min: importa importacao/entrada/estoque*.csv (só as colunas sku e estoque).',
        executar: () => processarPastaComTrava('estoque')
    }
];

const estados = new Map();
const tarefas = [];

async function rodar(definicao) {
    const estado = estados.get(definicao.nome);
    const inicio = new Date();
    try {
        const { executado, resultado } = await executarComTrava(`mantiqueira:job:${definicao.nome}`, definicao.executar);
        Object.assign(estado, {
            ultima_execucao: inicio,
            ultimo_resultado: executado ? resultado : { ignorado: 'executando em outra instância' },
            ultimo_erro: null
        });
    } catch (erro) {
        logger.error('Falha no job.', { job: definicao.nome, erro });
        Object.assign(estado, { ultima_execucao: inicio, ultimo_resultado: null, ultimo_erro: erro.message });
    }
}

function iniciarJobs() {
    if (!config.jobs.ativos) {
        logger.info('Jobs agendados desligados (JOBS_ATIVOS=false).');
        return;
    }
    for (const definicao of DEFINICOES) {
        estados.set(definicao.nome, { ultima_execucao: null, ultimo_resultado: null, ultimo_erro: null });
        const tarefa = cron.schedule(definicao.expressao, () => rodar(definicao), {
            name: definicao.nome,
            timezone: FUSO,
            noOverlap: true
        });
        tarefas.push({ definicao, tarefa });
    }
    logger.info('Jobs agendados iniciados.', { jobs: DEFINICOES.map((d) => `${d.nome} (${d.expressao})`), fuso: FUSO });
}

async function pararJobs() {
    await Promise.all(tarefas.map(({ tarefa }) => tarefa.stop()));
}

// Situação dos jobs para o /saude/detalhado.
function situacaoJobs() {
    return DEFINICOES.map((definicao) => {
        const agendada = tarefas.find((item) => item.definicao === definicao);
        return {
            nome: definicao.nome,
            descricao: definicao.descricao,
            expressao: definicao.expressao,
            fuso: FUSO,
            ativo: Boolean(agendada),
            proxima_execucao: agendada ? agendada.tarefa.getNextRun() : null,
            ...(estados.get(definicao.nome) || { ultima_execucao: null, ultimo_resultado: null, ultimo_erro: null })
        };
    });
}

module.exports = { iniciarJobs, pararJobs, situacaoJobs, DEFINICOES };
