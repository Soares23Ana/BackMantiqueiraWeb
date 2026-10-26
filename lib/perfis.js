// Perfis: "cliente" (entra por CNPJ) e "equipe" (entra por e-mail; todos com as mesmas permissões
// na área do gestor). A gestão de usuários da equipe exige também pode_gerenciar_equipe.
const EQUIPE = ['equipe'];

function ehEquipe(usuario) {
    return Boolean(usuario && usuario.tipo === 'equipe');
}

function podeGerenciarEquipe(usuario) {
    return ehEquipe(usuario) && usuario.pode_gerenciar_equipe === true;
}

module.exports = { EQUIPE, ehEquipe, podeGerenciarEquipe };
