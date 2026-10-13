const { body, validationResult } = require('express-validator');

const regrasCadastro = () => {
    return [
        body('nome').trim().notEmpty().withMessage('O nome é obrigatório.'),
        body('email').trim().isEmail().withMessage('Informe um e-mail válido.'),
        body('senha').notEmpty().withMessage('A senha é obrigatória.'),
        body('telefone').optional({ checkFalsy: true }).trim().isLength({ max: 20 })
            .withMessage('O telefone deve ter no máximo 20 caracteres.'),
        body('razao_social').optional({ checkFalsy: true }).trim().isLength({ max: 150 })
            .withMessage('A razão social deve ter no máximo 150 caracteres.'),
        body('cnpj_cpf').optional({ checkFalsy: true }).trim().isLength({ max: 18 })
            .withMessage('O CNPJ/CPF deve ter no máximo 18 caracteres.')
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