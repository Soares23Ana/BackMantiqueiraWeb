const { Op } = require('sequelize');
const { NotaCliente, Auditoria, Usuario } = require('../models');
const { ErroApi } = require('../lib/erros');
const { podeGerenciarEquipe } = require('../lib/perfis');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');

const LIMITE_NOTA = 1000;

function lerId(valor, mensagem) {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) throw new ErroApi(400, 'REQUISICAO_INVALIDA', mensagem);
    return id;
}

async function buscarCliente(idCliente) {
    const cliente = await Usuario.findOne({ where: { id_usuario: idCliente, tipo: 'cliente' }, attributes: ['id_usuario'] });
    if (!cliente) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Cliente não encontrado.');
}

const apresentarNota = (nota, usuario) => ({
    id_nota: nota.id_nota,
    texto: nota.texto,
    autor: nota.autor ? { id_usuario: nota.autor.id_usuario, nome: nota.autor.nome } : null,
    criado_em: nota.criado_em,
    // O autor e quem gerencia a equipe podem excluir.
    pode_excluir: Boolean(usuario) && (nota.id_autor === usuario.id || podeGerenciarEquipe(usuario))
});

const INCLUDE_AUTOR = [{ model: Usuario, as: 'autor', attributes: ['id_usuario', 'nome'], required: false }];

// GET /clientes/:id/notas (equipe): da mais recente para a mais antiga.
async function listarNotas(req, res) {
    const idCliente = lerId(req.params.id, 'Identificador de cliente inválido.');
    await buscarCliente(idCliente);
    const paginacao = lerPaginacao(req.query, { limitePadrao: 50, limiteMaximo: 200 });
    const { rows, count } = await NotaCliente.findAndCountAll({
        where: { id_cliente: idCliente },
        include: INCLUDE_AUTOR,
        order: [['criado_em', 'DESC'], ['id_nota', 'DESC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    return res.status(200).json({
        notas: rows.map((nota) => apresentarNota(nota, req.usuario)),
        paginacao: montarPaginacao(count, paginacao)
    });
}

// POST /clientes/:id/notas { texto } (equipe)
async function criarNota(req, res) {
    const idCliente = lerId(req.params.id, 'Identificador de cliente inválido.');
    const corpo = req.body || {};
    const extras = Object.keys(corpo).filter((campo) => campo !== 'texto');
    const texto = typeof corpo.texto === 'string' ? corpo.texto.trim() : '';
    if (extras.length > 0 || !texto || texto.length > LIMITE_NOTA) {
        const mensagem = extras.length > 0 ? `Campo não permitido: ${extras[0]}.` : `A nota é obrigatória (até ${LIMITE_NOTA} caracteres).`;
        throw new ErroApi(422, 'VALIDACAO', mensagem, [{ campo: extras[0] || 'texto', mensagem }]);
    }
    await buscarCliente(idCliente);
    const criada = await NotaCliente.create({ id_cliente: idCliente, texto, id_autor: req.usuario.id });
    const nota = await NotaCliente.findByPk(criada.id_nota, { include: INCLUDE_AUTOR });
    return res.status(201).json({ mensagem: 'Nota registrada.', nota: apresentarNota(nota, req.usuario) });
}

// DELETE /clientes/:id/notas/:id_nota: só o autor ou quem tem pode_gerenciar_equipe.
async function excluirNota(req, res) {
    const idCliente = lerId(req.params.id, 'Identificador de cliente inválido.');
    const idNota = lerId(req.params.id_nota, 'Identificador de nota inválido.');
    const nota = await NotaCliente.findOne({ where: { id_nota: idNota, id_cliente: idCliente } });
    if (!nota) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Nota não encontrada.');
    if (nota.id_autor !== req.usuario.id && !podeGerenciarEquipe(req.usuario)) {
        throw new ErroApi(403, 'ACESSO_NEGADO', 'Só o autor da nota ou quem gerencia a equipe pode excluí-la.');
    }
    await nota.destroy();
    return res.status(200).json({ mensagem: 'Nota excluída.' });
}

// Auditoria ---------------------------------------------------------------------------------------

function lerData(valor, campo, fimDoDia) {
    if (valor === undefined) return null;
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(Date.parse(`${valor}T00:00:00-03:00`))) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', `Use o formato AAAA-MM-DD em "${campo}".`);
    }
    const data = new Date(`${valor}T00:00:00-03:00`);
    if (fimDoDia) data.setUTCDate(data.getUTCDate() + 1);
    return data;
}

// GET /auditoria (equipe). Filtros: entidade, id_entidade, id_usuario, de/ate (AAAA-MM-DD) e paginação.
async function listarAuditoria(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 50, limiteMaximo: 200 });
    const where = {};
    for (const campo of ['entidade', 'id_entidade']) {
        if (req.query[campo] !== undefined) {
            if (typeof req.query[campo] !== 'string' || !req.query[campo] || req.query[campo].length > 60) {
                throw new ErroApi(400, 'FILTRO_INVALIDO', `${campo} inválido.`);
            }
            where[campo] = req.query[campo];
        }
    }
    if (req.query.id_usuario !== undefined) {
        where.id_usuario = lerId(req.query.id_usuario, 'id_usuario inválido.');
    }
    const de = lerData(req.query.de, 'de', false);
    const ate = lerData(req.query.ate, 'ate', true);
    if (de && ate && ate <= de) throw new ErroApi(400, 'FILTRO_INVALIDO', '"ate" deve ser igual ou depois de "de".');
    if (de || ate) where.criado_em = { ...(de && { [Op.gte]: de }), ...(ate && { [Op.lt]: ate }) };

    const { rows, count } = await Auditoria.findAndCountAll({
        where,
        include: [{ model: Usuario, as: 'usuario', attributes: ['id_usuario', 'nome'], required: false }],
        order: [['criado_em', 'DESC'], ['id_auditoria', 'DESC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    return res.status(200).json({
        registros: rows.map((registro) => ({
            id_auditoria: Number(registro.id_auditoria),
            usuario: registro.usuario ? { id_usuario: registro.usuario.id_usuario, nome: registro.usuario.nome } : null,
            acao: registro.acao,
            entidade: registro.entidade,
            id_entidade: registro.id_entidade,
            resumo: registro.resumo,
            criado_em: registro.criado_em
        })),
        paginacao: montarPaginacao(count, paginacao)
    });
}

module.exports = { listarNotas, criarNota, excluirNota, listarAuditoria };
