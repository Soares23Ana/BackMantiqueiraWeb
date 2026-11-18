const cron = require('node-cron');
const config = require('../config/ambiente');
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');
const { executarComTrava } = require('../lib/travaMysql');
const { processarPastaComTrava } = require('../servicos/sincronizacao');
const { limparEventosAntigos } = require('../servicos/eventos');
const { limparRedefinicoesAntigas } = require('../servicos/redefinicaoSenha');

const FUSO = 'America/Sao_Paulo';
// Quantas falhas seguidas (ou intervalos sem rodar) deixam o status geral como "degradado".
const FALHAS_PARA_DEGRADAR = 2;
const INTERVALOS_PARA_ATRASO = 2;

const ATRASO_RETRY_PADRAO_MS = 60 * 1000;
let atrasoRetryMs = ATRASO_RETRY_PADRAO_MS;

// Jobs agendados. Cada execução segura uma trava do MySQL: com várias instâncias da API, só uma roda.
// As expressões de catalogo, carga-completa e estoque vêm do ambiente (JOB_*_CRON), validadas ao iniciar.
const DEFINICOES = [
    {
        nome: 'catalogo',
        expressao: config.jobs.cron.catalogo,
        descricao: 'De hora em hora: importa importacao/entrada/catalogo*.csv (ou .xlsx), sem desativar produtos ausentes.',
        executar: () => processarPastaComTrava('catalogo')
    },
    {
        nome: 'carga-completa',
        expressao: config.jobs.cron.cargaCompleta,
        descricao: 'Meia-noite: importa importacao/entrada/carga_completa*.csv (ou .xlsx) e desativa os produtos ausentes (só se o arquivo não tiver erro).',
        executar: () => processarPastaComTrava('carga_completa')
    },
    {
        nome: 'estoque',
        expressao: config.jobs.cron.estoque,
        descricao: 'A cada 30 min: importa importacao/entrada/estoque*.csv (ou .xlsx), só as colunas sku e estoque.',
        executar: () => processarPastaComTrava('estoque')
    },
    {
        nome: 'limpeza-eventos',
        expressao: '0 3 * * *',
        descricao: '3h: apaga eventos de uso com mais de 12 meses e links de redefinição de senha expirados ou usados há mais de 7 dias; pedidos de nova senha pendentes há mais de 7 dias viram expirados e os resolvidos há mais de 30 dias são apagados.',
        executar: async () => ({ ...(await limparEventosAntigos()), redefinicoes_senha: await limparRedefinicoesAntigas() })
    }
];

const estadoInicial = () => ({
    ultima_execucao: null,
    ultimo_status: null,
    ultima_duracao_ms: null,
    ultimo_resultado: null,
    ultimo_erro: null,
    falhas_seguidas: 0,
    nova_tentativa_em: null
});
const estados = new Map(DEFINICOES.map((definicao) => [definicao.nome, estadoInicial()]));
const tarefas = [];
const retentativas = new Map();
let iniciadoEm = null;

// Falha que costuma passar sozinha (banco fora do ar por instantes, deadlock): vale uma nova tentativa.
const CODIGOS_TRANSITORIOS = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'PROTOCOL_CONNECTION_LOST',
    'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ER_CON_COUNT_ERROR'];
function falhaTransitoria(erro) {
    const original = (erro && (erro.original || erro.parent)) || erro;
    return Boolean(erro && (
        ['SequelizeConnectionError', 'SequelizeConnectionRefusedError', 'SequelizeConnectionTimedOutError',
            'SequelizeHostNotReachableError', 'SequelizeConnectionAcquireTimeoutError'].includes(erro.name) ||
        CODIGOS_TRANSITORIOS.includes(original && original.code) || CODIGOS_TRANSITORIOS.includes(erro.code)
    ));
}

function buscarDefinicao(nome) {
    return DEFINICOES.find((definicao) => definicao.nome === nome) || null;
}

/**
 * Uma tentativa do job, segurando a trava do MySQL. Devolve { executado, resultado }; lança em caso de falha.
 */
function tentar(definicao) {
    return executarComTrava(`mantiqueira:job:${definicao.nome}`, definicao.executar);
}

function registrarSucesso(estado, inicio, { executado, resultado }) {
    Object.assign(estado, {
        ultima_execucao: inicio,
        ultimo_status: executado ? 'sucesso' : 'ignorado',
        ultima_duracao_ms: Date.now() - inicio.getTime(),
        ultimo_resultado: executado ? resultado : { ignorado: 'executando em outra instância' },
        ultimo_erro: null,
        nova_tentativa_em: null
    });
    // "Ignorado" (outra instância está rodando) não é falha nem cura uma falha: só o sucesso zera a contagem.
    if (executado) estado.falhas_seguidas = 0;
}

function registrarFalha(estado, inicio, erro) {
    Object.assign(estado, {
        ultima_execucao: inicio,
        ultimo_status: 'falha',
        ultima_duracao_ms: Date.now() - inicio.getTime(),
        ultimo_resultado: null,
        ultimo_erro: erro.message,
        nova_tentativa_em: null,
        falhas_seguidas: estado.falhas_seguidas + 1
    });
}

