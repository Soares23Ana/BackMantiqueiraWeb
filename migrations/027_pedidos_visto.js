// Selo "Pedidos" do menu da equipe: pedidos NÃO VISTOS. O visto é compartilhado: quando alguém da equipe abre
// (ou age sobre) o pedido, ele deixa de contar para todos. visto_em NULL = ainda não visto.
// visto_por guarda quem viu primeiro; a FK é ON DELETE SET NULL, então excluir o usuário não é barrado (padrão de id_autor/id_funcionario).
// Os pedidos que já existem são marcados como vistos (visto_por NULL), senão o selo nasceria enorme no primeiro dia.
// Idempotente: confere colunas e índice antes de criar; só marca como vistos na primeira vez que a coluna é criada.

async function colunas(conexao, tabela) {
    const [linhas] = await conexao.query(
        'SELECT COLUMN_NAME AS nome FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [tabela]
    );
    return new Set(linhas.map((linha) => linha.nome));
}

async function existeNaTabela(conexao, tabela, consulta, nome) {
    const [linhas] = await conexao.query(consulta, [tabela, nome]);
    return linhas.length > 0;
}

async function up(conexao) {
    const existentes = await colunas(conexao, 'pedidos');
    const criouVistoEm = !existentes.has('visto_em');
    if (criouVistoEm) {
        await conexao.query('ALTER TABLE pedidos ADD COLUMN visto_em DATETIME NULL AFTER motivo_cancelamento');
    }
    if (!existentes.has('visto_por')) {
        await conexao.query('ALTER TABLE pedidos ADD COLUMN visto_por INT NULL AFTER visto_em');
    }
    if (!await existeNaTabela(conexao, 'pedidos',
        'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
        'idx_pedidos_visto_em')) {
        await conexao.query('ALTER TABLE pedidos ADD KEY idx_pedidos_visto_em (visto_em)');
    }
    if (!await existeNaTabela(conexao, 'pedidos',
        "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
        'fk_pedidos_visto_por')) {
        await conexao.query(
            'ALTER TABLE pedidos ADD CONSTRAINT fk_pedidos_visto_por FOREIGN KEY (visto_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL'
        );
    }
    if (criouVistoEm) {
        await conexao.query('UPDATE pedidos SET visto_em = NOW(), visto_por = NULL WHERE visto_em IS NULL');
    }
}

module.exports = { up };
