const express = require('express');
const { autenticacaoOpcional } = require('../middlewares/authMiddleware');
const { limitadorEventos } = require('../middlewares/seguranca');
const { registrarEvento, registrarVisita, validarEventoDoFront } = require('../servicos/eventos');

const router = express.Router();

/**
 * POST /eventos (público): visita, produto_visto, carrinho_adicionar, checkout_iniciado, banner_clique, campanha_clique.
 * Não guarda IP; se houver token válido, associa ao usuário. Responde 202 sem esperar nada além da gravação.
 */
router.post('/', limitadorEventos, autenticacaoOpcional, async (req, res) => {
    const dados = validarEventoDoFront(req.body);
    if (dados.tipo === 'visita') {
        const registrado = await registrarVisita({ sessao: dados.sessao, id_usuario: req.usuario ? req.usuario.id : null });
        return res.status(202).json({ registrado });
    }
    await registrarEvento({ ...dados, id_usuario: req.usuario ? req.usuario.id : null });
    return res.status(202).json({ registrado: true });
});

module.exports = router;
