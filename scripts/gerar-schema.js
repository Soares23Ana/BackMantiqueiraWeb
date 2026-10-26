// Regenera o BancoMantiqueira.sql (instalação nova) a partir das migrations.
// Aplica tudo em um banco temporário, copia a estrutura resultante e descarta o banco.
// Uso: npm run schema:gerar
const fs = require('node:fs');
const path = require('node:path');
const { aplicarMigracoes, abrirConexao } = require('../db/migracoes');

const BANCO_TEMPORARIO = 'mantiqueira_schema_tmp';
const DESTINO = path.join(__dirname, '..', 'BancoMantiqueira.sql');

async function principal() {
    const conexao = await abrirConexao();
    try {
        await conexao.query(`DROP DATABASE IF EXISTS \`${BANCO_TEMPORARIO}\``);
        await aplicarMigracoes({ nomeBanco: BANCO_TEMPORARIO });
        await conexao.query(`USE \`${BANCO_TEMPORARIO}\``);

        const [tabelas] = await conexao.query(
            `SELECT TABLE_NAME AS nome FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY CREATE_TIME, TABLE_NAME`,
            [BANCO_TEMPORARIO]
        );
        const blocos = [];
        for (const { nome } of tabelas) {
            const [[linha]] = await conexao.query(`SHOW CREATE TABLE \`${nome}\``);
            blocos.push(`${linha['Create Table'].replace(/ AUTO_INCREMENT=\d+/, '')};`);
        }

        const [migracoes] = await conexao.query(
            'SELECT versao, nome, checksum FROM schema_migrations ORDER BY versao'
        );
        const valores = migracoes
            .map((m) => `('${m.versao}', '${m.nome}', '${m.checksum}')`)
            .join(',\n');

        const conteudo = [
            '-- ===================================================',
            '-- Mantiqueira Distribuidora - instalação nova do banco',
            '-- ARQUIVO GERADO por "npm run schema:gerar" a partir de migrations/. Não edite à mão.',
            '-- Para bancos existentes, use "npm run migrar".',
            '-- Dados de exemplo ficam em seeds/ (ver README).',
            '-- ===================================================',
            '',
            'CREATE DATABASE IF NOT EXISTS mantiqueira_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;',
            'USE mantiqueira_db;',
            '',
            'SET FOREIGN_KEY_CHECKS = 0;',
            '',
            blocos.join('\n\n'),
            '',
            'SET FOREIGN_KEY_CHECKS = 1;',
            '',
            '-- Marca as migrations como aplicadas para que "npm run migrar" continue a partir daqui.',
            'INSERT INTO schema_migrations (versao, nome, checksum) VALUES',
            `${valores};`,
            ''
        ].join('\n');

        fs.writeFileSync(DESTINO, conteudo);
        console.log(`BancoMantiqueira.sql gerado com ${tabelas.length} tabelas e ${migracoes.length} migrations.`);
    } finally {
        await conexao.query(`DROP DATABASE IF EXISTS \`${BANCO_TEMPORARIO}\``);
        await conexao.end();
    }
}

principal().catch((erro) => {
    console.error(erro.message);
    process.exitCode = 1;
});
