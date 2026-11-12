const multer = require('multer');
const { formatoDoNome, LIMITE_BYTES } = require('../lib/planilha');

// Planilha de importação (.csv ou .xlsx, até 5 MB) fica em memória e é lida direto pelo importador.
// A extensão é conferida aqui (.xls, .xlsm e .xlsb pedem para salvar como .xlsx ou CSV); a assinatura do .xlsx
// ("PK") é conferida na leitura, que registra a falha em sincronizacoes_log.
const multerPlanilha = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITE_BYTES, files: 1 },
    fileFilter: (req, arquivo, callback) => {
        try {
            formatoDoNome(arquivo.originalname);
            return callback(null, true);
        } catch (erro) {
            return callback(erro);
        }
    }
});

function receberPlanilha(req, res, next) {
    multerPlanilha.single('arquivo')(req, res, (erro) => {
        if (!erro) {
            return next();
        }
        const mensagem = erro instanceof multer.MulterError && erro.code === 'LIMIT_FILE_SIZE'
            ? 'O arquivo deve ter no máximo 5 MB.'
            : erro.message;
        return res.status(422).json({ mensagem, codigo: 'VALIDACAO' });
    });
}

module.exports = { receberPlanilha };
