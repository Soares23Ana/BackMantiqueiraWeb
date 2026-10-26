// Leva bancos criados por versões antigas (BancoMantiqueira.sql anterior, migrations de 20261009
// ou sequelize.sync) para a mesma estrutura da 001. Em um banco novo, quase tudo aqui é no-op.

async function colunas(conexao, tabela) {
    const [linhas] = await conexao.query(
        `SELECT COLUMN_NAME AS nome, COLUMN_TYPE AS tipo, IS_NULLABLE AS nulo, COLUMN_DEFAULT AS padrao
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tabela]
    );
    return new Map(linhas.map((linha) => [linha.nome, linha]));
}

async function removerIndicesDuplicados(conexao, tabela, log) {
    const [linhas] = await conexao.query(
        `SELECT INDEX_NAME AS nome, NON_UNIQUE AS naoUnico,
                GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS colunas
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'
         GROUP BY INDEX_NAME, NON_UNIQUE`,
        [tabela]
    );
    const vistos = new Map();
    // Mantém o nome mais curto (ex.: "email") e remove as cópias "email_2", "email_3"...
    for (const indice of [...linhas].sort((a, b) => a.nome.length - b.nome.length || a.nome.localeCompare(b.nome))) {
        const chave = `${indice.naoUnico}:${indice.colunas}`;
        if (vistos.has(chave)) {
            await conexao.query(`ALTER TABLE \`${tabela}\` DROP INDEX \`${indice.nome}\``);
            log(`  índice duplicado removido: ${tabela}.${indice.nome}`);
        } else {
            vistos.set(chave, indice.nome);
        }
    }
}

async function up(conexao, { log }) {
    // usuarios
    const colunasUsuarios = await colunas(conexao, 'usuarios');
    if (colunasUsuarios.has('cpf_cnpj') && !colunasUsuarios.has('cnpj_cpf')) {
        await conexao.query('ALTER TABLE usuarios CHANGE COLUMN cpf_cnpj cnpj_cpf VARCHAR(18) NULL');
    }
    if (!colunasUsuarios.has('cnpj_cpf') && !colunasUsuarios.has('cpf_cnpj')) {
        await conexao.query('ALTER TABLE usuarios ADD COLUMN cnpj_cpf VARCHAR(18) NULL AFTER senha');
    }
    if (!colunasUsuarios.has('razao_social')) {
        await conexao.query('ALTER TABLE usuarios ADD COLUMN razao_social VARCHAR(150) NULL AFTER nome');
        await conexao.query("UPDATE usuarios SET razao_social = nome WHERE tipo = 'cliente'");
    }
    await conexao.query("UPDATE usuarios SET tipo = 'cliente' WHERE tipo IS NULL");
    await conexao.query(`
        ALTER TABLE usuarios
            MODIFY COLUMN tipo ENUM('cliente', 'funcionario', 'gerente', 'admin') NOT NULL DEFAULT 'cliente',
            MODIFY COLUMN criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);
    await removerIndicesDuplicados(conexao, 'usuarios', log);

    await conexao.query('ALTER TABLE enderecos MODIFY COLUMN estado CHAR(2) NOT NULL');

    // fornecedores e produtos
    await removerIndicesDuplicados(conexao, 'fornecedores', log);
    await conexao.query(
        'ALTER TABLE produtos MODIFY COLUMN criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    );

    // pedidos
    const colunasPedidos = await colunas(conexao, 'pedidos');
    if (!colunasPedidos.has('data_entrega')) {
        await conexao.query('ALTER TABLE pedidos ADD COLUMN data_entrega DATETIME NULL');
    }
    const tipoStatus = colunasPedidos.get('status').tipo;
    if (/Pendente|Separacao_Estoque|Em_Rota_Mantiqueira/.test(tipoStatus)) {
        await conexao.query(`
            ALTER TABLE pedidos MODIFY COLUMN status ENUM(
                'Pendente', 'Separacao_Estoque', 'Em_Rota_Mantiqueira',
                'Aguardando Separação', 'Em Separação', 'Saiu para Entrega', 'Entregue', 'Cancelado'
            ) NULL DEFAULT 'Aguardando Separação'
        `);
        await conexao.query(`
            UPDATE pedidos SET status = CASE status
                WHEN 'Pendente' THEN 'Aguardando Separação'
                WHEN 'Separacao_Estoque' THEN 'Em Separação'
                WHEN 'Em_Rota_Mantiqueira' THEN 'Saiu para Entrega'
                ELSE status
            END
        `);
    }
    await conexao.query(`
        ALTER TABLE pedidos
            MODIFY COLUMN status ENUM('Aguardando Separação', 'Em Separação', 'Saiu para Entrega', 'Entregue', 'Cancelado')
                NULL DEFAULT 'Aguardando Separação',
            MODIFY COLUMN data_pedido DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    `);

    // O sync antigo criou a FK do cliente com ON DELETE CASCADE: excluir um usuário apagaria seus pedidos.
    const [fksCliente] = await conexao.query(`
        SELECT k.CONSTRAINT_NAME AS nome, r.DELETE_RULE AS regra
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r
            ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = 'pedidos' AND k.COLUMN_NAME = 'id_cliente'
    `);
    if (fksCliente.some((fk) => fk.regra === 'CASCADE' || fk.regra === 'SET NULL')) {
        for (const fk of fksCliente) {
            await conexao.query(`ALTER TABLE pedidos DROP FOREIGN KEY \`${fk.nome}\``);
        }
        await conexao.query(`
            ALTER TABLE pedidos ADD CONSTRAINT fk_pedidos_cliente
                FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario)
        `);
        log('  FK pedidos.id_cliente recriada sem ON DELETE CASCADE');
    }

    // itens_pedido: bancos antigos guardavam preco_unitario; o valor histórico é preservado, mas deixa de ser obrigatório.
    const colunasItens = await colunas(conexao, 'itens_pedido');
    if (colunasItens.has('preco_unitario')) {
        await conexao.query('ALTER TABLE itens_pedido MODIFY COLUMN preco_unitario DECIMAL(10, 2) NULL');
    }
}

module.exports = { up };
