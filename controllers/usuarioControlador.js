const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { UniqueConstraintError } = require('sequelize');
const { Usuario } = require('../models');
const logger = require('../lib/logger');

async function cadastrar(req, res) {
    const { nome, email, senha, telefone, razao_social, cnpj_cpf, tipo, chave_gestor } = req.body;
    const emailCorporativo = typeof email === 'string' &&
        email.toLowerCase().endsWith('@mantiqueira.com');
    let tipoFinal = 'cliente';
    if (tipo === 'gerente') {
        const chaveGestorValida = typeof process.env.CHAVE_CADASTRO_GESTOR === 'string' &&
            process.env.CHAVE_CADASTRO_GESTOR.length > 0 &&
            chave_gestor === process.env.CHAVE_CADASTRO_GESTOR;
        if (!emailCorporativo || !chaveGestorValida) {
            return res.status(403).json({
                mensagem: 'Acesso negado: Chave de gestor inválida ou e-mail não corporativo.'
            });
        }
        tipoFinal = 'gerente';
    }

    try {
        const existente = await Usuario.findOne({
            where: { email },
            attributes: ['id_usuario']
        });
        if (existente) {
            return res.status(409).json({ mensagem: 'E-mail já cadastrado.' });
        }

        const senhaHash = await bcrypt.hash(senha, 12);
        const usuarioNovo = await Usuario.create({
            nome,
            razao_social,
            email,
            senha: senhaHash,
            cnpj_cpf,
            telefone,
            tipo: tipoFinal
        });
        return res.status(201).json({
            mensagem: 'Usuário cadastrado com sucesso.',
            id_usuario: usuarioNovo.id_usuario
        });
    } catch (erro) {
        if (erro instanceof UniqueConstraintError) {
            return res.status(409).json({ mensagem: 'E-mail já cadastrado.' });
        }
        logger.error('Erro ao cadastrar usuário.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao cadastrar usuário.' });
    }
}

async function autenticar(req, res) {
    const { email, senha } = req.body;
    if (!email || !senha) {
        return res.status(400).json({ mensagem: 'E-mail e senha são obrigatórios.' });
    }

    try {
        const usuario = await Usuario.findOne({
            where: { email },
            attributes: ['id_usuario', 'nome', 'email', 'senha', 'tipo']
        });
        if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
            return res.status(401).json({ mensagem: 'E-mail ou senha incorretos.' });
        }
        if (!process.env.JWT_SECRET) {
            logger.error('JWT_SECRET não está configurado.');
            return res.status(500).json({ mensagem: 'Erro ao autenticar usuário.' });
        }

        const token = jwt.sign({
            id: usuario.id_usuario,
            nome: usuario.nome,
            email: usuario.email,
            tipo: usuario.tipo
        }, process.env.JWT_SECRET, { expiresIn: '2h' });

        return res.status(200).json({
            mensagem: 'Autenticação realizada com sucesso.',
            token,
            usuario: {
                id: usuario.id_usuario,
                nome: usuario.nome,
                email: usuario.email,
                tipo: usuario.tipo
            }
        });
    } catch (erro) {
        logger.error('Erro ao autenticar usuário.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao autenticar usuário.' });
    }
}

function obterSessao(req, res) {
    const { id, nome, email, tipo } = req.usuario;
    return res.status(200).json({ id, nome, email, tipo });
}

async function listarTodos(req, res) {
    try {
        const usuarios = await Usuario.findAll({
            attributes: { exclude: ['senha'] }
        });
        return res.status(200).json({ usuarios });
    } catch (erro) {
        logger.error('Erro ao listar usuários.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao listar usuários.' });
    }
}

module.exports = { cadastrar, autenticar, obterSessao, listarTodos };
