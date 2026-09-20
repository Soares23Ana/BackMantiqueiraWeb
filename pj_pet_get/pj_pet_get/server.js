const express = require('express');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware para processar JSON nas requisições
app.use(express.json());

// Importação das Rotas
const authRoutes = require('./routes/auth');
const produtosRoutes = require('./routes/produtos');

// Definição dos Endpoints
app.use('/auth', authRoutes);
app.use('/produtos', produtosRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor a rodar na porta ${PORT}`);
});