const { version } = require('../package.json');
const { verificarBanco } = require('../db/conexao');

const iniciadoEm = new Date();

async function verificarSaude(req, res) {
    const bancoOk = await verificarBanco();
    return res.status(bancoOk ? 200 : 503).json({
        status: bancoOk ? 'ok' : 'degradado',
        banco: bancoOk ? 'conectado' : 'indisponivel',
        uptime_segundos: Math.floor(process.uptime()),
        iniciado_em: iniciadoEm.toISOString(),
        versao: version,
        // Preenchido a partir da Fase 6 (importação de catálogo).
        ultima_sincronizacao: null
    });
}

module.exports = { verificarSaude };
