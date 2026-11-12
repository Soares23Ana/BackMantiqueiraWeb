// Carrega o catálogo inicial, seeds/catalogo_inicial.csv (upsert por SKU). Pode rodar várias vezes: só altera o que mudou.
//
// Colunas: sku (código do portfólio), nome, nome_erp, categoria, subcategoria, marca, estoque, estoque_minimo,
// multiplo_venda, ativo, imagem_url e sku_antigo.
// - Produto existente com sku_antigo (ex.: SKU-101): o produto EXISTENTE troca o SKU (mantém o id, o estoque e os pedidos).
// - Produtos antigos "SKU-123" sem correspondência no arquivo ficam DESATIVADOS, nunca apagados.
// - O estoque é o do arquivo (valores de demonstração).
//
// Uso: npm run seed:catalogo                         → importa
//      npm run seed:catalogo -- --simular            → mostra o que mudaria, sem gravar
//      npm run seed:catalogo -- --desativar-ausentes → desativa TODO produto que não está no arquivo (não só os antigos)
//      npm run seed:catalogo -- --arquivo=caminho.csv → usa outro arquivo
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO_PADRAO = path.join(__dirname, '..', 'seeds', 'catalogo_inicial.csv');

/**
 * Importa o arquivo e devolve o relatório. Sem efeitos fora da importação (o runner abaixo imprime e fecha o banco).
 */
async function semearCatalogo({ arquivo = ARQUIVO_PADRAO, simular = false, desativarAusentes = false } = {}) {
    const { importarCatalogo } = require('../servicos/importadorCatalogo');
    return importarCatalogo(fs.readFileSync(arquivo), {
        simular,
        desativarAusentes,
        desativarLegados: true,
        origem: path.relative(path.join(__dirname, '..'), arquivo).replace(/\\/g, '/')
    });
}

async function principal() {
    const config = require('../config/ambiente');
    const sequelize = require('../db/conn');
    const simular = process.argv.includes('--simular');
    const desativarAusentes = process.argv.includes('--desativar-ausentes');
    const informado = process.argv.find((argumento) => argumento.startsWith('--arquivo='));
    const arquivo = informado ? path.resolve(informado.slice('--arquivo='.length)) : ARQUIVO_PADRAO;
    console.log(`Banco: ${config.db.nome} em ${config.db.host}${simular ? ' (simulação)' : ''}`);
    try {
        const relatorio = await semearCatalogo({ arquivo, simular, desativarAusentes });
        const { erros, avisos, abreviacoes_pendentes: pendentes, categorias_sem_mapa: semMapa, ...resumo } = relatorio;
        console.table(resumo);
        for (const aviso of avisos) console.warn(`AVISO: ${aviso}`);
        for (const item of pendentes) console.warn(`Abreviação não expandida: ${item.abreviacao} (${item.ocorrencias}x, ex.: ${item.exemplo})`);
        for (const item of semMapa) console.warn(`Categoria do portfólio sem mapa: ${item.categoria_erp} (${item.ocorrencias}x)`);
        for (const erro of erros) console.error(`Linha ${erro.linha} (${erro.sku || 'sem SKU'}): ${erro.mensagem}`);
        if (erros.length > 0) process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
}

if (require.main === module) {
    principal().catch((erro) => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}

module.exports = { semearCatalogo, ARQUIVO_PADRAO };
