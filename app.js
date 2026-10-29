const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('node:path');
const config = require('./config/ambiente');
const { identificarRequisicao, padronizarErros } = require('./middlewares/requisicao');
const {
    limitadorGlobal,
    exigirBanco,
    rotaNaoEncontrada,
    tratarErros
} = require('./middlewares/seguranca');
const saudeControlador = require('./controllers/saudeControlador');

require('./models');

const authRoutes = require('./routes/auth');
const produtosRoutes = require('./routes/produtos');
const painelRoutes = require('./routes/painel');
const pedidosRoutes = require('./routes/pedidos');
const cmsRoutes = require('./routes/cms');
const clientesRoutes = require('./routes/clientes');
const taxonomiasRoutes = require('./routes/taxonomias');
const adminRoutes = require('./routes/admin');
const minhaContaRoutes = require('./routes/minhaConta');
const configuracoesRoutes = require('./routes/configuracoes');
const campanhasRoutes = require('./routes/campanhas');
const eventosRoutes = require('./routes/eventos');
const metricasRoutes = require('./routes/metricas');
const cepRoutes = require('./routes/cep');
const autenticarToken = require('./middlewares/authMiddleware');
const { exigirEquipe } = require('./middlewares/roleMiddleware');

// Front em desenvolvimento: Vite (5173, também por 127.0.0.1), vite preview (4173) e outras portas locais.
// Outras origens (ex.: o domínio do front em produção) vêm de CORS_ORIGINS.
const ORIGENS_PADRAO = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    'http://localhost:3001'
];

function criarApp() {
    const app = express();

    // Atrás de proxy/balanceador (ex.: Nginx na EC2), defina TRUST_PROXY=1 para o limite de requisições ver o IP real.
    if (config.trustProxy) {
        app.set('trust proxy', config.trustProxy);
    }

    const origensPermitidas = new Set([...ORIGENS_PADRAO, ...config.origensCors]);

    app.use(identificarRequisicao);
    // As imagens em /arquivos são exibidas pelo front em outra origem; por isso o CORP precisa ser cross-origin.
    app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
    app.use(compression());
    app.use(cors({
        origin: (origem, callback) => {
            callback(null, !origem || origensPermitidas.has(origem));
        },
        credentials: true,
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'Idempotency-Key'],
        exposedHeaders: ['X-Request-Id']
    }));

    // Fica antes do padronizador (o 503 mantém os campos de saúde) e fora do limite de requisições
    // para não derrubar o health check do balanceador.
    app.get('/saude', saudeControlador.verificarSaude);

    app.use(padronizarErros);
    app.get('/saude/detalhado', autenticarToken, exigirEquipe, saudeControlador.verificarSaudeDetalhada);
    app.use(express.json({ limit: config.limiteJson }));
    app.use('/arquivos', express.static(path.join(__dirname, 'publico')));

    const api = express.Router();
    // Consultas a serviços externos que não usam o banco: funcionam mesmo com o banco fora do ar.
    api.use('/cep', cepRoutes);
    api.use(exigirBanco);
    api.use('/auth', authRoutes);
    api.use('/produtos', produtosRoutes);
    api.use('/categorias', taxonomiasRoutes.categorias);
    api.use('/marcas', taxonomiasRoutes.marcas);
    api.use('/painel', painelRoutes);
    api.use('/pedidos', pedidosRoutes);
    api.use('/cms', cmsRoutes);
    api.use('/clientes', clientesRoutes);
    api.use('/admin', adminRoutes);
    api.use('/minha-conta', minhaContaRoutes);
    api.use('/configuracoes', configuracoesRoutes);
    api.use('/campanhas', campanhasRoutes);
    api.use('/eventos', eventosRoutes);
    api.use('/metricas', metricasRoutes);

    app.use('/api/v1', limitadorGlobal, api);

    app.use(rotaNaoEncontrada);
    // Deve permanecer após todas as rotas para capturar erros encaminhados pelo Express.
    app.use(tratarErros);

    return app;
}

module.exports = { criarApp };
