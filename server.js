let config;
try {
    config = require('./config/ambiente');
} catch (erro) {
    // Sem configuração válida não há como subir: falha cedo com a lista do que corrigir.
    console.error(erro.message);
    process.exit(1);
}

const logger = require('./lib/logger');
const sequelize = require('./db/conn');
const { conectarComRetry, interromperConexao } = require('./db/conexao');
const { aoEncerrar, instalarHandlers } = require('./lib/encerramento');
const { criarApp } = require('./app');
const { iniciarJobs, pararJobs } = require('./jobs');

instalarHandlers();

const app = criarApp();
const servidor = app.listen(config.porta, () => {
    logger.info(`Servidor a rodar na porta ${config.porta}`, { ambiente: config.ambiente });
});

aoEncerrar('banco de dados', async () => {
    interromperConexao();
    await sequelize.close();
});
aoEncerrar('servidor HTTP', () => new Promise((resolve) => {
    servidor.close(() => resolve());
    servidor.closeIdleConnections();
}));
// Registrado por último para ser o primeiro a parar: nenhum job começa enquanto a API fecha.
aoEncerrar('jobs agendados', pararJobs);

// A API sobe mesmo com o banco fora do ar (o /saude informa o estado) e segue tentando conectar.
// Os jobs só começam depois que o banco responde.
conectarComRetry().then((conectado) => {
    if (conectado) iniciarJobs();
});
