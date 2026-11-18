const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { BaseError, ConnectionError } = require('sequelize');
const config = require('../config/ambiente');
const { documentoDoPedido } = require('../lib/chavePedidoSenha');
const logger = require('../lib/logger');
const { ErroApi, corpoErro } = require('../lib/erros');
const { estado } = require('../db/conexao');

const respostaLimite = corpoErro(429);

const limitadorGlobal = rateLimit({
    windowMs: 60 * 1000,
    limit: config.limites.global,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

// Por IP: só tentativas que falharam contam, para quem acerta a senha não ser bloqueado.
const limitadorLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.limites.login,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: corpoErro(429, {
        mensagem: 'Muitas tentativas de login. Tente novamente em alguns minutos.',
        codigo: 'MUITAS_TENTATIVAS'
    })
});

// Por IP: evita criação de contas em massa.
const limitadorCadastro = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: config.limites.cadastro,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: corpoErro(429, {
        mensagem: 'Muitos cadastros a partir desta rede. Tente novamente mais tarde.',
        codigo: 'MUITAS_TENTATIVAS'
    })
});

// Eventos de uso (POST /eventos): por IP, bem acima do uso normal de uma pessoa navegando.
const limitadorEventos = rateLimit({
    windowMs: 60 * 1000,
    limit: config.teste ? 10000 : 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

// Consulta de CEP (GET /cep/:cep): por IP, bem acima do preenchimento de um cadastro.
const limitadorCep = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

// Consulta de CNPJ na Receita (GET /cnpj/:cnpj): por IP.
const limitadorCnpj = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

// Cópia de imagem a partir de um link (POST /produtos/:id/imagem/link): por usuário, porque a rota faz chamadas externas.
const limitadorImagemLink = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (req) => `usuario:${req.usuario.id ?? req.usuario.id_usuario}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

// Geração de link de redefinição de senha (rotas da equipe): por usuário.
const limitadorRedefinicaoGerar = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    keyGenerator: (req) => `redefinicao:${req.usuario.id ?? req.usuario.id_usuario}`,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: respostaLimite
});

// Rotas públicas de redefinição de senha (validar e redefinir): por IP, 10 tentativas a cada 15 min. As duas rotas
// dividem o mesmo contador. Contam as que falham, inclusive a validação que responde 200 com { valido: false }
// (res.locals.tokenInvalido); quem acerta não é bloqueado.
function criarLimitadorRedefinicaoPublica(limite = config.teste ? 10000 : 10) {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: limite,
        requestWasSuccessful: (req, res) => res.statusCode < 400 && !res.locals.tokenInvalido,
        skipSuccessfulRequests: true,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: corpoErro(429, {
            mensagem: 'Muitas tentativas. Tente novamente em alguns minutos.',
            codigo: 'MUITAS_TENTATIVAS'
        })
    });
}
const limitadorRedefinicaoPublica = criarLimitadorRedefinicaoPublica();

// Pedido público de nova senha (POST /auth/redefinicao-senha/solicitar). Dois limites que contam TODOS os pedidos, também
// os que dão certo: por IP (5 a cada 15 min) e por CNPJ informado (3 por hora, exista o CNPJ ou não, para o limite não
// revelar nada). Os dois valores vêm de PEDIDO_SENHA_LIMITE_IP e PEDIDO_SENHA_LIMITE_CNPJ.
const respostaLimitePedidoSenha = corpoErro(429, {
    mensagem: 'Muitos pedidos de nova senha. Tente novamente mais tarde ou fale com a equipe pelo WhatsApp.',
    codigo: 'MUITAS_TENTATIVAS'
});
function criarLimitadorPedidoSenhaIp(limite = config.pedidoSenha.limiteIp) {
    return rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: limite,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: respostaLimitePedidoSenha
    });
}
function criarLimitadorPedidoSenhaCnpj(limite = config.pedidoSenha.limiteCnpj) {
    return rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: limite,
        // A chave é o documento normalizado (sem olhar se existe); sem documento legível, cai para o IP.
        keyGenerator: (req) => {
            const documento = documentoDoPedido(req);
            return documento ? `pedido-senha:${documento}` : ipKeyGenerator(req.ip);
        },
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: respostaLimitePedidoSenha
    });
}
const limitadorPedidoSenhaIp = criarLimitadorPedidoSenhaIp();
const limitadorPedidoSenhaCnpj = criarLimitadorPedidoSenhaCnpj();

// Enquanto a primeira conexão com o banco não acontece, a API responde 503 em vez de erros genéricos.
function exigirBanco(req, res, next) {
    if (estado.conectado) {
        return next();
    }
    return res.status(503).json({
        mensagem: 'Banco de dados indisponível. Tente novamente em instantes.',
        codigo: 'BANCO_INDISPONIVEL'
    });
}

function rotaNaoEncontrada(req, res) {
    return res.status(404).json({ mensagem: 'Rota não encontrada.', codigo: 'ROTA_NAO_ENCONTRADA' });
}

function tratarErros(erro, req, res, next) {
    if (res.headersSent) {
        return next(erro);
    }

    let status = 500;
    let corpo = {};
    if (erro instanceof ErroApi) {
        status = erro.status;
        corpo = { mensagem: erro.message, codigo: erro.codigo, detalhes: erro.detalhes };
    } else if (erro.type === 'entity.parse.failed') {
        status = 400;
        corpo = { mensagem: 'O corpo da requisição não é um JSON válido.', codigo: 'JSON_INVALIDO' };
    } else if (erro.type === 'entity.too.large') {
        status = 413;
        corpo = { mensagem: 'O corpo da requisição é grande demais.' };
    } else if (erro instanceof ConnectionError) {
        status = 503;
        corpo = { mensagem: 'Banco de dados indisponível. Tente novamente em instantes.', codigo: 'BANCO_INDISPONIVEL' };
    } else if (!(erro instanceof BaseError)) {
        // Erros HTTP de bibliotecas (ex.: body-parser) trazem status e mensagens seguras de exibir.
        const statusInformado = Number.isInteger(erro.status) ? erro.status : erro.statusCode;
        if (Number.isInteger(statusInformado) && statusInformado >= 400 && statusInformado < 500) {
            status = statusInformado;
            corpo = { mensagem: erro.expose ? erro.message : undefined };
        }
    }

    // Erros 500 nunca expõem a mensagem interna (pode conter SQL ou caminhos do servidor).
    if (status >= 500) {
        logger.error('Erro não tratado na requisição.', { erro });
    } else {
        logger.warn('Requisição recusada.', { status, codigo: corpo.codigo, mensagem: erro.message });
    }
    return res.status(status).json(corpoErro(status, corpo));
}

module.exports = {
    limitadorGlobal, limitadorLogin, limitadorCadastro, limitadorEventos, limitadorCep, limitadorCnpj, limitadorImagemLink,
    limitadorRedefinicaoGerar, limitadorRedefinicaoPublica, criarLimitadorRedefinicaoPublica,
    limitadorPedidoSenhaIp, limitadorPedidoSenhaCnpj, criarLimitadorPedidoSenhaIp, criarLimitadorPedidoSenhaCnpj,
    exigirBanco, rotaNaoEncontrada, tratarErros
};
