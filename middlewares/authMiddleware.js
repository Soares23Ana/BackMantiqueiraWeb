const jwt = require('jsonwebtoken');
const config = require('../config/ambiente');

const sessaoInvalida = (res) => res.status(401).json({
    mensagem: 'Sessão inválida ou expirada.',
    codigo: 'NAO_AUTENTICADO'
});

function extrairToken(req) {
    const authHeader = req.get('Authorization');
    const match = authHeader && authHeader.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : null;
}

/**
 * Valida o token e confere no banco se o usuário ainda existe e está ativo.
 * Assim, desativar um usuário ou mudar o perfil vale na hora, sem esperar o token expirar.
 */
async function carregarUsuario(token) {
    let payload;
    try {
        payload = jwt.verify(token, config.jwtSecret);
    } catch {
        return null;
    }
    // Carregado aqui para evitar dependência circular com os models na inicialização.
    const { Usuario } = require('../models');
    const usuario = await Usuario.findByPk(payload.id, { attributes: ['id_usuario', 'nome', 'email', 'tipo', 'ativo'] });
    if (!usuario || !usuario.ativo) {
        return null;
    }
    return { id: usuario.id_usuario, nome: usuario.nome, email: usuario.email, tipo: usuario.tipo };
}

async function autenticarToken(req, res, next) {
    const token = extrairToken(req);
    if (!token) {
        return sessaoInvalida(res);
    }
    const usuario = await carregarUsuario(token);
    if (!usuario) {
        return sessaoInvalida(res);
    }
    req.usuario = usuario;
    return next();
}

// Para rotas públicas que mostram mais dados a quem está logado: token ausente ou inválido segue como visitante.
async function autenticacaoOpcional(req, res, next) {
    const token = extrairToken(req);
    if (token) {
        const usuario = await carregarUsuario(token);
        if (usuario) req.usuario = usuario;
    }
    return next();
}

module.exports = autenticarToken;
module.exports.autenticacaoOpcional = autenticacaoOpcional;
