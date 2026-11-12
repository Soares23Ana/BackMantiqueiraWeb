// Categoria e subcategoria (2 níveis): categorias ganha id_pai (auto-relação). As categorias atuais viram principais
// (id_pai nulo). O nome é único dentro do mesmo pai (a coluna gerada "chave_pai" faz o nulo valer 0, para o índice
// também proteger as principais) e o slug continua único no geral.
// Nomes repetidos entre as categorias atuais (a regra não existia) ganham " (2)", " (3)"... para o índice poder ser criado.

async function up(conexao, { log }) {
    const [colunas] = await conexao.query(
        "SELECT COLUMN_NAME AS nome FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categorias'"
    );
    const existentes = new Set(colunas.map((coluna) => coluna.nome));
    if (!existentes.has('id_pai')) {
        await conexao.query('ALTER TABLE categorias ADD COLUMN id_pai INT NULL AFTER slug');
    }

    // Com collation ai_ci, "Higiene" e "higiene" são o mesmo nome.
    const [categorias] = await conexao.query('SELECT id_categoria, nome FROM categorias ORDER BY id_categoria');
    const usados = new Map();
    for (const { id_categoria: id, nome } of categorias) {
        const chave = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        const quantas = usados.get(chave) || 0;
        usados.set(chave, quantas + 1);
        if (quantas > 0) {
            const novoNome = `${nome} (${quantas + 1})`.slice(0, 100);
            await conexao.query('UPDATE categorias SET nome = ? WHERE id_categoria = ?', [novoNome, id]);
            log(`  categoria ${id} renomeada para "${novoNome}" (nome repetido)`);
        }
    }

    await conexao.query('ALTER TABLE categorias ADD COLUMN chave_pai INT GENERATED ALWAYS AS (IFNULL(id_pai, 0)) STORED');
    await conexao.query('ALTER TABLE categorias ADD UNIQUE KEY uk_categorias_pai_nome (chave_pai, nome)');
    await conexao.query('ALTER TABLE categorias ADD KEY idx_categorias_pai (id_pai)');
    await conexao.query(
        'ALTER TABLE categorias ADD CONSTRAINT fk_categorias_pai FOREIGN KEY (id_pai) REFERENCES categorias(id_categoria) ON DELETE RESTRICT'
    );
}

module.exports = { up };
