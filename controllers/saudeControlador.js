const { version } = require('../package.json');
const sequelize = require('../db/conn');
const { verificarBanco } = require('../db/conexao');
const { listarPendentes } = require('../db/migracoes');
const { ultimaSincronizacao } = require('../servicos/sincronizacao');
const { situacaoJobs } = require('../jobs');
const { estadoPastaUploads } = require('../lib/uploads');

const iniciadoEm = new Date();

async function dataUltimaSincronizacao(tipo) {
    try {
        const ultima = await ultimaSincronizacao(tipo);
        return ultima ? ultima.finalizado_em : null;
    } catch {
        return null;
    }
}

// GET /saude (público): para o balanceador e monitoramento simples. Versão, uptime e sincronizações
// ficam só no /saude/detalhado, para não expor detalhes do servidor a qualquer um.
async function verificarSaude(req, res) {
    const bancoOk = await verificarBanco();
    return res.status(bancoOk ? 200 : 503).json({
        status: bancoOk ? 'ok' : 'degradado',
        banco: bancoOk ? 'conectado' : 'indisponivel'
    });
}

// GET /saude/detalhado (equipe): banco, migrations, processo, jobs e sincronizações.
async function verificarSaudeDetalhada(req, res) {
    const inicio = Date.now();
    const bancoOk = await verificarBanco();
    const latencia = Date.now() - inicio;

    let migracoesPendentes = null;
    if (bancoOk) {
        try {
            migracoesPendentes = (await listarPendentes(sequelize)).map((migracao) => migracao.arquivo);
        } catch {
            migracoesPendentes = null;
        }
    }
    const memoria = process.memoryUsage();
    const jobs = situacaoJobs();
    const uploads = await estadoPastaUploads();
    return res.status(bancoOk ? 200 : 503).json({
        status: bancoOk && uploads.gravavel && migracoesPendentes && migracoesPendentes.length === 0 && jobs.every((job) => job.situacao === 'ok') ? 'ok' : 'degradado',
        versao: version,
        banco: {
            status: bancoOk ? 'conectado' : 'indisponivel',
            latencia_ms: bancoOk ? latencia : null,
            migracoes_pendentes: migracoesPendentes
        },
        processo: {
            iniciado_em: iniciadoEm.toISOString(),
            uptime_segundos: Math.floor(process.uptime()),
            node: process.version,
            memoria_mb: Math.round(memoria.rss / 1024 / 1024)
        },
        jobs,
        uploads,
        sincronizacoes: bancoOk ? {
            ultima: await dataUltimaSincronizacao(),
            ultima_catalogo: await dataUltimaSincronizacao('catalogo'),
            ultima_carga_completa: await dataUltimaSincronizacao('carga_completa'),
            ultima_estoque: await dataUltimaSincronizacao('estoque'),
            ultima_importacao_manual: await dataUltimaSincronizacao('importacao_manual')
        } : null
    });
}

module.exports = { verificarSaude, verificarSaudeDetalhada };
