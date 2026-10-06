const { rateLimit } = require('express-rate-limit');

const respostaLimite = {
    sucesso: false,
    mensagem: 'Muitas requisições enviadas. Tente novamente em instantes.'
};

const limitadorGlobal = rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

const limitadorLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

function tratarErros(erro, req, res, next) {
    console.error(erro.stack || erro.message);

    if (res.headersSent) {
        return next(erro);
    }

    const status = Number.isInteger(erro.status) && erro.status >= 400 && erro.status < 600
        ? erro.status
        : Number.isInteger(erro.statusCode) && erro.statusCode >= 400 && erro.statusCode < 600
            ? erro.statusCode
            : 500;

    return res.status(status).json({
        sucesso: false,
        mensagem: erro.message || 'Erro interno no servidor.'
    });
}

module.exports = { limitadorGlobal, limitadorLogin, tratarErros };
