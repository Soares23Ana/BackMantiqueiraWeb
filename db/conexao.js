const sequelize = require('./conn');
const logger = require('../lib/logger');
const { listarPendentes } = require('./migracoes');

const estado = {
    conectado: false,
    tentativas: 0,
    ultimoErro: null,
    interrompido: false
};

const esperar = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
});

// Tenta conectar com espera exponencial (1s, 2s, 4s... até 30s) em vez de derrubar o processo.
async function conectarComRetry({ esperaInicialMs = 1000, esperaMaximaMs = 30000 } = {}) {
    let espera = esperaInicialMs;
    while (!estado.interrompido) {
        estado.tentativas += 1;
        try {
            await sequelize.authenticate();
            estado.conectado = true;
            estado.ultimoErro = null;
            logger.info('Conexão com o banco de dados estabelecida.', { tentativas: estado.tentativas });
            await avisarMigracoesPendentes();
            return true;
        } catch (erro) {
            // Erros de conexão do Sequelize às vezes vêm sem mensagem; o código do driver (ECONNREFUSED...) fica em original.
            estado.ultimoErro = erro.message || (erro.original && erro.original.code) || erro.name;
            logger.warn('Banco de dados indisponível; nova tentativa agendada.', {
                tentativa: estado.tentativas,
                proxima_em_ms: espera,
                erro: estado.ultimoErro
            });
            await esperar(espera);
            espera = Math.min(espera * 2, esperaMaximaMs);
        }
    }
    return false;
}

async function avisarMigracoesPendentes() {
    try {
        const pendentes = await listarPendentes(sequelize);
        if (pendentes.length > 0) {
            logger.warn('Existem migrations pendentes. Execute "npm run migrar".', {
                pendentes: pendentes.map((migracao) => migracao.arquivo)
            });
        }
    } catch (erro) {
        logger.warn('Não foi possível verificar as migrations pendentes.', { erro: erro.message });
    }
}

// Consulta rápida para o /saude; não deixa um banco travado segurar a resposta.
async function verificarBanco(timeoutMs = 2000) {
    let timer;
    try {
        await Promise.race([
            sequelize.query('SELECT 1'),
            new Promise((_, rejeitar) => {
                timer = setTimeout(() => rejeitar(new Error('Tempo esgotado ao consultar o banco.')), timeoutMs);
            })
        ]);
        return true;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

function interromperConexao() {
    estado.interrompido = true;
}

module.exports = { estado, conectarComRetry, verificarBanco, interromperConexao };
