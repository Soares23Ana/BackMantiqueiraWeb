// Preparação comum dos testes: usa sempre o banco mantiqueira_test, recriado do zero pelas migrations.
process.env.NODE_ENV = 'test';

const config = require('../config/ambiente');
const { aplicarMigracoes, abrirConexao } = require('../db/migracoes');

async function recriarBancoDeTeste() {
    // Proteção extra: nunca apagar um banco que não seja de teste.
    if (!config.teste || !config.db.nome.endsWith('_test')) {
        throw new Error(`Recusado: ${config.db.nome} não é um banco de teste.`);
    }
    const conexao = await abrirConexao();
    try {
        await conexao.query(`DROP DATABASE IF EXISTS \`${config.db.nome}\``);
    } finally {
        await conexao.end();
    }
    await aplicarMigracoes({ nomeBanco: config.db.nome });
}

async function prepararApp() {
    await recriarBancoDeTeste();
    const sequelize = require('../db/conn');
    const { estado } = require('../db/conexao');
    await sequelize.authenticate();
    estado.conectado = true;
    const { criarApp } = require('../app');
    return { app: criarApp(), sequelize };
}

module.exports = { config, recriarBancoDeTeste, prepararApp };
