const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const { PASTA_LOTE: PASTA_TEMPORARIA, garantirPasta, limparSobrasTemporarias } = require('../lib/uploads');

const LIMITE_ZIP_BYTES = 20 * 1024 * 1024;
// O ZIP temporário fica no disco da pasta de uploads (pasta oculta), não em /tmp: em algumas distribuições o /tmp é
// memória, e o envio em lote não pode consumir RAM da instância pequena.

const multerZip = multer({
    storage: multer.diskStorage({
        destination: (req, arquivo, callback) => {
            fsPromises.mkdir(PASTA_TEMPORARIA, { recursive: true }).then(() => callback(null, PASTA_TEMPORARIA), callback);
        },
        filename: (req, arquivo, callback) => callback(null, `${randomUUID()}.zip`)
    }),
    limits: { fileSize: LIMITE_ZIP_BYTES, files: 1 },
    fileFilter: (req, arquivo, callback) => {
        if (!/\.zip$/i.test(arquivo.originalname || '')) {
            return callback(Object.assign(new Error('Envie um arquivo .zip.'), { codigo: 'ZIP_INVALIDO' }));
        }
        return callback(null, true);
    }
});

// Recebe o ZIP em disco (campo "arquivo") e apaga o arquivo temporário quando a resposta termina.
function receberZip(req, res, next) {
    garantirPasta().then(() => limparSobrasTemporarias()).then(() => {
        multerZip.single('arquivo')(req, res, (erro) => {
            if (req.file) {
                res.once('close', () => fs.rm(req.file.path, { force: true }, () => {}));
            }
            if (!erro) return next();
            if (erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE') {
                return res.status(422).json({
                    mensagem: 'O ZIP deve ter no máximo 20 MB. Divida as fotos em mais de um ZIP.',
                    codigo: 'ZIP_MUITO_GRANDE'
                });
            }
            return res.status(422).json({ mensagem: erro.message, codigo: erro.codigo || 'VALIDACAO' });
        });
    }, next);
}

module.exports = { receberZip, LIMITE_ZIP_BYTES };
