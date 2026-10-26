const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Campanha, CampanhaProduto, Produto, Categoria, Marca } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerDataHora } = require('../lib/datas');
const { apresentarProduto } = require('./produtoControlador');

const SITUACOES = ['agendada', 'ativa', 'encerrada'];
const ATRIBUTOS_PRODUTO_EQUIPE = ['id_produto', 'sku', 'nome', 'imagem_url', 'ativo'];

// A situação vem das datas: agendada (ainda não começou), ativa (no período) ou encerrada.
function situacao(campanha, agora = new Date()) {
    if (campanha.inicio_em > agora) return 'agendada';
    if (campanha.fim_em <= agora) return 'encerrada';
    return 'ativa';
}

function condicaoSituacao(valor, agora = new Date()) {
    if (valor === 'agendada') return { inicio_em: { [Op.gt]: agora } };
    if (valor === 'encerrada') return { fim_em: { [Op.lte]: agora } };
    return { inicio_em: { [Op.lte]: agora }, fim_em: { [Op.gt]: agora } };
}

function apresentarParaEquipe(campanha) {
    const dados = campanha.toJSON();
    return {
        id_campanha: dados.id_campanha,
        titulo: dados.titulo,
        selo: dados.selo,
        inicio_em: dados.inicio_em,
        fim_em: dados.fim_em,
        situacao: situacao(campanha),
        produtos: (dados.produtos || []).map(({ CampanhaProduto: _vinculo, ...produto }) => produto),
        total_produtos: (dados.produtos || []).length,
        criado_em: dados.criado_em,
        atualizado_em: dados.atualizado_em
    };
}

/**
 * Valida o corpo de criação/edição. "produtos" é a lista completa de ids (substitui a anterior).
 * Retorna { dados, idsProdutos }.
 */
function validar(corpo, { parcial }) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'O corpo da requisição deve ser um objeto.');
    }
    const erros = [];
    const dados = {};
    for (const campo of Object.keys(corpo)) {
        if (!['titulo', 'selo', 'inicio_em', 'fim_em', 'produtos'].includes(campo)) {
            erros.push({ campo, mensagem: `Campo não permitido: ${campo}.` });
        }
    }
    if (!parcial || corpo.titulo !== undefined) {
        const titulo = typeof corpo.titulo === 'string' ? corpo.titulo.trim() : '';
        if (titulo.length < 3 || titulo.length > 120) erros.push({ campo: 'titulo', mensagem: 'O título deve ter de 3 a 120 caracteres.' });
        dados.titulo = titulo;
    }
    if (corpo.selo !== undefined) {
        if (corpo.selo !== null && (typeof corpo.selo !== 'string' || corpo.selo.trim().length > 40)) {
            erros.push({ campo: 'selo', mensagem: 'O selo deve ser um texto de até 40 caracteres.' });
        }
        dados.selo = typeof corpo.selo === 'string' ? corpo.selo.trim() || null : null;
    }
    for (const campo of ['inicio_em', 'fim_em']) {
        const data = lerDataHora(corpo[campo], campo, erros);
        if (data === null || (!parcial && corpo[campo] === undefined)) {
            erros.push({ campo, mensagem: `${campo} é obrigatório.` });
        } else if (data !== undefined) {
            dados[campo] = data;
        }
    }

    let idsProdutos;
    if (!parcial || corpo.produtos !== undefined) {
        const lista = corpo.produtos;
        if (!Array.isArray(lista) || lista.length === 0 || lista.length > 200 ||
            lista.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(lista).size !== lista.length) {
            erros.push({ campo: 'produtos', mensagem: 'Informe de 1 a 200 ids de produto, sem repetir.' });
        } else {
            idsProdutos = lista;
        }
    }
    if (parcial && Object.keys(corpo).length === 0) {
        erros.push({ campo: null, mensagem: 'Informe ao menos um campo para atualizar.' });
    }
    if (erros.length > 0) throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    return { dados, idsProdutos };
}

async function conferirProdutos(ids, transacao) {
    const existentes = await Produto.findAll({ where: { id_produto: { [Op.in]: ids } }, attributes: ['id_produto'], transaction: transacao });
    const encontrados = new Set(existentes.map((produto) => produto.id_produto));
    const faltando = ids.filter((id) => !encontrados.has(id));
    if (faltando.length > 0) {
        throw new ErroApi(422, 'VALIDACAO', 'Há produtos inexistentes na campanha.', [{ campo: 'produtos', mensagem: `Produtos inexistentes: ${faltando.join(', ')}.` }]);
    }
}

async function carregar(idCampanha) {
    return Campanha.findByPk(idCampanha, {
        include: [{ model: Produto, as: 'produtos', attributes: ATRIBUTOS_PRODUTO_EQUIPE, through: { attributes: [] } }],
        order: [[{ model: Produto, as: 'produtos' }, 'nome', 'ASC']]
    });
}

