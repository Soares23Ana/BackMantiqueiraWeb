// Banners com destino (tipo_destino + id_destino) e campanhas com slug único.
// Os banners que já têm link passam a ser do tipo "link"; as campanhas existentes ganham o slug gerado do título.
const { gerarSlug } = require('../lib/texto');

async function colunas(conexao, tabela) {
    const [linhas] = await conexao.query(
        'SELECT COLUMN_NAME AS nome FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [tabela]
    );
    return new Set(linhas.map((linha) => linha.nome));
}

async function up(conexao) {
    const banner = await colunas(conexao, 'conteudo_cms');
    if (!banner.has('tipo_destino')) {
        await conexao.query(`
            ALTER TABLE conteudo_cms
                ADD COLUMN tipo_destino ENUM('nenhum', 'produto', 'categoria', 'marca', 'campanha', 'link') NOT NULL DEFAULT 'nenhum' AFTER link,
                ADD COLUMN id_destino INT NULL AFTER tipo_destino
        `);
    }
    await conexao.query("UPDATE conteudo_cms SET tipo_destino = 'link' WHERE link IS NOT NULL AND link <> ''");

    const campanha = await colunas(conexao, 'campanhas');
    if (!campanha.has('slug')) {
        await conexao.query('ALTER TABLE campanhas ADD COLUMN slug VARCHAR(140) NULL AFTER titulo');
    }
    const [campanhas] = await conexao.query('SELECT id_campanha, titulo FROM campanhas WHERE slug IS NULL ORDER BY id_campanha');
    const usados = new Set((await conexao.query('SELECT slug FROM campanhas WHERE slug IS NOT NULL'))[0].map((linha) => linha.slug));
    for (const { id_campanha: id, titulo } of campanhas) {
        const base = gerarSlug(titulo) || 'campanha';
        let slug = base;
        for (let n = 2; usados.has(slug); n += 1) slug = `${base}-${n}`;
        usados.add(slug);
        await conexao.query('UPDATE campanhas SET slug = ? WHERE id_campanha = ?', [slug, id]);
    }
    await conexao.query('ALTER TABLE campanhas MODIFY COLUMN slug VARCHAR(140) NOT NULL');
    await conexao.query('ALTER TABLE campanhas ADD UNIQUE KEY uk_campanhas_slug (slug)');
}

module.exports = { up };
