const fs = require('node:fs/promises');
const { Banner } = require('../models');

async function removerArquivo(caminho) {
    if (!caminho) {
        return;
    }
    try {
        await fs.unlink(caminho);
    } catch (erro) {
        if (erro.code !== 'ENOENT') {
            console.error('Erro ao remover upload não utilizado:', erro);
        }
    }
}

async function listarBanners(req, res) {
    try {
        const banners = await Banner.findAll({
            where: { ativo: true },
            order: [['id_banner', 'DESC']]
        });
        return res.status(200).json({ banners });
    } catch (erro) {
        console.error('Erro ao listar banners:', erro);
        return res.status(500).json({ mensagem: 'Erro ao listar banners.' });
    }
}

async function salvarBanner(req, res) {
    const titulo = typeof req.body.titulo === 'string' ? req.body.titulo.trim() : '';
    const link = typeof req.body.link === 'string' ? req.body.link.trim() : '';
    if (!req.file) {
        return res.status(400).json({ mensagem: 'O arquivo de imagem é obrigatório.' });
    }
    if (!titulo) {
        await removerArquivo(req.file.path);
        return res.status(400).json({ mensagem: 'O título do banner é obrigatório.' });
    }
    if (titulo.length > 150) {
        await removerArquivo(req.file.path);
        return res.status(400).json({ mensagem: 'O título do banner deve ter até 150 caracteres.' });
    }
    if (link.length > 2048) {
        await removerArquivo(req.file.path);
        return res.status(400).json({ mensagem: 'O link do banner deve ter até 2048 caracteres.' });
    }
    if (link && !(
        (/^\/(?!\/)/.test(link) && !/[\\\u0000-\u001f]/.test(link)) ||
        (() => {
            try {
                const url = new URL(link);
                return url.protocol === 'http:' || url.protocol === 'https:';
            } catch {
                return false;
            }
        })()
    )) {
        await removerArquivo(req.file.path);
        return res.status(400).json({ mensagem: 'O link deve ser uma URL HTTP/HTTPS ou um caminho interno.' });
    }

    try {
        const banner = await Banner.create({
            titulo,
            link: link || null,
            imagem_url: `/arquivos/uploads/${req.file.filename}`,
            ativo: true
        });
        return res.status(201).json({
            mensagem: 'Banner salvo com sucesso.',
            banner
        });
    } catch (erro) {
        await removerArquivo(req.file.path);
        console.error('Erro ao salvar banner:', erro);
        return res.status(500).json({ mensagem: 'Erro ao salvar banner.' });
    }
}

module.exports = { listarBanners, salvarBanner };