// GET /campanhas/ativas (público): campanhas no período, com os produtos ativos no formato da vitrine.
async function listarAtivas(req, res) {
    const campanhas = await Campanha.findAll({
        where: condicaoSituacao('ativa'),
        include: [{
            model: Produto,
            as: 'produtos',
            where: { ativo: true },
            required: false,
            through: { attributes: [] },
            include: [
                { model: Categoria, as: 'categoria', attributes: ['id_categoria', 'nome', 'slug'] },
                { model: Marca, as: 'marca', attributes: ['id_marca', 'nome', 'slug'] }
            ]
        }],
        order: [['fim_em', 'ASC'], ['id_campanha', 'ASC'], [{ model: Produto, as: 'produtos' }, 'nome', 'ASC']]
    });
    return res.status(200).json({
        campanhas: campanhas.map((campanha) => ({
            id_campanha: campanha.id_campanha,
            titulo: campanha.titulo,
            selo: campanha.selo,
            inicio_em: campanha.inicio_em,
            fim_em: campanha.fim_em,
            produtos: campanha.produtos.map((produto) => apresentarProduto(produto, req.usuario))
        }))
    });
}

// GET /campanhas?situacao=agendada|ativa|encerrada (equipe)
async function listar(req, res) {
    const where = {};
    if (req.query.situacao) {
        if (!SITUACOES.includes(req.query.situacao)) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', `situacao deve ser: ${SITUACOES.join(', ')}.`);
        }
        Object.assign(where, condicaoSituacao(req.query.situacao));
    }
    const campanhas = await Campanha.findAll({
        where,
        include: [{ model: Produto, as: 'produtos', attributes: ATRIBUTOS_PRODUTO_EQUIPE, through: { attributes: [] } }],
        order: [['inicio_em', 'DESC'], ['id_campanha', 'DESC'], [{ model: Produto, as: 'produtos' }, 'nome', 'ASC']]
    });
    return res.status(200).json({ campanhas: campanhas.map(apresentarParaEquipe) });
}

async function obter(req, res) {
    const campanha = await carregar(Number(req.params.id) || 0);
    if (!campanha) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Campanha não encontrada.');
    return res.status(200).json({ campanha: apresentarParaEquipe(campanha) });
}

// POST /campanhas (equipe)
async function criar(req, res) {
    const { dados, idsProdutos } = validar(req.body, { parcial: false });
    if (dados.fim_em <= dados.inicio_em) {
        throw new ErroApi(422, 'VALIDACAO', 'O fim deve ser depois do início.', [{ campo: 'fim_em', mensagem: 'O fim deve ser depois do início.' }]);
    }
    const id = await sequelize.transaction(async (transacao) => {
        await conferirProdutos(idsProdutos, transacao);
        const campanha = await Campanha.create({ ...dados, id_usuario: req.usuario.id }, { transaction: transacao });
        await CampanhaProduto.bulkCreate(
            idsProdutos.map((idProduto) => ({ id_campanha: campanha.id_campanha, id_produto: idProduto })),
            { transaction: transacao }
        );
        return campanha.id_campanha;
    });
    return res.status(201).json({ mensagem: 'Campanha criada.', campanha: apresentarParaEquipe(await carregar(id)) });
}

// PATCH /campanhas/:id (equipe). "produtos", quando enviado, substitui a lista inteira.
// Para encerrar antes do previsto, envie fim_em com a data/hora atual.
async function atualizar(req, res) {
    const { dados, idsProdutos } = validar(req.body, { parcial: true });
    await sequelize.transaction(async (transacao) => {
        const campanha = await Campanha.findByPk(Number(req.params.id) || 0, { transaction: transacao, lock: transacao.LOCK.UPDATE });
        if (!campanha) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Campanha não encontrada.');
        const inicio = dados.inicio_em || campanha.inicio_em;
        const fim = dados.fim_em || campanha.fim_em;
        if (fim <= inicio) {
            throw new ErroApi(422, 'VALIDACAO', 'O fim deve ser depois do início.', [{ campo: 'fim_em', mensagem: 'O fim deve ser depois do início.' }]);
        }
        await campanha.update(dados, { transaction: transacao });
        if (idsProdutos) {
            await conferirProdutos(idsProdutos, transacao);
            await CampanhaProduto.destroy({ where: { id_campanha: campanha.id_campanha }, transaction: transacao });
            await CampanhaProduto.bulkCreate(
                idsProdutos.map((idProduto) => ({ id_campanha: campanha.id_campanha, id_produto: idProduto })),
                { transaction: transacao }
            );
        }
    });
    return res.status(200).json({ mensagem: 'Campanha atualizada.', campanha: apresentarParaEquipe(await carregar(Number(req.params.id))) });
}

// DELETE /campanhas/:id (equipe)
async function excluir(req, res) {
    const excluidas = await Campanha.destroy({ where: { id_campanha: Number(req.params.id) || 0 } });
    if (!excluidas) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Campanha não encontrada.');
    return res.status(200).json({ mensagem: 'Campanha excluída.' });
}

module.exports = { listarAtivas, listar, obter, criar, atualizar, excluir };
