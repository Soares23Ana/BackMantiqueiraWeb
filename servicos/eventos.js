const { Op } = require('sequelize');
const { Evento } = require('../models');
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');

// Tipos que o front pode enviar. Busca e pedido concluído são registrados pelo próprio servidor.
const CAMPOS_POR_TIPO = {
    produto_visto: { obrigatorios: ['id_produto'], opcionais: [] },
    carrinho_adicionar: { obrigatorios: ['id_produto'], opcionais: ['quantidade'] },
    checkout_iniciado: { obrigatorios: [], opcionais: [] },
    banner_clique: { obrigatorios: ['id_banner'], opcionais: [] },
    campanha_clique: { obrigatorios: ['id_campanha'], opcionais: [] }
};
const SESSAO_VALIDA = /^[A-Za-z0-9_-]{8,64}$/;
const MESES_RETENCAO = 12;

/**
 * Grava um evento sem nunca derrubar a requisição que o originou: em caso de erro, só registra no log.
 */
async function registrarEvento(dados) {
    try {
        await Evento.create(dados);
    } catch (erro) {
        logger.warn('Não foi possível registrar o evento.', { tipo: dados.tipo, erro: erro.message });
    }
}

// Valida o corpo de POST /eventos. Lança 422 com todos os problemas.
function validarEventoDoFront(corpo) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'O corpo da requisição deve ser um objeto.');
    }
    const definicao = CAMPOS_POR_TIPO[corpo.tipo];
    if (!definicao) {
        throw new ErroApi(422, 'VALIDACAO', `tipo deve ser: ${Object.keys(CAMPOS_POR_TIPO).join(', ')}.`,
            [{ campo: 'tipo', mensagem: 'Tipo de evento não aceito.' }]);
    }
    const erros = [];
    const permitidos = ['tipo', 'sessao', ...definicao.obrigatorios, ...definicao.opcionais];
    for (const campo of Object.keys(corpo)) {
        if (!permitidos.includes(campo)) erros.push({ campo, mensagem: `Campo não permitido para ${corpo.tipo}: ${campo}.` });
    }
    const dados = { tipo: corpo.tipo };
    for (const campo of [...definicao.obrigatorios, ...definicao.opcionais]) {
        if (corpo[campo] === undefined) {
            if (definicao.obrigatorios.includes(campo)) erros.push({ campo, mensagem: `${campo} é obrigatório.` });
            continue;
        }
        if (!Number.isSafeInteger(corpo[campo]) || corpo[campo] <= 0 || corpo[campo] > 2147483647) {
            erros.push({ campo, mensagem: `${campo} deve ser um inteiro positivo.` });
        } else {
            dados[campo] = corpo[campo];
        }
    }
    if (corpo.sessao !== undefined) {
        if (typeof corpo.sessao !== 'string' || !SESSAO_VALIDA.test(corpo.sessao)) {
            erros.push({ campo: 'sessao', mensagem: 'sessao deve ter de 8 a 64 letras, números, "-" ou "_".' });
        } else {
            dados.sessao = corpo.sessao;
        }
    }
    if (erros.length > 0) throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    return dados;
}

// Job diário: apaga eventos com mais de 12 meses, em lotes para não travar a tabela.
async function limparEventosAntigos({ tamanhoLote = 5000 } = {}) {
    const limite = new Date();
    limite.setMonth(limite.getMonth() - MESES_RETENCAO);
    let total = 0;
    for (;;) {
        const removidos = await Evento.destroy({ where: { criado_em: { [Op.lt]: limite } }, limit: tamanhoLote });
        total += removidos;
        if (removidos < tamanhoLote) break;
    }
    return { removidos: total, anteriores_a: limite.toISOString() };
}

module.exports = { registrarEvento, validarEventoDoFront, limparEventosAntigos, CAMPOS_POR_TIPO };
