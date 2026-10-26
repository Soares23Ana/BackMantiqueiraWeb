const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const logger = require('../lib/logger');

const pastaUploads = path.join(__dirname, '..', 'publico', 'uploads');
fs.mkdirSync(pastaUploads, { recursive: true });

const extensoesPorTipo = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};

const armazenamento = multer.diskStorage({
    destination: (req, arquivo, callback) => callback(null, pastaUploads),
    filename: (req, arquivo, callback) => {
        callback(null, `${randomUUID()}${extensoesPorTipo[arquivo.mimetype]}`);
    }
});

const multerImagem = multer({
    storage: armazenamento,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, arquivo, callback) => {
        if (!extensoesPorTipo[arquivo.mimetype]) {
            return callback(new Error('Formato inválido. Envie uma imagem JPEG, PNG, WEBP ou GIF.'));
        }
        return callback(null, true);
    }
});

function receberImagem(req, res, next) {
    multerImagem.single('imagem')(req, res, (erro) => {
        if (!erro) {
            return next();
        }
        const mensagem = erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE'
            ? 'A imagem deve ter no máximo 5 MB.'
            : erro.message;
        return res.status(400).json({ mensagem });
    });
}

async function verificarConteudoImagem(req, res, next) {
    if (!req.file) {
        return next();
    }

    try {
        const arquivo = await fsPromises.open(req.file.path, 'r');
        const cabecalho = Buffer.alloc(12);
        let bytesLidos;
        try {
            ({ bytesRead: bytesLidos } = await arquivo.read(cabecalho, 0, cabecalho.length, 0));
        } finally {
            await arquivo.close();
        }

        // Não confia apenas no MIME informado pelo cliente; confere a assinatura do arquivo.
        const conteudoValido =
            (req.file.mimetype === 'image/jpeg' &&
                cabecalho[0] === 0xff && cabecalho[1] === 0xd8 && cabecalho[2] === 0xff) ||
            (req.file.mimetype === 'image/png' &&
                cabecalho.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
            (req.file.mimetype === 'image/gif' &&
                ['GIF87a', 'GIF89a'].includes(cabecalho.toString('ascii', 0, 6))) ||
            (req.file.mimetype === 'image/webp' &&
                cabecalho.toString('ascii', 0, 4) === 'RIFF' &&
                cabecalho.toString('ascii', 8, 12) === 'WEBP');

        if (bytesLidos < 12 || !conteudoValido) {
            await fsPromises.unlink(req.file.path);
            return res.status(400).json({ mensagem: 'O arquivo enviado não é uma imagem válida.' });
        }
        return next();
    } catch (erro) {
        try {
            await fsPromises.unlink(req.file.path);
        } catch (erroRemocao) {
            if (erroRemocao.code !== 'ENOENT') {
                logger.error('Erro ao remover imagem inválida.', { erro: erroRemocao });
            }
        }
        logger.error('Erro ao validar imagem enviada.', { erro });
        return res.status(500).json({ mensagem: 'Não foi possível validar a imagem enviada.' });
    }
}

module.exports = { receberImagem, verificarConteudoImagem };
