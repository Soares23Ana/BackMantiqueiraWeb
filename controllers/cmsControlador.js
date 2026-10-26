const fs = require('node:fs/promises');
const path = require('node:path');
const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Banner, BlocoCms } = require('../models');
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');
const { ehEquipe } = require('../lib/perfis');
const { ehCaminhoOuUrlSegura, gerarSlug } = require('../lib/texto');

const PASTA_UPLOADS = path.join(__dirname, '..', 'publico', 'uploads');

async function removerArquivo(caminho) {
    if (!caminho) {
        return;
    }
    try {
        await fs.unlink(caminho);
    } catch (erro) {
        if (erro.code !== 'ENOENT') {
            logger.error('Erro ao remover upload não utilizado.', { erro });
        }
    }
}

// Só apaga arquivos gerados pelo upload (nome UUID), nunca caminhos arbitrários gravados no banco.
async function removerUploadDoBanner(imagemUrl) {
    const upload = imagemUrl && imagemUrl.match(/^\/arquivos\/uploads\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/);
    if (upload) await removerArquivo(path.join(PASTA_UPLOADS, upload[1]));
}

// Data/hora ISO. Sem fuso explícito ("2026-11-01T08:00"), considera horário de Brasília.
function lerDataHora(valor, campo, erros) {
    if (valor === undefined) return undefined;
    if (valor === null || valor === '') return null;
    const texto = String(valor);
    const comFuso = /([zZ]|[+-]\d{2}:\d{2})$/.test(texto) ? texto : `${texto}${texto.length === 10 ? 'T00:00:00' : ''}-03:00`;
    const data = new Date(comFuso);
    if (!/^\d{4}-\d{2}-\d{2}/.test(texto) || Number.isNaN(data.getTime())) {
        erros.push({ campo, mensagem: `${campo} deve ser uma data ISO (ex.: 2026-11-01T08:00).` });
        return undefined;
    }
    return data;
}

// Campos do banner vindos de JSON ou multipart (no multipart tudo chega como texto).
function validarBanner(corpo, { parcial }) {
    const erros = [];
    const dados = {};
    const permitidos = ['titulo', 'link', 'ordem', 'ativo', 'inicio_em', 'fim_em'];
    for (const campo of Object.keys(corpo)) {
        if (!permitidos.includes(campo)) erros.push({ campo, mensagem: `Campo não permitido: ${campo}.` });
    }
    if (!parcial || corpo.titulo !== undefined) {
        const titulo = typeof corpo.titulo === 'string' ? corpo.titulo.trim() : '';
        if (!titulo || titulo.length > 150) erros.push({ campo: 'titulo', mensagem: 'O título é obrigatório (até 150 caracteres).' });
        dados.titulo = titulo;
    }
    if (corpo.link !== undefined) {
        const link = typeof corpo.link === 'string' ? corpo.link.trim() : '';
        if (link && (link.length > 2048 || !ehCaminhoOuUrlSegura(link))) {
            erros.push({ campo: 'link', mensagem: 'O link deve ser uma URL HTTP/HTTPS ou um caminho interno.' });
        }
        dados.link = link || null;
    }
    if (corpo.ordem !== undefined) {
        const ordem = Number(corpo.ordem);
        if (!Number.isSafeInteger(ordem) || ordem < 0 || ordem > 100000) erros.push({ campo: 'ordem', mensagem: 'A ordem deve ser um inteiro maior ou igual a zero.' });
        dados.ordem = ordem;
    }
    if (corpo.ativo !== undefined) {
        if (![true, false, 'true', 'false'].includes(corpo.ativo)) erros.push({ campo: 'ativo', mensagem: 'O campo ativo deve ser true ou false.' });
        dados.ativo = corpo.ativo === true || corpo.ativo === 'true';
    }
    const inicio = lerDataHora(corpo.inicio_em, 'inicio_em', erros);
    const fim = lerDataHora(corpo.fim_em, 'fim_em', erros);
    if (inicio !== undefined) dados.inicio_em = inicio;
    if (fim !== undefined) dados.fim_em = fim;
    return { dados, erros };
}

// Situação do banner agora: no_ar, agendado, expirado ou inativo.
function situacao(banner, agora = new Date()) {
    if (!banner.ativo) return 'inativo';
    if (banner.inicio_em && banner.inicio_em > agora) return 'agendado';
    if (banner.fim_em && banner.fim_em <= agora) return 'expirado';
    return 'no_ar';
}

const apresentar = (banner) => ({ ...banner.toJSON(), situacao: situacao(banner) });

