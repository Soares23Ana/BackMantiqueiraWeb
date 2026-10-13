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

const origensPermitidas = new Set([
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
    ...(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origem) => origem.trim())
        .filter(Boolean)
]);

// Middleware para processar JSON nas requisições
app.use(cors({
    origin: (origem, callback) => {
        callback(null, !origem || origensPermitidas.has(origem));
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type']
}));
app.use(express.json());
app.use(limitadorGlobal);

// Importação das Rotas
const authRoutes = require('./routes/auth');
const produtosRoutes = require('./routes/produtos');
const painelRoutes = require('./routes/painel');
const pedidosRoutes = require('./routes/pedidos');
const cmsRoutes = require('./routes/cms');
const clientesRoutes = require('./routes/clientes');

// Definição dos Endpoints
app.use('/auth', authRoutes);
app.use('/produtos', produtosRoutes);
app.use('/painel', painelRoutes);
app.use('/pedidos', pedidosRoutes);
app.use('/cms', cmsRoutes);
app.use('/clientes', clientesRoutes);
app.use('/arquivos', express.static(path.join(__dirname, 'publico')));

// Deve permanecer após todas as rotas para capturar erros encaminhados pelo Express.
app.use(tratarErros);

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await sequelize.authenticate();
        console.log('Conexão com o banco de dados estabelecida.');
    } catch (error) {
        console.error('Não foi possível conectar ao banco de dados:', error);
        process.exitCode = 1;
        return;
    }

    sequelize.sync()
        .then(() => {
            console.log('Estruturas operacionais de pedidos e status sincronizadas com o MySQL.');
            app.listen(PORT, () => {
                console.log(`Servidor a rodar na porta ${PORT}`);
            });
        })
        .catch((error) => {
            console.error('Erro ao sincronizar a estrutura do MySQL:', error);
            process.exitCode = 1;
        });
}

startServer();