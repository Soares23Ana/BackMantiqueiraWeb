const logger = require('./logger');

const TEMPO_LIMITE_MS = 10000;
const tarefas = [];
let encerrando = false;

// Registra algo a ser fechado no desligamento (servidor HTTP, banco, jobs...). Fecha na ordem inversa.
function aoEncerrar(nome, funcao) {
    tarefas.push({ nome, funcao });
}

async function encerrar(motivo, codigoSaida = 0) {
    if (encerrando) return;
    encerrando = true;
    logger.info('Encerrando a API.', { motivo });

    // Se algo travar, força a saída para o PM2/systemd poder reiniciar.
    setTimeout(() => {
        logger.error('Encerramento excedeu o tempo limite; saída forçada.', { tempo_limite_ms: TEMPO_LIMITE_MS });
        process.exit(codigoSaida || 1);
    }, TEMPO_LIMITE_MS).unref();

    for (const { nome, funcao } of [...tarefas].reverse()) {
        try {
            await funcao();
            logger.debug('Recurso encerrado.', { recurso: nome });
        } catch (erro) {
            logger.error('Erro ao encerrar recurso.', { recurso: nome, erro });
        }
    }
    process.exit(codigoSaida);
}

function instalarHandlers() {
    process.on('SIGTERM', () => encerrar('SIGTERM'));
    process.on('SIGINT', () => encerrar('SIGINT'));
    process.on('unhandledRejection', (motivo) => {
        logger.fatal('Promise rejeitada sem tratamento.', { erro: motivo instanceof Error ? motivo : String(motivo) });
        encerrar('unhandledRejection', 1);
    });
    process.on('uncaughtException', (erro) => {
        logger.fatal('Exceção não capturada.', { erro });
        encerrar('uncaughtException', 1);
    });
}

module.exports = { aoEncerrar, encerrar, instalarHandlers };
