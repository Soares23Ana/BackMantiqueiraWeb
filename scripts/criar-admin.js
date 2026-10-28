// Cria o primeiro administrador (equipe com pode_gerenciar_equipe) num ambiente novo, inclusive em produção e no RDS.
// Os demais usuários da equipe são criados por esse administrador em POST /api/v1/admin/usuarios.
// Uso: npm run criar-admin [-- --nome "Maria Silva" --email maria@empresa.com.br]
// A senha é sempre digitada no terminal, sem aparecer, e nunca vem por argumento nem por variável de ambiente.
const readline = require('node:readline');
const bcrypt = require('bcrypt');
const config = require('../config/ambiente');
const { validarUsuarioEquipe } = require('../helpers/validacaoUsuario');

const TRAVA = 'mantiqueira:criar-admin';

class Recusa extends Error {}

// Aceita --nome Valor, --nome=Valor, --email Valor e --email=Valor. Qualquer forma de --senha é recusada.
function lerArgumentos(argv) {
    const valores = {};
    for (let i = 0; i < argv.length; i += 1) {
        const [chave, valorJunto] = argv[i].split(/=(.*)/s);
        if (/^--senha/i.test(chave)) {
            throw new Recusa('A senha não pode ser passada por argumento. Rode sem --senha: ela será pedida no terminal, sem aparecer na tela.');
        }
        if (chave === '--nome' || chave === '--email') {
            const valor = valorJunto !== undefined ? valorJunto : argv[(i += 1)];
            if (valor === undefined) throw new Recusa(`Informe um valor para ${chave}.`);
            valores[chave.slice(2)] = valor;
        } else {
            throw new Recusa(`Argumento desconhecido: ${argv[i]}. Use apenas --nome e --email.`);
        }
    }
    return valores;
}

// Mesmas regras do cadastro (e-mail válido, senha de 8 a 72 caracteres) e as duas senhas iguais.
function validarDados({ nome, email, senha, confirmacao }) {
    let dados;
    try {
        dados = validarUsuarioEquipe({ nome, email, senha });
    } catch (erro) {
        if (!erro.detalhes) throw erro;
        throw new Recusa(erro.detalhes.map((detalhe) => detalhe.mensagem).join('\n'));
    }
    if (senha !== confirmacao) {
        throw new Recusa('As senhas não conferem.');
    }
    return dados;
}

async function verificarSemAdministrador() {
    const { Usuario } = require('../models');
    const existente = await Usuario.count({ where: { ativo: true, pode_gerenciar_equipe: true } });
    if (existente > 0) {
        throw new Recusa('Já existe um usuário ativo que pode gerenciar a equipe. Este comando só cria o primeiro acesso.\n' +
            'As outras contas da equipe são criadas por esse usuário em POST /api/v1/admin/usuarios.');
    }
}

/**
 * Cria o administrador. As verificações são refeitas segurando uma trava do MySQL, para duas execuções
 * ao mesmo tempo não criarem dois administradores. Grava só o hash da senha.
 */
async function criarAdmin({ nome, email, senha }) {
    const { Usuario } = require('../models');
    const { CUSTO_BCRYPT } = require('../controllers/usuarioControlador');
    const { executarComTrava } = require('../lib/travaMysql');
    const { executado, resultado } = await executarComTrava(TRAVA, async () => {
        await verificarSemAdministrador();
        if (await Usuario.findOne({ where: { email }, attributes: ['id_usuario'] })) {
            throw new Recusa(`O e-mail ${email} já está em uso por outro usuário.`);
        }
        return Usuario.create({
            nome,
            email,
            senha: await bcrypt.hash(senha, CUSTO_BCRYPT),
            tipo: 'equipe',
            ativo: true,
            pode_gerenciar_equipe: true,
            cnpj: null
        });
    }, { esperaSegundos: 10 });
    if (!executado) {
        throw new Recusa('Outra execução do criar-admin está em andamento. Tente de novo em instantes.');
    }
    return resultado;
}

function perguntar(texto, { entrada = process.stdin, saida = process.stdout } = {}) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: entrada, output: saida, terminal: false });
        saida.write(texto);
        rl.once('line', (linha) => {
            rl.close();
            resolve(linha.trim());
        });
    });
}

// Lê a senha com o terminal em modo "raw": nada do que é digitado aparece na tela.
function perguntarOculto(texto, { entrada = process.stdin, saida = process.stdout } = {}) {
    if (!entrada.isTTY || typeof entrada.setRawMode !== 'function') {
        return Promise.reject(new Recusa('A senha precisa ser digitada num terminal interativo (PowerShell, cmd ou ssh). ' +
            'No Git Bash, rode: winpty npm.cmd run criar-admin'));
    }
    return new Promise((resolve, reject) => {
        let senha = '';
        const terminar = (erro) => {
            entrada.removeListener('data', aoDigitar);
            entrada.setRawMode(false);
            entrada.pause();
            saida.write('\n');
            if (erro) reject(erro); else resolve(senha);
        };
        const aoDigitar = (pedaco) => {
            for (const caractere of String(pedaco)) {
                if (caractere === '\r' || caractere === '\n') return terminar();
                if (caractere === '\u0003') return terminar(new Recusa('Cancelado.'));
                if (caractere === '\u007f' || caractere === '\b') senha = senha.slice(0, -1);
                else senha += caractere;
            }
            return undefined;
        };
        saida.write(texto);
        entrada.setEncoding('utf8');
        entrada.setRawMode(true);
        entrada.resume();
        entrada.on('data', aoDigitar);
    });
}

const confirmado = (resposta) => resposta.trim().toLowerCase() === 'sim';

async function principal() {
    const sequelize = require('../db/conn');
    try {
        const argumentos = lerArgumentos(process.argv.slice(2));
        console.log(`Banco de destino: ${config.db.nome} em ${config.db.host}:${config.db.porta} (NODE_ENV=${config.ambiente})`);
        await sequelize.authenticate();
        await verificarSemAdministrador();

        const nome = argumentos.nome ?? await perguntar('Nome: ');
        const email = argumentos.email ?? await perguntar('E-mail: ');
        const senha = await perguntarOculto('Senha (8 a 72 caracteres, não aparece na tela): ');
        const confirmacao = await perguntarOculto('Repita a senha: ');
        const dados = validarDados({ nome, email, senha, confirmacao });

        console.log(`\nSerá criado o administrador ${dados.email} em ${config.db.nome} (${config.db.host}).`);
        if (!confirmado(await perguntar('Digite "sim" para criar: '))) {
            console.log('Nada foi criado.');
            return;
        }
        const usuario = await criarAdmin(dados);
        console.log(`\nAdministrador criado: ${usuario.email}`);
        console.log('Entre por POST /api/v1/auth/login com esse e-mail e a senha que você digitou.');
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

module.exports = { lerArgumentos, validarDados, criarAdmin, verificarSemAdministrador, perguntarOculto, confirmado, Recusa };