// GET /cms (público): banners no ar, na ordem definida.
async function listarBanners(req, res) {
    const agora = new Date();
    const banners = await Banner.findAll({
        where: {
            ativo: true,
            [Op.and]: [
                { [Op.or]: [{ inicio_em: null }, { inicio_em: { [Op.lte]: agora } }] },
                { [Op.or]: [{ fim_em: null }, { fim_em: { [Op.gt]: agora } }] }
            ]
        },
        attributes: ['id_banner', 'titulo', 'link', 'imagem_url', 'ordem'],
        order: [['ordem', 'ASC'], ['id_banner', 'DESC']]
    });
    return res.status(200).json({ banners });
}

// GET /cms/todos (equipe): todos os banners, com a situação de cada um.
async function listarTodosBanners(req, res) {
    const banners = await Banner.findAll({ order: [['ordem', 'ASC'], ['id_banner', 'DESC']] });
    return res.status(200).json({ banners: banners.map(apresentar) });
}

// POST /cms (equipe, multipart): titulo, imagem e opcionalmente link, ordem, ativo, inicio_em, fim_em.
async function salvarBanner(req, res) {
    const { dados, erros } = validarBanner(req.body || {}, { parcial: false });
    if (!req.file) erros.push({ campo: 'imagem', mensagem: 'O arquivo de imagem é obrigatório.' });
    if (dados.inicio_em && dados.fim_em && dados.fim_em <= dados.inicio_em) {
        erros.push({ campo: 'fim_em', mensagem: 'O fim da exibição deve ser depois do início.' });
    }
    if (erros.length > 0) {
        await removerArquivo(req.file && req.file.path);
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }
    try {
        // Sem ordem informada, o banner novo vai para o fim da fila.
        const ordem = dados.ordem ?? ((await Banner.max('ordem')) || 0) + 1;
        const banner = await Banner.create({ ...dados, ordem, imagem_url: `/arquivos/uploads/${req.file.filename}` });
        return res.status(201).json({ mensagem: 'Banner salvo com sucesso.', banner: apresentar(banner) });
    } catch (erro) {
        await removerArquivo(req.file.path);
        throw erro;
    }
}

// PATCH /cms/:id (equipe, JSON ou multipart). Com nova "imagem", a anterior é apagada.
async function atualizarBanner(req, res) {
    const banner = await Banner.findByPk(Number(req.params.id) || 0);
    if (!banner) {
        await removerArquivo(req.file && req.file.path);
        throw new ErroApi(404, 'NAO_ENCONTRADO', 'Banner não encontrado.');
    }
    const { dados, erros } = validarBanner(req.body || {}, { parcial: true });
    const inicio = dados.inicio_em !== undefined ? dados.inicio_em : banner.inicio_em;
    const fim = dados.fim_em !== undefined ? dados.fim_em : banner.fim_em;
    if (inicio && fim && fim <= inicio) {
        erros.push({ campo: 'fim_em', mensagem: 'O fim da exibição deve ser depois do início.' });
    }
    if (!req.file && Object.keys(dados).length === 0 && erros.length === 0) {
        erros.push({ campo: null, mensagem: 'Informe ao menos um campo para atualizar.' });
    }
    if (erros.length > 0) {
        await removerArquivo(req.file && req.file.path);
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }
    const imagemAnterior = banner.imagem_url;
    if (req.file) dados.imagem_url = `/arquivos/uploads/${req.file.filename}`;
    try {
        await banner.update(dados);
    } catch (erro) {
        await removerArquivo(req.file && req.file.path);
        throw erro;
    }
    if (req.file) await removerUploadDoBanner(imagemAnterior);
    return res.status(200).json({ mensagem: 'Banner atualizado.', banner: apresentar(banner) });
}

// DELETE /cms/:id (equipe): exclui o banner e a imagem enviada.
async function excluirBanner(req, res) {
    const banner = await Banner.findByPk(Number(req.params.id) || 0);
    if (!banner) {
        throw new ErroApi(404, 'NAO_ENCONTRADO', 'Banner não encontrado.');
    }
    await banner.destroy();
    await removerUploadDoBanner(banner.imagem_url);
    return res.status(200).json({ mensagem: 'Banner excluído.' });
}

