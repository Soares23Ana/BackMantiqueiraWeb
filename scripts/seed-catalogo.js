// Carrega seeds/catalogo_inicial.csv (upsert por SKU). Pode rodar várias vezes: só altera o que mudou.
// Uso: npm run seed:catalogo                 → importa
//      npm run seed:catalogo -- --simular    → mostra o que mudaria, sem gravar
//      npm run seed:catalogo -- --desativar-ausentes → também desativa produtos que não estão no CSV
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/ambiente');
const sequelize = require('../db/conn');
const { importarCatalogo } = require('../servicos/importadorCatalogo');

const ARQUIVO = path.join(__dirname, '..', 'seeds', 'catalogo_inicial.csv');

async function principal() {
    const simular = process.argv.includes('--simular');
    const desativarAusentes = process.argv.includes('--desativar-ausentes');
    console.log(`Banco: ${config.db.nome} em ${config.db.host}${simular ? ' (simulação)' : ''}`);

    const relatorio = await importarCatalogo(fs.readFileSync(ARQUIVO, 'utf8'), {
        simular,
        desativarAusentes,
        origem: 'seeds/catalogo_inicial.csv'
    });
    const { erros, avisos, ...resumo } = relatorio;
    console.table(resumo);
    for (const aviso of avisos) console.warn(`AVISO: ${aviso}`);
    for (const erro of erros) console.error(`Linha ${erro.linha} (${erro.sku || 'sem SKU'}): ${erro.mensagem}`);
    if (erros.length > 0) process.exitCode = 1;
}

principal()
    .catch((erro) => {
        console.error(erro.message);
        process.exitCode = 1;
    })
    .finally(() => sequelize.close());
