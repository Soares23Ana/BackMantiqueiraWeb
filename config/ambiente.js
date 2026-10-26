const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const SEGREDOS_DE_EXEMPLO = new Set([
    'troque_por_uma_chave_longa_e_aleatoria',
    'sua_chave_secreta_jwt'
]);

function inteiro(valor, padrao) {
    if (valor === undefined || valor === '') return padrao;
    const numero = Number(valor);
    return Number.isSafeInteger(numero) ? numero : NaN;
}

// Lê e valida as variáveis de ambiente. Recebe o objeto para poder ser testada sem efeitos colaterais.
function validarAmbiente(env) {
    const erros = [];
    const ambiente = env.NODE_ENV || 'development';
    const producao = ambiente === 'production';
    const teste = ambiente === 'test';

    const jwtSecret = env.JWT_SECRET || '';
    if (jwtSecret.length < 32) {
        erros.push('JWT_SECRET deve ter pelo menos 32 caracteres.');
    } else if (SEGREDOS_DE_EXEMPLO.has(jwtSecret)) {
        erros.push('JWT_SECRET ainda está com o valor de exemplo.');
    }

    const porta = inteiro(env.PORT, 3000);
    if (!(porta >= 1 && porta <= 65535)) {
        erros.push('PORT deve ser um número entre 1 e 65535.');
    }

    if (producao) {
        for (const nome of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
            if (!env[nome]) erros.push(`${nome} é obrigatório em produção.`);
        }
    }

    const nomeBanco = teste
        ? env.DB_NAME_TEST || 'mantiqueira_test'
        : env.DB_NAME || 'mantiqueira_db';
    if (!/^\w{1,64}$/.test(nomeBanco)) {
        erros.push('O nome do banco deve conter apenas letras, números e _.');
    }
    if (teste && !nomeBanco.endsWith('_test')) {
        erros.push('Em testes, o nome do banco deve terminar com _test.');
    }

    const portaBanco = inteiro(env.DB_PORT, 3306);
    if (!(portaBanco >= 1 && portaBanco <= 65535)) {
        erros.push('DB_PORT deve ser um número entre 1 e 65535.');
    }
    const poolMax = inteiro(env.DB_POOL_MAX, 10);
    if (!(poolMax >= 1 && poolMax <= 100)) {
        erros.push('DB_POOL_MAX deve ser um número entre 1 e 100.');
    }

    const origensCors = (env.CORS_ORIGINS || '')
        .split(',')
        .map((origem) => origem.trim())
        .filter(Boolean);
    for (const origem of origensCors) {
        try {
            const url = new URL(origem);
            if (url.origin !== origem) throw new Error();
        } catch {
            erros.push(`CORS_ORIGINS contém uma origem inválida: ${origem}`);
        }
    }

    const niveisLog = ['debug', 'info', 'warn', 'error', 'silent'];
    const nivelLog = env.LOG_LEVEL || (teste ? 'silent' : 'info');
    if (!niveisLog.includes(nivelLog)) {
        erros.push(`LOG_LEVEL deve ser um destes: ${niveisLog.join(', ')}.`);
    }

    return {
        erros,
        config: {
            ambiente,
            producao,
            teste,
            porta,
            trustProxy: env.TRUST_PROXY
                ? (Number(env.TRUST_PROXY) || env.TRUST_PROXY)
                : null,
            jwtSecret,
            origensCors,
            limiteJson: env.JSON_LIMIT || '200kb',
            log: {
                nivel: nivelLog,
                formato: env.LOG_FORMAT || (producao ? 'json' : 'texto')
            },
            db: {
                host: env.DB_HOST || 'localhost',
                porta: portaBanco,
                usuario: env.DB_USER || 'root',
                senha: env.DB_PASSWORD || '',
                nome: nomeBanco,
                poolMax,
                // O Brasil não tem horário de verão desde 2019; o deslocamento fixo dispensa as tabelas de fuso do MySQL.
                timezone: '-03:00'
            }
        }
    };
}

class ErroConfiguracao extends Error {
    constructor(erros) {
        super(`Configuração inválida:\n- ${erros.join('\n- ')}`);
        this.name = 'ErroConfiguracao';
        this.erros = erros;
    }
}

const { erros, config } = validarAmbiente(process.env);
if (erros.length > 0) {
    throw new ErroConfiguracao(erros);
}

module.exports = config;
module.exports.validarAmbiente = validarAmbiente;
module.exports.ErroConfiguracao = ErroConfiguracao;
