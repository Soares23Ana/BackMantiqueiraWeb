const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('../config/ambiente');

// Guarda o request id da requisição em andamento para que qualquer log feito durante ela o inclua.
const contexto = new AsyncLocalStorage();

const PESOS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50, silent: Infinity };
const pesoMinimo = PESOS[config.log.nivel];

function serializar(valor) {
    if (valor instanceof Error) {
        return {
            nome: valor.name,
            mensagem: valor.message,
            ...(valor.codigo && { codigo: valor.codigo }),
            ...(valor.code && { code: valor.code }),
            stack: valor.stack
        };
    }
    return valor;
}

function escrever(nivel, mensagem, campos = {}) {
    if (PESOS[nivel] < pesoMinimo) return;

    const registro = {
        ts: new Date().toISOString(),
        nivel,
        msg: mensagem,
        ...(contexto.getStore() || {}),
        ...Object.fromEntries(Object.entries(campos).map(([chave, valor]) => [chave, serializar(valor)]))
    };
    const saida = PESOS[nivel] >= PESOS.warn ? process.stderr : process.stdout;

    if (config.log.formato === 'json') {
        saida.write(`${JSON.stringify(registro)}\n`);
        return;
    }
    const { ts, nivel: _nivel, msg, ...resto } = registro;
    const pilha = resto.erro && resto.erro.stack;
    if (resto.erro) delete resto.erro.stack;
    const extras = Object.keys(resto).length > 0 ? ` ${JSON.stringify(resto)}` : '';
    saida.write(`${ts.slice(11, 19)} ${nivel.toUpperCase().padEnd(5)} ${msg}${extras}\n${pilha ? `${pilha}\n` : ''}`);
}

const logger = {
    debug: (mensagem, campos) => escrever('debug', mensagem, campos),
    info: (mensagem, campos) => escrever('info', mensagem, campos),
    warn: (mensagem, campos) => escrever('warn', mensagem, campos),
    error: (mensagem, campos) => escrever('error', mensagem, campos),
    fatal: (mensagem, campos) => escrever('fatal', mensagem, campos),
    contexto
};

module.exports = logger;
