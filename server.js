const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('node:path');
const {
    limitadorGlobal,
    tratarErros
} = require('./middlewares/seguranca');

dotenv.config();

const sequelize = require('./db/conn');
require('./models');

const app = express();

// Middleware para processar JSON nas requisições
app.use(express.json());
app.use(cors());
app.use(limitadorGlobal);

// Importação das Rotas
const authRoutes = require('./routes/auth');
const produtosRoutes = require('./routes/produtos');
const painelRoutes = require('./routes/painel');
const pedidosRoutes = require('./routes/pedidos');
const cmsRoutes = require('./routes/cms');

// Definição dos Endpoints
app.use('/auth', authRoutes);
app.use('/produtos', produtosRoutes);
app.use('/painel', painelRoutes);
app.use('/pedidos', pedidosRoutes);
app.use('/cms', cmsRoutes);
app.use('/arquivos', express.static(path.join(__dirname, 'publico')));

// Deve permanecer após todas as rotas para capturar erros encaminhados pelo Express.
app.use(tratarErros);

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await sequelize.authenticate();
        console.log('Conexão com o banco de dados estabelecida.');
        await sequelize.sync();
        console.log('Models sincronizados com o banco de dados.');

        app.listen(PORT, () => {
            console.log(`Servidor a rodar na porta ${PORT}`);
        });
    } catch (error) {
        console.error('Não foi possível iniciar o servidor:', error);
        process.exitCode = 1;
    }
}

startServer();