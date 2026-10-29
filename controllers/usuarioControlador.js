const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Op, UniqueConstraintError } = require('sequelize');
const sequelize = require('../db/conn');
const { Usuario, Endereco } = require('../models');
const config = require('../config/ambiente');
const { ErroApi } = require('../lib/erros');
const { cnpjValido, normalizarCnpj } = require('../lib/cnpj');
const { validarCadastroCliente } = require('../helpers/validacaoUsuario');

const CUSTO_BCRYPT = 12;
// Hash de uma senha qualquer, com o mesmo custo dos reais: quando o usuário não existe, a comparação
// é feita contra ele para a resposta levar o mesmo tempo (não revela quais e-mails/CNPJs existem).
const HASH_FALSO = bcrypt.hashSync('senha-que-nunca-confere', CUSTO_BCRYPT);
const credenciaisInvalidas = () => new ErroApi(401, 'CREDENCIAIS_INVALIDAS', 'Credenciais inválidas.');

function gerarToken(usuario) {
    return jwt.sign({
        id: usuario.id_usuario,
        nome: usuario.nome,
        email: usuario.email,
        tipo: usuario.tipo
    }, config.jwtSecret, { expiresIn: config.jwtExpiraEm });
}

// Conflitos de cadastro: avisa qual campo já existe para o cliente poder corrigir.
async function verificarDuplicados({ cnpj, email }, transacao) {
    const existentes = await Usuario.findAll({
        where: { [Op.or]: [{ cnpj }, { email }] },
        attributes: ['cnpj', 'email'],
        transaction: transacao
    });
    const detalhes = [];
    if (existentes.some((usuario) => usuario.cnpj === cnpj)) {
        detalhes.push({ campo: 'cnpj', mensagem: 'Este CNPJ já está cadastrado.' });
    }
    if (existentes.some((usuario) => usuario.email.toLowerCase() === email)) {
        detalhes.push({ campo: 'email', mensagem: 'Este e-mail já está cadastrado.' });
    }
    if (detalhes.length > 0) {
        const codigo = detalhes[0].campo === 'cnpj' ? 'CNPJ_JA_CADASTRADO' : 'EMAIL_JA_CADASTRADO';
        throw new ErroApi(409, codigo, detalhes[0].mensagem, detalhes);
    }
}

// POST /auth/register: cadastro público, sempre como cliente, com o endereço principal na mesma transação.
async function cadastrar(req, res) {
    const { usuario, endereco } = validarCadastroCliente(req.body);
    const senhaHash = await bcrypt.hash(usuario.senha, CUSTO_BCRYPT);

    try {
        const novo = await sequelize.transaction(async (transacao) => {
            await verificarDuplicados(usuario, transacao);
            const criado = await Usuario.create(
                { ...usuario, senha: senhaHash, tipo: 'cliente' },
                { transaction: transacao }
            );
            await Endereco.create({ ...endereco, id_usuario: criado.id_usuario }, { transaction: transacao });
            return criado;
        });
        return res.status(201).json({
            mensagem: 'Cadastro realizado com sucesso. Entre com o CNPJ e a senha.',
            id_usuario: novo.id_usuario
        });
    } catch (erro) {
        // Dois cadastros simultâneos com o mesmo CNPJ/e-mail: o índice único barra o segundo.
        if (erro instanceof UniqueConstraintError) {
            const campo = Object.keys(erro.fields || {}).some((f) => f.includes('cnpj')) ? 'cnpj' : 'email';
            throw new ErroApi(409, campo === 'cnpj' ? 'CNPJ_JA_CADASTRADO' : 'EMAIL_JA_CADASTRADO',
                campo === 'cnpj' ? 'Este CNPJ já está cadastrado.' : 'Este e-mail já está cadastrado.');
        }
        throw erro;
    }
}

/**
 * Descobre como buscar o usuário pelo identificador:
 * - com "@": e-mail, apenas na equipe;
 * - sem "@": CNPJ válido de 14 dígitos, apenas entre clientes.
 * Retorna null se o formato não serve para nenhum dos dois.
 */
function criterioDeBusca(identificador) {
    if (typeof identificador !== 'string' || identificador.length > 100) return null;
    const valor = identificador.trim();
    if (valor.includes('@')) {
        return { email: valor.toLowerCase(), tipo: 'equipe' };
    }
    const cnpj = normalizarCnpj(valor);
    if (!cnpjValido(cnpj)) return null;
    return { cnpj, tipo: 'cliente' };
}

/**
 * POST /auth/login { identificador, senha }.
 * Qualquer falha (formato, usuário inexistente, perfil errado, senha errada, inativo) gera a mesma
 * resposta 401 "Credenciais inválidas", sempre depois de uma comparação bcrypt.
 */
async function autenticar(req, res) {
    const { identificador, senha } = req.body || {};
    const criterio = criterioDeBusca(identificador);
    const usuario = criterio
        ? await Usuario.findOne({
            where: criterio,
            attributes: ['id_usuario', 'nome', 'email', 'senha', 'tipo', 'pode_gerenciar_equipe', 'ativo']
        })
        : null;

    const senhaTexto = typeof senha === 'string' ? senha.slice(0, 72) : '';
    const senhaConfere = await bcrypt.compare(senhaTexto, usuario ? usuario.senha : HASH_FALSO);
    if (!usuario || !senhaConfere || !usuario.ativo || !senhaTexto) {
        throw credenciaisInvalidas();
    }

    // pode_gerenciar_equipe diz ao front se mostra o menu de gestão de usuários da equipe.
    return res.status(200).json({
        token: gerarToken(usuario),
        usuario: {
            id: usuario.id_usuario,
            nome: usuario.nome,
            email: usuario.email,
            tipo: usuario.tipo,
            pode_gerenciar_equipe: usuario.pode_gerenciar_equipe
        }
    });
}

function obterSessao(req, res) {
    const { id, nome, email, tipo, pode_gerenciar_equipe: podeGerenciarEquipe } = req.usuario;
    return res.status(200).json({ id, nome, email, tipo, pode_gerenciar_equipe: podeGerenciarEquipe });
}

async function listarTodos(req, res) {
    const usuarios = await Usuario.findAll({
        attributes: { exclude: ['senha', 'senha_alterada_em'] }
    });
    return res.status(200).json({ usuarios });
}

module.exports = { cadastrar, autenticar, obterSessao, listarTodos, CUSTO_BCRYPT };
