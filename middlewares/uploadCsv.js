const path = require('node:path');
const multer = require('multer');

// CSV de importação fica em memória (até 5 MB) e é lido direto pelo importador.
const multerCsv = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, arquivo, callback) => {
        if (path.extname(arquivo.originalname).toLowerCase() !== '.csv') {
            return callback(new Error('Envie um arquivo .csv.'));
        }
        return callback(null, true);
    }
});

function receberCsv(req, res, next) {
    multerCsv.single('arquivo')(req, res, (erro) => {
        if (!erro) {
            return next();
        }
        const mensagem = erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE'
            ? 'O arquivo deve ter no máximo 5 MB.'
            : erro.message;
        return res.status(422).json({ mensagem, codigo: 'VALIDACAO' });
    });
}

module.exports = { receberCsv };
