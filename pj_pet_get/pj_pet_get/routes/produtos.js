const express = require('express');
const router = express.Router();
const db = require('../db/conn'); 

router.get('/', async (req, res) => {
    try {
        const [produtos] = await db.query('SELECT * FROM produtos');
        res.status(200).json(produtos);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao conectar com o banco de dados.' });
    }
});

module.exports = router;