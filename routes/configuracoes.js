const express = require('express');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');
const { ErroApi } = require('../lib/erros');
const configuracoes = require('../servicos/configuracoes');

const router = express.Router();

// GET /configuracoes/publicas: { whatsapp, telefone_contato, email_contato, horario_atendimento, aviso_topo }.
router.get('/publicas', async (req, res) => {
    const lista = await configuracoes.listar({ somentePublicas: true });
    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).json(Object.fromEntries(lista.map((item) => [item.chave, item.valor])));
});

// GET /configuracoes (equipe): todas, com descrição e se são públicas.
router.get('/', autenticarToken, exigirEquipe, async (req, res) => {
    return res.status(200).json({ configuracoes: await configuracoes.listar() });
});

// PUT /configuracoes/:chave { valor } (equipe). valor null ou "" limpa a configuração.
router.put('/:chave', autenticarToken, exigirEquipe, async (req, res) => {
    if (!req.body || !('valor' in req.body)) {
        throw new ErroApi(422, 'VALIDACAO', 'Envie { "valor": ... }.');
    }
    const configuracao = await configuracoes.atualizar(req.params.chave, req.body.valor, req.usuario.id);
    return res.status(200).json({ mensagem: 'Configuração atualizada.', configuracao });
});

module.exports = router;