// PUT /cms/ordem { ids: [3, 1, 2] } (equipe): a lista precisa ter todos os banners, cada um uma vez.
async function reordenarBanners(req, res) {
    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids) || ids.some((id) => !Number.isSafeInteger(id)) || new Set(ids).size !== ids.length) {
        throw new ErroApi(422, 'VALIDACAO', 'Envie { "ids": [...] } com os ids dos banners na ordem desejada, sem repetir.');
    }
    await sequelize.transaction(async (transacao) => {
        const existentes = (await Banner.findAll({ attributes: ['id_banner'], transaction: transacao, lock: transacao.LOCK.UPDATE }))
            .map((banner) => banner.id_banner);
        const faltando = existentes.filter((id) => !ids.includes(id));
        const desconhecidos = ids.filter((id) => !existentes.includes(id));
        if (faltando.length || desconhecidos.length) {
            throw new ErroApi(422, 'VALIDACAO', 'A lista deve conter todos os banners, e só eles.', { faltando, desconhecidos });
        }
        for (const [indice, id] of ids.entries()) {
            await Banner.update({ ordem: indice + 1 }, { where: { id_banner: id }, transaction: transacao });
        }
    });
    return listarTodosBanners(req, res);
}

// Blocos de conteúdo ------------------------------------------------------------------------

// GET /cms/blocos (público): blocos ativos. A equipe vê também os inativos.
async function listarBlocos(req, res) {
    const blocos = await BlocoCms.findAll({
        where: ehEquipe(req.usuario) ? {} : { ativo: true },
        order: [['chave', 'ASC']]
    });
    return res.status(200).json({ blocos });
}

// GET /cms/blocos/:chave (público; bloco inativo só para a equipe).
async function obterBloco(req, res) {
    const bloco = await BlocoCms.findOne({ where: { chave: req.params.chave } });
    if (!bloco || (!bloco.ativo && !ehEquipe(req.usuario))) {
        throw new ErroApi(404, 'NAO_ENCONTRADO', 'Bloco de conteúdo não encontrado.');
    }
    return res.status(200).json({ bloco });
}

// PUT /cms/blocos/:chave { titulo?, conteudo, ativo? } (equipe): cria ou substitui o bloco.
async function salvarBloco(req, res) {
    const chave = gerarSlug(req.params.chave).slice(0, 60);
    if (!chave || chave !== req.params.chave) {
        throw new ErroApi(422, 'VALIDACAO', 'A chave deve ter só letras minúsculas, números e hífens (ex.: politica-de-entrega).');
    }
    const corpo = req.body || {};
    const erros = [];
    for (const campo of Object.keys(corpo)) {
        if (!['titulo', 'conteudo', 'ativo'].includes(campo)) erros.push({ campo, mensagem: `Campo não permitido: ${campo}.` });
    }
    if (typeof corpo.conteudo !== 'string' || !corpo.conteudo.trim() || corpo.conteudo.length > 20000) {
        erros.push({ campo: 'conteudo', mensagem: 'O conteúdo é obrigatório (até 20.000 caracteres).' });
    }
    if (corpo.titulo !== undefined && corpo.titulo !== null && (typeof corpo.titulo !== 'string' || corpo.titulo.length > 150)) {
        erros.push({ campo: 'titulo', mensagem: 'O título deve ter até 150 caracteres.' });
    }
    if (corpo.ativo !== undefined && typeof corpo.ativo !== 'boolean') {
        erros.push({ campo: 'ativo', mensagem: 'O campo ativo deve ser true ou false.' });
    }
    if (erros.length > 0) throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);

    await BlocoCms.upsert({
        chave,
        titulo: corpo.titulo ? corpo.titulo.trim() : null,
        conteudo: corpo.conteudo,
        ativo: corpo.ativo ?? true
    });
    // No MySQL o upsert não devolve o registro completo (id, atualizado_em); lê de novo.
    const bloco = await BlocoCms.findOne({ where: { chave } });
    return res.status(200).json({ mensagem: 'Bloco de conteúdo salvo.', bloco });
}

// DELETE /cms/blocos/:chave (equipe)
async function excluirBloco(req, res) {
    const excluidos = await BlocoCms.destroy({ where: { chave: req.params.chave } });
    if (!excluidos) {
        throw new ErroApi(404, 'NAO_ENCONTRADO', 'Bloco de conteúdo não encontrado.');
    }
    return res.status(200).json({ mensagem: 'Bloco de conteúdo excluído.' });
}

module.exports = {
    listarBanners,
    listarTodosBanners,
    salvarBanner,
    atualizarBanner,
    excluirBanner,
    reordenarBanners,
    listarBlocos,
    obterBloco,
    salvarBloco,
    excluirBloco
};
