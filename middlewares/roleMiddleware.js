// Restringe a rota aos perfis informados após a validação do token.
// A mensagem é genérica de propósito: não revela que a rota existe nem qual perfil ela exige.
const verificarPerfil = (perfisPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario || !perfisPermitidos.includes(req.usuario.tipo)) {
            return res.status(403).json({ mensagem: 'Acesso negado.', codigo: 'ACESSO_NEGADO' });
        }
        next();
    };
};

module.exports = verificarPerfil;