// Execução agendada. Em falha transitória, tenta uma vez mais depois de 1 minuto; só então conta como falha.
async function rodar(definicao, { retentativa = false } = {}) {
    const estado = estados.get(definicao.nome);
    const inicio = new Date();
    try {
        registrarSucesso(estado, inicio, await tentar(definicao));
    } catch (erro) {
        logger.error('Falha no job.', { job: definicao.nome, retentativa, erro });
        if (!retentativa && falhaTransitoria(erro)) {
            const quando = new Date(Date.now() + atrasoRetryMs);
            Object.assign(estado, { ultimo_erro: erro.message, nova_tentativa_em: quando });
            const temporizador = setTimeout(() => {
                retentativas.delete(definicao.nome);
                rodar(definicao, { retentativa: true });
            }, atrasoRetryMs);
            temporizador.unref();
            retentativas.set(definicao.nome, temporizador);
            logger.warn('Nova tentativa do job agendada.', { job: definicao.nome, em: quando.toISOString() });
            return;
        }
        registrarFalha(estado, inicio, erro);
    }
}

/**
 * POST /admin/jobs/:nome/executar: roda o job agora (mesma trava do agendamento) e devolve o relatório.
 * Não faz nova tentativa automática; falhas viram erro 500 e contam nas falhas seguidas do job.
 */
async function executarAgora(nome) {
    const definicao = buscarDefinicao(nome);
    if (!definicao) {
        throw new ErroApi(404, 'JOB_NAO_ENCONTRADO', `Job desconhecido: ${nome}.`);
    }
    const estado = estados.get(nome);
    const inicio = new Date();
    let tentativa;
    try {
        tentativa = await tentar(definicao);
    } catch (erro) {
        logger.error('Falha ao executar o job manualmente.', { job: nome, erro });
        registrarFalha(estado, inicio, erro);
        throw new ErroApi(500, 'JOB_FALHOU', 'O job falhou. Informe o request_id ao suporte para achar o log.');
    }
    if (!tentativa.executado) {
        throw new ErroApi(409, 'JOB_EM_EXECUCAO', 'Este job já está em execução. Tente novamente em instantes.');
    }
    registrarSucesso(estado, inicio, tentativa);
    return {
        job: nome,
        iniciado_em: inicio,
        duracao_ms: estado.ultima_duracao_ms,
        resultado: tentativa.resultado
    };
}

function iniciarJobs() {
    if (!config.jobs.ativos) {
        logger.info('Jobs agendados desligados (JOBS_ATIVOS=false).');
        return;
    }
    iniciadoEm = new Date();
    for (const definicao of DEFINICOES) {
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
    for (const temporizador of retentativas.values()) clearTimeout(temporizador);
    retentativas.clear();
    await Promise.all(tarefas.map(({ tarefa }) => tarefa.stop()));
}

// Intervalo entre duas execuções seguidas da expressão, em ms (usado para saber se o job está atrasado).
function intervaloMs(expressao) {
    const [primeira, segunda] = cron.createTask(expressao, () => {}, { timezone: FUSO }).getNextRuns(2);
    return segunda - primeira;
}

function proximaExecucao(expressao) {
    return cron.createTask(expressao, () => {}, { timezone: FUSO }).getNextRuns(1)[0] || null;
}

// "Atrasado": o job está agendado e passou de 2 intervalos desde a última execução (ou desde que os jobs subiram).
function estaAtrasado(definicao, estado, agora) {
    if (!iniciadoEm) return false;
    const referencia = estado.ultima_execucao || iniciadoEm;
    return agora - referencia > INTERVALOS_PARA_ATRASO * intervaloMs(definicao.expressao);
}

/**
 * Situação dos jobs para o /saude/detalhado: por job, última execução, status, duração, próxima execução
 * e falhas seguidas. "degradado" quando algum job falhou 2 vezes seguidas ou não roda há mais de 2 intervalos.
 */
function situacaoJobs(agora = new Date()) {
    return DEFINICOES.map((definicao) => {
        const estado = estados.get(definicao.nome);
        const agendada = tarefas.find((item) => item.definicao === definicao);
        const falhando = estado.falhas_seguidas >= FALHAS_PARA_DEGRADAR;
        const atrasado = Boolean(agendada) && estaAtrasado(definicao, estado, agora);
        return {
            nome: definicao.nome,
            descricao: definicao.descricao,
            expressao: definicao.expressao,
            fuso: FUSO,
            ativo: Boolean(agendada),
            proxima_execucao: agendada ? agendada.tarefa.getNextRun() : proximaExecucao(definicao.expressao),
            ...estado,
            atrasado,
            situacao: falhando || atrasado ? 'degradado' : 'ok'
        };
    });
}

function jobsDegradados(agora = new Date()) {
    return situacaoJobs(agora).filter((job) => job.situacao === 'degradado').map((job) => job.nome);
}

// Para os testes: ajusta o atraso da nova tentativa e zera o estado.
function reiniciarParaTestes({ atrasoRetry = ATRASO_RETRY_PADRAO_MS } = {}) {
    atrasoRetryMs = atrasoRetry;
    for (const temporizador of retentativas.values()) clearTimeout(temporizador);
    retentativas.clear();
    for (const nome of estados.keys()) estados.set(nome, estadoInicial());
}

module.exports = {
    iniciarJobs, pararJobs, situacaoJobs, jobsDegradados, executarAgora, buscarDefinicao, DEFINICOES,
    _teste: { rodar, reiniciarParaTestes, falhaTransitoria, marcarIniciado: (quando) => { iniciadoEm = quando; } }
};
