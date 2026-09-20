const jwt = require('jsonwebtoken');

function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Pega o token depois do 'Bearer'

    if (!token) {
        return res.status(401).json({ mensagem: "Acesso negado. Token não fornecido!" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(403).json({ mensagem: "Token inválido ou expirado!" });
        }
        req.usuario = usuario;
        next(); // Autoriza a requisição a continuar
    });
}

module.exports = autenticarToken;