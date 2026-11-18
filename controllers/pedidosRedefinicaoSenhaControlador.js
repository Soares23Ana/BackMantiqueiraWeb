const config = require('../config/ambiente');
const { ErroApi } = require('../lib/erros');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const servico = require('../servicos/pedidosRedefinicaoSenha');

const STATUS_VALIDOS = ['pendente', 'atendido', 'dispensado', 'expirado'];

// Endereço do site para montar o link: SITE_URL, ou a origem de quem chamou (o front), ou o próprio host da API.
function urlDoSite(req) {
    if (config.siteUrl) return config.siteUrl;
    const origem = req.get('origin');
    if (origem && /^https?:\/\/[^\s/]+$/.test(origem)) return origem;
    return `${req.protocol}://${req.get('host')}`;
}

// POST /auth/redefinicao-senha/solicitar { documento } (público): o cliente pede uma nova senha. A resposta é sempre a mesma.
async function solicitar(req, res) {
    const corpo = req.body;
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        throw new ErroApi(422, 'VALIDACAO', 'O corpo da requisição deve ser um objeto JSON.', [{ campo: 'corpo', mensagem: 'Envie um objeto JSON.' }]);
    }
    const extra = Object.keys(corpo).find((campo) => campo !== 'documento');
    if (extra) throw new ErroApi(422, 'VALIDACAO', `Campo não permitido: ${extra}.`, [{ campo: extra, mensagem: 'Campo não permitido.' }]);
    const cnpj = servico.documentoValido(corpo.documento);
    if (!cnpj) throw new ErroApi(422, 'VALIDACAO', 'Informe um CNPJ válido.', [{ campo: 'documento', mensagem: 'Informe um CNPJ válido.' }]);
    await servico.solicitar(cnpj);
    return res.status(200).json({ mensagem: servico.MENSAGEM_PUBLICA });
}

// GET /redefinicoes-senha/pedidos?status=pendente&pagina=&limite= (equipe)
async function listar(req, res) {
    const status = req.query.status === undefined ? 'pendente' : String(req.query.status);
    if (!STATUS_VALIDOS.includes(status)) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', `status deve ser um destes: ${STATUS_VALIDOS.join(', ')}.`);
    }
    const paginacao = lerPaginacao(req.query, { limitePadrao: 20, limiteMaximo: 100 });
    const resultado = await servico.listar({ status, limite: paginacao.limite, offset: paginacao.offset });
    return res.status(200).json({ pedidos: resultado.pedidos, paginacao: montarPaginacao(resultado.total, paginacao) });
}

// POST /redefinicoes-senha/pedidos/:id/enviar-link (equipe)
async function enviarLink(req, res) {
    const resposta = await servico.enviarLink({ idPedido: req.params.id, equipe: req.usuario, urlBase: urlDoSite(req) });
    // `mensagem` é o texto pronto para o WhatsApp (o link aparece só nesta resposta).
    return res.status(201).json(resposta);
}

// POST /redefinicoes-senha/pedidos/:id/dispensar (equipe)
async function dispensar(req, res) {
    const pedido = await servico.dispensar({ idPedido: req.params.id, equipe: req.usuario });
    return res.status(200).json({ mensagem: 'Pedido dispensado.', id_pedido: pedido.id_pedido, status: 'dispensado' });
}

module.exports = { solicitar, listar, enviarLink, dispensar };
