const { CarrinhoContato } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { listarAbandonados, temCarrinhoAbandonado } = require('../servicos/carrinhosAbandonados');

// GET /carrinhos-abandonados (equipe). Filtros: minutos (1 a 525600) ou dias (1 a 365), busca e contatado=true|false.
async function listar(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 20, limiteMaximo: 100 });
    let minutos;
    if (req.query.dias !== undefined) {
        const dias = Number(req.query.dias);
        if (!Number.isSafeInteger(dias) || dias < 1 || dias > 365) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', 'dias deve ser um inteiro de 1 a 365.');
        }
        minutos = dias * 24 * 60;
    }
    // "minutos" tem prioridade sobre "dias" quando os dois vêm.
    if (req.query.minutos !== undefined) {
        minutos = Number(req.query.minutos);
        if (!Number.isSafeInteger(minutos) || minutos < 1 || minutos > 525600) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', 'minutos deve ser um inteiro de 1 a 525600.');
        }
    }
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
    if (busca.length > 100) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', 'A busca deve ter no máximo 100 caracteres.');
    }
    let contatado;
    if (req.query.contatado !== undefined) {
        if (!['true', 'false'].includes(req.query.contatado)) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', 'contatado deve ser true ou false.');
        }
        contatado = req.query.contatado === 'true';
    }
    const resultado = await listarAbandonados({ minutos, busca, contatado, limite: paginacao.limite, offset: paginacao.offset });
    return res.status(200).json({
        minutos: resultado.minutos,
        carrinhos: resultado.carrinhos,
        paginacao: montarPaginacao(resultado.total, paginacao)
    });
}

// PATCH /carrinhos-abandonados/:id_cliente/contatado { observacao? } (equipe): registra o contato.
async function registrarContato(req, res) {
    const idCliente = Number(req.params.id_cliente);
    if (!Number.isSafeInteger(idCliente) || idCliente <= 0) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'Identificador de cliente inválido.');
    }
    const corpo = req.body || {};
    const extras = Object.keys(corpo).filter((campo) => campo !== 'observacao');
    if (extras.length > 0) {
        throw new ErroApi(422, 'VALIDACAO', `Campo não permitido: ${extras[0]}.`, [{ campo: extras[0], mensagem: `Campo não permitido: ${extras[0]}.` }]);
    }
    let observacao = null;
    if (corpo.observacao !== undefined && corpo.observacao !== null) {
        if (typeof corpo.observacao !== 'string' || corpo.observacao.trim().length > 500) {
            throw new ErroApi(422, 'VALIDACAO', 'A observação deve ser um texto de até 500 caracteres.',
                [{ campo: 'observacao', mensagem: 'A observação deve ser um texto de até 500 caracteres.' }]);
        }
        observacao = corpo.observacao.trim() || null;
    }
    if (!(await temCarrinhoAbandonado(idCliente))) {
        throw new ErroApi(404, 'CARRINHO_ABANDONADO_NAO_ENCONTRADO', 'Este cliente não tem carrinho abandonado.');
    }
    const contato = await CarrinhoContato.create({ id_usuario: idCliente, observacao, id_funcionario: req.usuario.id });
    return res.status(200).json({
        mensagem: 'Contato registrado.',
        contato: {
            id_usuario: idCliente,
            contatado_em: contato.criado_em,
            contatado_por: { id_usuario: req.usuario.id, nome: req.usuario.nome },
            observacao
        }
    });
}

module.exports = { listar, registrarContato };
