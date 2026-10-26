const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const mysql = require('mysql2/promise');
const config = require('../config/ambiente');

const PASTA_MIGRACOES = path.join(__dirname, '..', 'migrations');
const PADRAO_ARQUIVO = /^(\d{3,})_([\w-]+)\.(sql|js)$/;
const NOME_LOCK = 'mantiqueira:migracoes';

// Lista as migrations numeradas (001_nome.sql ou 001_nome.js) em ordem. Subpastas são ignoradas.
function listarArquivos(pasta = PASTA_MIGRACOES) {
    const migracoes = fs.readdirSync(pasta, { withFileTypes: true })
        .filter((entrada) => entrada.isFile() && PADRAO_ARQUIVO.test(entrada.name))
        .map((entrada) => {
            const [, versao, nome, tipo] = entrada.name.match(PADRAO_ARQUIVO);
            const caminho = path.join(pasta, entrada.name);
            // CRLF é normalizado para o checksum não mudar com o autocrlf do Git no Windows.
            const conteudo = fs.readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n');
            return {
                versao,
                nome,
                tipo,
                arquivo: entrada.name,
                caminho,
                conteudo,
                checksum: createHash('sha256').update(conteudo).digest('hex')
            };
        })
        .sort((a, b) => Number(a.versao) - Number(b.versao));

    const versoes = new Set();
    for (const migracao of migracoes) {
        if (versoes.has(Number(migracao.versao))) {
            throw new Error(`Versão de migration duplicada: ${migracao.versao}`);
        }
        versoes.add(Number(migracao.versao));
    }
    return migracoes;
}

async function tabelaExiste(consultar, tabela) {
    const linhas = await consultar(
        'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [tabela]
    );
    return linhas.length > 0;
}

// Usado no start da API para avisar sobre migrations pendentes (somente leitura).
async function listarPendentes(sequelize) {
    const consultar = async (sql, valores) => (await sequelize.query(sql, { replacements: valores }))[0];
    const aplicadas = await tabelaExiste(consultar, 'schema_migrations')
        ? new Set((await consultar('SELECT versao FROM schema_migrations')).map((linha) => linha.versao))
        : new Set();
    return listarArquivos().filter((migracao) => !aplicadas.has(migracao.versao));
}

async function abrirConexao(nomeBanco) {
    const conexao = await mysql.createConnection({
        host: config.db.host,
        port: config.db.porta,
        user: config.db.usuario,
        password: config.db.senha,
        multipleStatements: true,
        charset: 'utf8mb4',
        timezone: config.db.timezone
    });
    await conexao.query(`SET time_zone = '${config.db.timezone}'`);
    if (nomeBanco) {
        await conexao.query(
            `CREATE DATABASE IF NOT EXISTS \`${nomeBanco}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
        await conexao.query(`USE \`${nomeBanco}\``);
    }
    return conexao;
}

async function prepararControle(conexao) {
    await conexao.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            versao VARCHAR(20) NOT NULL PRIMARY KEY,
            nome VARCHAR(200) NOT NULL,
            checksum CHAR(64) NOT NULL,
            aplicado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            duracao_ms INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    const [linhas] = await conexao.query('SELECT versao, checksum FROM schema_migrations');
    return new Map(linhas.map((linha) => [linha.versao, linha.checksum]));
}

/**
 * Aplica as migrations pendentes no banco informado (criando-o se não existir).
 * Um GET_LOCK impede duas execuções simultâneas (ex.: duas instâncias subindo ao mesmo tempo).
 * Retorna { aplicadas, alertas }.
 */
async function aplicarMigracoes({ nomeBanco = config.db.nome, log = () => {}, apenasStatus = false } = {}) {
    if (!/^\w{1,64}$/.test(nomeBanco)) {
        throw new Error('Nome de banco inválido.');
    }
    const arquivos = listarArquivos();
    const conexao = await abrirConexao(nomeBanco);
    const alertas = [];
    const aplicadas = [];

    try {
        const [[{ obtido }]] = await conexao.query('SELECT GET_LOCK(?, 60) AS obtido', [NOME_LOCK]);
        if (obtido !== 1) {
            throw new Error('Outra execução de migrations está em andamento.');
        }

        try {
            const jaAplicadas = await prepararControle(conexao);
            for (const migracao of arquivos) {
                const checksumAplicado = jaAplicadas.get(migracao.versao);
                if (checksumAplicado && checksumAplicado !== migracao.checksum) {
                    alertas.push(`${migracao.arquivo} foi alterada depois de aplicada. Crie uma migration nova em vez de editar uma antiga.`);
                }
            }

            const pendentes = arquivos.filter((migracao) => !jaAplicadas.has(migracao.versao));
            if (apenasStatus) {
                return { aplicadas: [], pendentes: pendentes.map((m) => m.arquivo), alertas };
            }

            for (const migracao of pendentes) {
                const inicio = Date.now();
                log(`Aplicando ${migracao.arquivo}...`);
                try {
                    if (migracao.tipo === 'sql') {
                        await conexao.query(migracao.conteudo);
                    } else {
                        // Migrations .js são usadas quando a alteração depende do estado atual do banco.
                        const modulo = require(migracao.caminho);
                        await modulo.up(conexao, { log });
                    }
                } catch (erro) {
                    erro.message = `Falha em ${migracao.arquivo}: ${erro.message}`;
                    throw erro;
                }
                const duracao = Date.now() - inicio;
                await conexao.query(
                    'INSERT INTO schema_migrations (versao, nome, checksum, duracao_ms) VALUES (?, ?, ?, ?)',
                    [migracao.versao, migracao.nome, migracao.checksum, duracao]
                );
                aplicadas.push(migracao.arquivo);
                log(`  ok (${duracao} ms)`);
            }
            return { aplicadas, pendentes: [], alertas };
        } finally {
            await conexao.query('SELECT RELEASE_LOCK(?)', [NOME_LOCK]);
        }
    } finally {
        await conexao.end();
    }
}

module.exports = { listarArquivos, listarPendentes, aplicarMigracoes, abrirConexao, PASTA_MIGRACOES };
