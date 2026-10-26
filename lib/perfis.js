// Grupos de perfis usados nas rotas.
const EQUIPE = ['funcionario', 'gerente', 'admin'];
const GESTAO = ['gerente', 'admin'];

function ehEquipe(usuario) {
    return Boolean(usuario && EQUIPE.includes(usuario.tipo));
}

module.exports = { EQUIPE, GESTAO, ehEquipe };
