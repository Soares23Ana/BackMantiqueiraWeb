// Preparação comum dos testes: usa sempre o banco mantiqueira_test, recriado do zero pelas migrations.
process.env.NODE_ENV = 'test';

// Fotos e backups dos testes vão para pastas temporárias, nunca para a pasta real de uploads.
const fsTemp = require('node:fs');
const osTemp = require('node:os');
const pathTemp = require('node:path');
const pastasTemporarias = [];
for (const variavel of ['UPLOADS_DIR', 'BACKUP_DIR']) {
    if (!process.env[variavel]) {
        process.env[variavel] = fsTemp.mkdtempSync(pathTemp.join(osTemp.tmpdir(), `mantiqueira-${variavel.toLowerCase()}-`));
        pastasTemporarias.push(process.env[variavel]);
    }
}
process.on('exit', () => {
    for (const pasta of pastasTemporarias) fsTemp.rmSync(pasta, { recursive: true, force: true });
});

// Os testes nunca acessam a internet: cada teste que precisa de um serviço externo simula o fetch.
globalThis.fetch = async (url) => {
    throw new Error(`Acesso à internet bloqueado nos testes: ${url}`);
};

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

let sequencial = 0;

// Cria um usuário direto no banco e devolve { usuario, token } com o mesmo formato do login.
async function criarUsuario(tipo, dados = {}) {
    const jwt = require('jsonwebtoken');
    const { Usuario } = require('../models');
    sequencial += 1;
    const usuario = await Usuario.create({
        nome: `${tipo} ${sequencial}`,
        email: `${tipo}${sequencial}@teste.com`,
        senha: 'hash-irrelevante',
        tipo,
        ...dados
    });
    const token = jwt.sign(
        { id: usuario.id_usuario, nome: usuario.nome, email: usuario.email, tipo: usuario.tipo },
        config.jwtSecret,
        { expiresIn: '1h' }
    );
    return { usuario, token, auth: `Bearer ${token}` };
}

const assert = require('node:assert/strict');

// Todo corpo de erro leva o request_id (o X-Request-Id da requisição); devolve o corpo sem ele para comparar o resto.
function semRequestId(corpo) {
    assert.equal(typeof corpo.request_id, 'string', 'o corpo de erro deve trazer request_id');
    const { request_id: _id, ...resto } = corpo;
    return resto;
}

module.exports = { config, recriarBancoDeTeste, prepararApp, criarUsuario, semRequestId };
