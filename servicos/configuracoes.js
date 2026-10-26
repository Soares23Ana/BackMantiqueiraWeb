const { Configuracao } = require('../models');
const { ErroApi } = require('../lib/erros');
const { somenteDigitos } = require('../lib/cnpj');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function texto(maximo) {
    return (valor) => {
        if (typeof valor !== 'string' || valor.trim().length > maximo) {
            throw new Error(`deve ser um texto de até ${maximo} caracteres`);
        }
        return valor.trim() || null;
    };
}

function telefone(minimo, maximo) {
    return (valor) => {
        const digitos = somenteDigitos(valor);
        if (typeof valor !== 'string' || digitos.length < minimo || digitos.length > maximo) {
            throw new Error(`deve ter de ${minimo} a ${maximo} dígitos`);
        }
        return digitos;
    };
}

/**
 * Chaves aceitas, com descrição, validação e se aparecem em GET /configuracoes/publicas.
 * O valor null limpa a configuração (o padrão, se houver, passa a valer).
 */
const DEFINICOES = {
    meta_reposicao: {
        descricao: 'Estoque-alvo usado na sugestão de compra dos alertas de reposição.',
        publica: false,
        padrao: '50',
        validar: (valor) => {
            const numero = Number(valor);
            if (!Number.isSafeInteger(numero) || numero < 1 || numero > 1000000) {
                throw new Error('deve ser um número inteiro entre 1 e 1.000.000');
            }
            return String(numero);
        }
    },
    whatsapp: { descricao: 'WhatsApp de atendimento, com DDI e DDD (ex.: 5519999990000).', publica: true, validar: telefone(12, 13) },
    telefone_contato: { descricao: 'Telefone de contato com DDD.', publica: true, validar: telefone(10, 11) },
    email_contato: {
        descricao: 'E-mail de contato.',
        publica: true,
        validar: (valor) => {
            if (typeof valor !== 'string' || !EMAIL.test(valor.trim()) || valor.trim().length > 100) {
                throw new Error('deve ser um e-mail válido');
            }
            return valor.trim().toLowerCase();
        }
    },
    horario_atendimento: { descricao: 'Horário de atendimento exibido no site.', publica: true, validar: texto(200) },
    aviso_topo: { descricao: 'Aviso exibido no topo do site (vazio para esconder).', publica: true, validar: texto(200) }
};

function valorEfetivo(chave, registro) {
    const definicao = DEFINICOES[chave];
    return registro && registro.valor !== null ? registro.valor : (definicao.padrao ?? null);
}

async function listar({ somentePublicas = false } = {}) {
    const registros = new Map((await Configuracao.findAll()).map((registro) => [registro.chave, registro]));
    return Object.entries(DEFINICOES)
        .filter(([, definicao]) => !somentePublicas || definicao.publica)
        .map(([chave, definicao]) => ({
            chave,
            valor: valorEfetivo(chave, registros.get(chave)),
            publica: definicao.publica,
            descricao: definicao.descricao,
            atualizado_em: registros.get(chave) ? registros.get(chave).atualizado_em : null
        }));
}

async function atualizar(chave, valor, idUsuario) {
    const definicao = DEFINICOES[chave];
    if (!definicao) {
        throw new ErroApi(404, 'NAO_ENCONTRADO', `Configuração desconhecida: ${chave}.`);
    }
    let normalizado = null;
    if (valor !== null && valor !== '') {
        try {
            normalizado = definicao.validar(valor);
        } catch (erro) {
            throw new ErroApi(422, 'VALIDACAO', `${chave} ${erro.message}.`, [{ campo: 'valor', mensagem: `${chave} ${erro.message}.` }]);
        }
    }
    await Configuracao.upsert({ chave, valor: normalizado, publica: definicao.publica, id_usuario: idUsuario });
    return { chave, valor: valorEfetivo(chave, { valor: normalizado }) };
}

async function obterNumero(chave) {
    const registro = await Configuracao.findByPk(chave);
    return Number(valorEfetivo(chave, registro));
}

module.exports = { listar, atualizar, obterNumero, DEFINICOES };
