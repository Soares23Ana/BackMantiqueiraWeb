const express = require('express');
const { limitadorCnpj } = require('../middlewares/seguranca');
const { consultarCnpj } = require('../servicos/receita');

const router = express.Router();

// GET /cnpj/:cnpj (público): nome da empresa na Receita, para o front mostrar antes de enviar o cadastro.
router.get('/:cnpj', limitadorCnpj, async (req, res) => {
    return res.status(200).json(await consultarCnpj(req.params.cnpj));
});

module.exports = router;
