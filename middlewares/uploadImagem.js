const fsPromises = require('node:fs/promises');
const multer = require('multer');
const logger = require('../lib/logger');
const { assinaturaConfere, lerCabecalho, LIMITE_IMAGEM_BYTES } = require('../lib/imagem');
const { PASTA_UPLOADS, EXTENSAO_POR_TIPO: extensoesPorTipo, garantirPasta, novoNomeDeUpload } = require('../lib/uploads');

const armazenamento = multer.diskStorage({
    destination: (req, arquivo, callback) => {
        garantirPasta().then(() => callback(null, PASTA_UPLOADS), callback);
    },
    filename: (req, arquivo, callback) => {
        callback(null, novoNomeDeUpload(arquivo.mimetype));
    }
});

const multerImagem = multer({
    storage: armazenamento,
    limits: { fileSize: LIMITE_IMAGEM_BYTES, files: 1 },
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
        // Não confia apenas no MIME informado pelo cliente; confere a assinatura do arquivo.
        const cabecalho = await lerCabecalho(req.file.path);
        if (!assinaturaConfere(req.file.mimetype, cabecalho)) {
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
