const { body, validationResult } = require('express-validator');

const regrasCadastro = () => {
    return [
        body('nome').trim().notEmpty().withMessage('O nome é obrigatório.'),
        body('email').trim().isEmail().withMessage('Informe um e-mail válido.'),
        body('senha').notEmpty().withMessage('A senha é obrigatória.'),
        body('telefone').optional({ checkFalsy: true }).trim()
    ];
};

const validarRequisicao = (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
        return next();
    }
    return res.status(422).json({ mensagem: errors.array()[0].msg });
};

module.exports = {
    regrasCadastro,
    validarRequisicao
};