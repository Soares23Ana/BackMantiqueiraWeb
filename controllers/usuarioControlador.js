const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { UniqueConstraintError } = require('sequelize');
const { Usuario } = require('../models');
const sequelize = require('../db/conn');

async function cadastrar(req, res) {
    const { nome, email, senha, telefone } = req.body;

    try {
        const existente = await Usuario.findOne({
            where: { email },
            attributes: ['id_usuario']
        });
        if (existente) {
            return res.status(409).json({ mensagem: 'E-mail já cadastrado.' });
        }

        const usuario = await Usuario.create({
            nome,
            email,
            senha: await bcrypt.hash(senha, 12),
            telefone
        });
        return res.status(201).json({
            mensagem: 'Usuário cadastrado com sucesso.',
            id_usuario: usuario.id_usuario
        });
    } catch (erro) {
        if (erro instanceof UniqueConstraintError) {
            return res.status(409).json({ mensagem: 'E-mail já cadastrado.' });
        }
        console.error('Erro ao cadastrar usuário:', erro);
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
            attributes: ['id_usuario', 'email', 'senha', 'tipo']
        });
        if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
            return res.status(401).json({ mensagem: 'E-mail ou senha incorretos.' });
        }
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET não está configurado.');
            return res.status(500).json({ mensagem: 'Erro ao autenticar usuário.' });
        }

        const token = jwt.sign({
            id: usuario.id_usuario,
            email: usuario.email,
            tipo: usuario.tipo
        }, process.env.JWT_SECRET, { expiresIn: '2h' });

        return res.status(200).json({
            mensagem: 'Autenticação realizada com sucesso.',
            token
        });
    } catch (erro) {
        console.error('Erro ao autenticar usuário:', erro);
        return res.status(500).json({ mensagem: 'Erro ao autenticar usuário.' });
    }
}

async function listarTodos(req, res) {
    try {
        const usuarios = await Usuario.findAll({
            attributes: { exclude: ['senha'] }
        });
        return res.status(200).json({ usuarios });
    } catch (erro) {
        console.error('Erro ao listar usuários:', erro);
        return res.status(500).json({ mensagem: 'Erro ao listar usuários.' });
    }
}

async function verificarConexao(req, res) {
    try {
        await sequelize.authenticate();
        return res.status(200).json({
            mensagem: 'API e banco de dados estão funcionando.'
        });
    } catch (erro) {
        console.error('Erro ao verificar conexão com o banco de dados:', erro);
        return res.status(500).json({ mensagem: 'Erro ao conectar ao banco de dados.' });
    }
}

module.exports = { cadastrar, autenticar, listarTodos, verificarConexao };
