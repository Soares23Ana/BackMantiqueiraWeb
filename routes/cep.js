const express = require('express');
const { limitadorCep } = require('../middlewares/seguranca');
const { consultarCep } = require('../servicos/cep');

const router = express.Router();

// GET /cep/:cep (público): endereço para preencher o cadastro. 8 dígitos, com ou sem hífen.
router.get('/:cep', limitadorCep, async (req, res) => {
    return res.status(200).json(await consultarCep(req.params.cep));
});

module.exports = router;
