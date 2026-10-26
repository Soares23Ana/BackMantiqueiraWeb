const { podeGerenciarEquipe } = require('../lib/perfis');

// A mensagem é genérica de propósito: não revela que a rota existe nem qual perfil ela exige.
const acessoNegado = (res) => res.status(403).json({ mensagem: 'Acesso negado.', codigo: 'ACESSO_NEGADO' });

// Restringe a rota aos perfis informados após a validação do token.
const verificarPerfil = (perfisPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario || !perfisPermitidos.includes(req.usuario.tipo)) {
            return acessoNegado(res);
        }
        next();
    };
};

// Área do gestor: qualquer usuário da equipe.
const exigirEquipe = verificarPerfil(['equipe']);

// Gestão de usuários da equipe: equipe com pode_gerenciar_equipe.
function exigirGestaoDeEquipe(req, res, next) {
    if (!podeGerenciarEquipe(req.usuario)) {
        return acessoNegado(res);
    }
    next();
}

module.exports = verificarPerfil;
module.exports.exigirEquipe = exigirEquipe;
module.exports.exigirGestaoDeEquipe = exigirGestaoDeEquipe;
