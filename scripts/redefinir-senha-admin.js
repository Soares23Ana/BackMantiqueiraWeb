// Recupera o acesso de um administrador (equipe ativa com pode_gerenciar_equipe) que perdeu a senha, inclusive em produção e no RDS.
// É o caminho para quando não há outro gestor que possa gerar o link em POST /api/v1/admin/usuarios/:id/redefinicao-senha.
// Uso: npm run redefinir-senha-admin [-- --email maria@empresa.com.br]
// O comando NÃO pede nem recebe senha: gera um token de redefinição (mesma tabela, mesmo mecanismo e mesma validade das rotas
// da equipe) e imprime só o token e a validade. Quem tem acesso ao servidor o repassa ao administrador, que escolhe a própria
// senha em /redefinir-senha?token=...
const config = require('../config/ambiente');
const logger = require('../lib/logger');
const { perguntar, Recusa } = require('./criar-admin');

// Aceita --email Valor e --email=Valor. Qualquer forma de --senha é recusada.
function lerArgumentos(argv) {
    const valores = {};
    for (let i = 0; i < argv.length; i += 1) {
        const [chave, valorJunto] = argv[i].split(/=(.*)/s);
        if (/^--senha/i.test(chave)) {
            throw new Recusa('Este comando não usa senha: ele gera um token e o administrador escolhe a senha em /redefinir-senha.');
        }
        if (chave !== '--email') {
            throw new Recusa(`Argumento desconhecido: ${argv[i]}. Use apenas --email.`);
        }
        const valor = valorJunto !== undefined ? valorJunto : argv[(i += 1)];
        if (valor === undefined) throw new Recusa('Informe um valor para --email.');
        valores.email = valor;
    }
    return valores;
}

const MENSAGEM_NAO_ENCONTRADO = 'Não há administrador ativo com esse e-mail (equipe ativa com permissão de gerenciar a equipe).';

async function buscarAdministrador(email) {
    const { Usuario } = require('../models');
    const usuario = await Usuario.findOne({
        where: { email: String(email).trim().toLowerCase(), tipo: 'equipe', ativo: true, pode_gerenciar_equipe: true },
        attributes: ['id_usuario', 'nome', 'email']
    });
    if (!usuario) throw new Recusa(MENSAGEM_NAO_ENCONTRADO);
    return usuario;
}

/**
 * Gera o token de redefinição do administrador (invalida os pendentes anteriores) e registra no log e na auditoria,
 * sem usuário (quem age é o terminal). O token só é devolvido a quem chama; nunca vai para o log nem para a auditoria.
 */
async function gerarTokenAdmin({ email }) {
    const { gerarLink } = require('../servicos/redefinicaoSenha');
    const { registrarAuditoria } = require('../servicos/auditoria');
    const administrador = await buscarAdministrador(email);
    let link;
    try {
        link = await gerarLink({ idUsuario: administrador.id_usuario, tipoEsperado: 'equipe', criadoPor: null });
    } catch (erro) {
        // Perdeu a condição entre a busca e a geração (ex.: foi desativado): mesma recusa.
        if (erro.status === 404 || erro.codigo === 'USUARIO_INATIVO') throw new Recusa(MENSAGEM_NAO_ENCONTRADO);
        throw erro;
    }
    logger.warn('Token de redefinição de senha de administrador gerado pelo terminal.', {
        id_usuario: administrador.id_usuario, expira_em: link.expira_em
    });
    await registrarAuditoria({
        usuario: null,
        acao: 'usuario.redefinicao_senha_gerada_por_terminal',
        entidade: 'usuario',
        idEntidade: administrador.id_usuario,
        detalhe: { expira_em: link.expira_em }
    });
    return { usuario: administrador, token: link.token, expira_em: link.expira_em };
}

async function principal() {
    const sequelize = require('../db/conn');
    try {
        const argumentos = lerArgumentos(process.argv.slice(2));
        console.error(`Banco de destino: ${config.db.nome} em ${config.db.host}:${config.db.porta} (NODE_ENV=${config.ambiente})`);
        await sequelize.authenticate();
        const email = argumentos.email ?? await perguntar('E-mail do administrador: ');
        const { token, expira_em: expiraEm } = await gerarTokenAdmin({ email });
        // Só o token e a validade vão para a saída padrão.
        console.log(`Token: ${token}`);
        console.log(`Validade: ${expiraEm.toISOString()} (${config.redefinicaoSenhaMinutos} minutos)`);
        console.error('Repasse o token ao administrador: ele escolhe a senha em /redefinir-senha?token=... O token não será mostrado de novo.');
    } catch (erro) {
        console.error(erro instanceof Recusa ? `Recusado: ${erro.message}` : `Erro: ${erro.message}`);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

if (require.main === module) {
    principal();
}

module.exports = { lerArgumentos, buscarAdministrador, gerarTokenAdmin, Recusa };
