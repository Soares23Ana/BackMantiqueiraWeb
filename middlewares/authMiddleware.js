const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');

function autenticarToken(req, res, next) {
    const authHeader = req.get('Authorization');
    const match = authHeader && authHeader.match(/^Bearer\s+(\S+)$/i);
    const token = match && match[1];

    if (!token) {
        return res.status(401).json({
            sucesso: false,
            mensagem: 'Sessão inválida ou expirada.'
        });
    }

    if (!process.env.JWT_SECRET) {
        logger.error('JWT_SECRET não está configurado.');
        return res.status(500).json({ mensagem: 'Erro ao validar autenticação.' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(401).json({
                sucesso: false,
                mensagem: 'Sessão inválida ou expirada.'
            });
        }
        req.usuario = usuario;
        next();
    });
}

// Para rotas públicas que mostram mais dados a quem está logado: token ausente ou inválido segue como visitante.
function autenticacaoOpcional(req, res, next) {
    const authHeader = req.get('Authorization');
    const match = authHeader && authHeader.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
        return next();
    }
    jwt.verify(match[1], process.env.JWT_SECRET, (err, usuario) => {
        if (!err) {
            req.usuario = usuario;
        }
        next();
    });
}

module.exports = autenticarToken;
module.exports.autenticacaoOpcional = autenticacaoOpcional;