const { ErroApi } = require('../lib/erros');
const logger = require('../lib/logger');
const { registrarAuditoria } = require('../servicos/auditoria');
const servico = require('../servicos/redefinicaoSenha');
const solicitacoes = require('../servicos/solicitacoesRedefinicao');
const { criarValidador, exigirObjeto, lancarSeHouverErros } = require('../helpers/validacaoUsuario');

async function gerar(req, res, { tipoEsperado, acao, entidade }) {
    const idUsuario = req.params.id;
    if (tipoEsperado === 'equipe' && String(req.usuario.id) === String(Number(idUsuario))) {
        throw new ErroApi(409, 'OPERACAO_NAO_PERMITIDA', 'Para a própria conta, use a troca de senha em "Minha conta".');
    }
    const { id_usuario: idAlvo, token, expira_em: expiraEm } = await servico.gerarLink({
        idUsuario, tipoEsperado, criadoPor: req.usuario.id
    });
    logger.info('Link de redefinição de senha gerado.', { id_usuario: idAlvo, por: req.usuario.id });
    // A trilha guarda só a validade: nunca o token nem o hash.
    await registrarAuditoria({
        usuario: req.usuario, acao, entidade, idEntidade: idAlvo, detalhe: { expira_em: expiraEm }
    });
    return res.status(201).json({
        mensagem: 'Link gerado. O token aparece só desta vez: envie-o ao usuário agora.',
        token,
        expira_em: expiraEm
    });
}

// POST /clientes/:id/redefinicao-senha (equipe): só para usuário do tipo cliente.
const gerarParaCliente = (req, res) => gerar(req, res, {
    tipoEsperado: 'cliente', acao: 'cliente.redefinicao_senha_gerada', entidade: 'cliente'
});

// POST /admin/usuarios/:id/redefinicao-senha (equipe com pode_gerenciar_equipe): só para usuário da equipe, nunca a própria conta.
const gerarParaEquipe = (req, res) => gerar(req, res, {
    tipoEsperado: 'equipe', acao: 'usuario.redefinicao_senha_gerada', entidade: 'usuario'
});

// POST /auth/redefinir-senha/validar { token }: não devolve nem altera nada além de { valido }.
async function validar(req, res) {
    const { token } = servico.validarCorpo(req.body, { comSenha: false });
    const valido = await servico.tokenValido(token);
    if (!valido) res.locals.tokenInvalido = true;
    return res.status(200).json({ valido });
}

// POST /auth/redefinir-senha { token, nova_senha }: não faz login automático.
async function redefinir(req, res) {
    const { token, novaSenha } = servico.validarCorpo(req.body, { comSenha: true });
    try {
        await servico.redefinirSenha({ token, novaSenha });
    } catch (erro) {
        if (erro.codigo === 'TOKEN_INVALIDO') res.locals.tokenInvalido = true;
        throw erro;
    }
    return res.status(200).json({ mensagem: 'Senha alterada. Entre com a nova senha.' });
}

// POST /auth/solicitar-redefinicao { cnpj } (público): o cliente pede uma nova senha. A resposta é sempre a mesma.
async function solicitar(req, res) {
    exigirObjeto(req.body);
    const v = criarValidador();
    v.camposPermitidos(req.body, ['cnpj']);
    if (typeof req.body.cnpj !== 'string' || !req.body.cnpj.trim() || req.body.cnpj.length > 30) v.erro('cnpj', 'Informe o CNPJ.');
    lancarSeHouverErros(v.erros);
    await solicitacoes.registrar(req.body.cnpj);
    return res.status(200).json({ mensagem: solicitacoes.MENSAGEM_PUBLICA });
}

// GET /clientes/redefinicoes-pendentes (equipe): pedidos de nova senha ainda sem atendimento.
async function listarPendentes(req, res) {
    const pedidos = await solicitacoes.listarPendentes();
    return res.status(200).json({ solicitacoes: pedidos, total: pedidos.length });
}

module.exports = { gerarParaCliente, gerarParaEquipe, validar, redefinir, solicitar, listarPendentes };
