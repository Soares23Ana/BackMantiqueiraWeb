// Restringe a rota aos perfis informados após a validação do token.
const verificarPerfil = (perfisPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario || !perfisPermitidos.includes(req.usuario.tipo)) {
            return res.status(403).json({
                mensagem: "Acesso negado: Não tem permissão para realizar esta operação."
            });
        }
        next();
    };
};

module.exports = verificarPerfil;