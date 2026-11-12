const { Auditoria } = require('../models');
const logger = require('../lib/logger');

// Chaves que nunca vão para a trilha, em qualquer nível: senha, hash, token e segredos.
const CHAVE_SENSIVEL = /senha|password|hash|token|segredo|secret|authorization/i;
const MAXIMO_TEXTO = 200;
const PROFUNDIDADE_MAXIMA = 4;

// Remove chaves sensíveis, encurta textos longos e converte datas, para o resumo caber e ser seguro de guardar.
function higienizar(valor, profundidade = 0) {
    if (valor === undefined) return undefined;
    if (valor === null || typeof valor === 'number' || typeof valor === 'boolean') return valor;
    if (valor instanceof Date) return valor.toISOString();
    if (typeof valor === 'string') {
        return valor.length > MAXIMO_TEXTO ? `${valor.slice(0, MAXIMO_TEXTO)}…` : valor;
    }
    if (profundidade >= PROFUNDIDADE_MAXIMA) return '[omitido]';
    if (Array.isArray(valor)) return valor.slice(0, 50).map((item) => higienizar(item, profundidade + 1));
    if (typeof valor === 'object') {
        const limpo = {};
        for (const [chave, interno] of Object.entries(typeof valor.toJSON === 'function' ? valor.toJSON() : valor)) {
            if (CHAVE_SENSIVEL.test(chave)) continue;
            const higienizado = higienizar(interno, profundidade + 1);
            if (higienizado !== undefined) limpo[chave] = higienizado;
        }
        return limpo;
    }
    return String(valor);
}

// Só os campos informados de um registro (modelo do Sequelize ou objeto), já sem os sensíveis.
function instantaneo(registro, campos) {
    if (!registro) return null;
    const dados = typeof registro.toJSON === 'function' ? registro.toJSON() : registro;
    return Object.fromEntries(campos.filter((campo) => dados[campo] !== undefined).map((campo) => [campo, dados[campo]]));
}

// Campos que mudaram: { campo: { antes, depois } }.
function diferencas(antes, depois) {
    const a = higienizar(antes || {});
    const d = higienizar(depois || {});
    const alteracoes = {};
    for (const campo of new Set([...Object.keys(a), ...Object.keys(d)])) {
        if (JSON.stringify(a[campo] ?? null) !== JSON.stringify(d[campo] ?? null)) {
            alteracoes[campo] = { antes: a[campo] ?? null, depois: d[campo] ?? null };
        }
    }
    return alteracoes;
}

/**
 * Registra uma ação da equipe na trilha de auditoria. NUNCA derruba a operação principal: qualquer erro
 * (inclusive de banco) só vai para o log. Nunca guarda senha, hash ou token.
 *
 * - antes e depois: edição (grava só os campos alterados); só depois: criação; só antes: exclusão.
 * - detalhe: informações extras já seguras (ex.: observação do ajuste, motivo do cancelamento).
 * - Se nada mudou e não há detalhe, não grava.
 */
async function registrarAuditoria({ usuario, acao, entidade, idEntidade = null, antes, depois, detalhe }) {
    try {
        const resumo = {};
        if (antes !== undefined && depois !== undefined) {
            const alteracoes = diferencas(antes, depois);
            if (Object.keys(alteracoes).length === 0 && detalhe === undefined) return;
            resumo.alteracoes = alteracoes;
        } else if (depois !== undefined) {
            resumo.depois = higienizar(depois);
        } else if (antes !== undefined) {
            resumo.antes = higienizar(antes);
        }
        if (detalhe !== undefined) resumo.detalhe = higienizar(detalhe);
        await Auditoria.create({
            id_usuario: usuario && (usuario.id ?? usuario.id_usuario) ? (usuario.id ?? usuario.id_usuario) : null,
            acao,
            entidade,
            id_entidade: idEntidade === null || idEntidade === undefined ? null : String(idEntidade).slice(0, 60),
            resumo: Object.keys(resumo).length > 0 ? resumo : null
        });
    } catch (erro) {
        logger.warn('Não foi possível registrar a auditoria.', { acao, entidade, erro: erro.message });
    }
}

module.exports = { registrarAuditoria, instantaneo, higienizar, diferencas };
