const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../db/conn'); // Conexão com a base de dados

// 1. ROTA DE CADASTRO (Registo de Utilizador)
router.post('/register', async (req, res) => {
    const { nome, email, senha, tipo } = req.body;

    if (!nome || !email || !senha) {
        return res.status(400).json({ mensagem: "Por favor, preencha todos os campos!" });
    }

    try {
        // Verificar se o email já existe
        const [usuarios] = await db.query('SELECT * FROM usuarios WHERE email = ?', [email]);
        if (usuarios.length > 0) {
            return res.status(400).json({ mensagem: "E-mail já cadastrado!" });
        }

        // Criptografar a palavra-passe com bcrypt
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);

        // Inserir o novo utilizador (permitindo definir o tipo caso enviado)
        await db.query(
            'INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)',
            [nome, email, senhaHash, tipo || 'cliente']
        );

        return res.status(201).json({ mensagem: "Utilizador cadastrado com sucesso!" });

    } catch (erro) {
        return res.status(500).json({ mensagem: "Erro no servidor", erro: erro.message });
    }
});

// 2. ROTA DE LOGIN
router.post('/login', async (req, res) => {
    const { email, senha } = req.body;

    try {
        // Buscar utilizador na base de dados
        const [usuarios] = await db.query('SELECT * FROM usuarios WHERE email = ?', [email]);
        
        if (usuarios.length === 0) {
            return res.status(401).json({ mensagem: "E-mail ou senha incorretos." });
        }

        const usuario = usuarios[0];

        // Comparar a senha
        const senhaValida = await bcrypt.compare(senha, usuario.senha);
        if (!senhaValida) {
            return res.status(401).json({ mensagem: "E-mail ou senha incorretos." });
        }

        // Gerar o Token JWT INCLUINDO o tipo do utilizador
        const token = jwt.sign(
            { 
                id: usuario.id_usuario, 
                email: usuario.email, 
                tipo: usuario.tipo // <--- Adicionado para o RBAC funcionar
            },
            process.env.JWT_SECRET || 'seu_segredo_jwt',
            { expiresIn: '2h' }
        );

        return res.json({
            mensagem: "Autenticação realizada com sucesso!",
            token: token
        });

    } catch (erro) {
        return res.status(500).json({ mensagem: "Erro no servidor", erro: erro.message });
    }
});

module.exports = router;