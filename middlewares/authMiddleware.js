const jwt = require('jsonwebtoken');

function autenticarToken(req, res, next) {
    const authHeader = req.get('Authorization');
    const match = authHeader && authHeader.match(/^Bearer\s+(\S+)$/i);
    const token = match && match[1];

    if (!token) {
        return res.status(401).json({ mensagem: "Acesso negado. Token não fornecido!" });
    }

    if (!process.env.JWT_SECRET) {
        console.error('JWT_SECRET não está configurado.');
        return res.status(500).json({ mensagem: 'Erro ao validar autenticação.' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(403).json({ mensagem: "Token inválido ou expirado!" });
        }
        req.usuario = usuario;
        next();
    });
}

module.exports = autenticarToken;