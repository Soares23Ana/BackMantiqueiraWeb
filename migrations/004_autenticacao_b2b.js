// Login B2B: o cliente entra pelo CNPJ, que passa a ser único, só com dígitos e válido.
// Nada é apagado: o valor que não puder virar um CNPJ válido e único vai para cnpj_original,
// e o cliente fica sem CNPJ (cnpj_cpf NULL) até a equipe corrigir em PUT /clientes/:id.
const { cnpjValido, somenteDigitos } = require('../lib/cnpj');

async function colunas(conexao) {
    const [linhas] = await conexao.query(
        "SELECT COLUMN_NAME AS nome FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'"
    );
    return new Set(linhas.map((linha) => linha.nome));
}

async function up(conexao, { log }) {
    const existentes = await colunas(conexao);
    if (!existentes.has('ativo')) {
        await conexao.query('ALTER TABLE usuarios ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE AFTER tipo');
    }
    if (!existentes.has('cnpj_original')) {
        await conexao.query('ALTER TABLE usuarios ADD COLUMN cnpj_original VARCHAR(18) NULL AFTER cnpj_cpf');
    }

    const [usuarios] = await conexao.query(
        'SELECT id_usuario, nome, email, tipo, cnpj_cpf FROM usuarios WHERE cnpj_cpf IS NOT NULL ORDER BY id_usuario'
    );
    const donoDoCnpj = new Map();
    const movidos = [];
    for (const usuario of usuarios) {
        const bruto = String(usuario.cnpj_cpf).trim();
        const digitos = somenteDigitos(bruto);
        let motivo = null;
        if (usuario.tipo !== 'cliente') {
            motivo = 'equipe não usa CNPJ';
        } else if (digitos.length === 11) {
            motivo = 'CPF não é aceito (plataforma B2B)';
        } else if (!cnpjValido(digitos)) {
            motivo = 'CNPJ inválido';
        } else if (donoDoCnpj.has(digitos)) {
            // O cadastro mais antigo fica com o CNPJ; os seguintes precisam de revisão.
            motivo = `CNPJ repetido (já usado pelo usuário #${donoDoCnpj.get(digitos)})`;
        }

        if (motivo) {
            await conexao.query(
                'UPDATE usuarios SET cnpj_original = cnpj_cpf, cnpj_cpf = NULL WHERE id_usuario = ?',
                [usuario.id_usuario]
            );
            movidos.push({ ...usuario, motivo });
        } else {
            donoDoCnpj.set(digitos, usuario.id_usuario);
            if (digitos !== bruto) {
                await conexao.query('UPDATE usuarios SET cnpj_cpf = ? WHERE id_usuario = ?', [digitos, usuario.id_usuario]);
            }
        }
    }

    await conexao.query(`
        ALTER TABLE usuarios
            MODIFY COLUMN cnpj_cpf VARCHAR(14) NULL,
            ADD UNIQUE KEY uk_usuarios_cnpj (cnpj_cpf),
            ADD CONSTRAINT ck_usuarios_cnpj CHECK (cnpj_cpf IS NULL OR cnpj_cpf REGEXP '^[0-9]{14}$')
    `);

    for (const usuario of movidos) {
        log(`  #${usuario.id_usuario} ${usuario.email}: "${usuario.cnpj_cpf}" movido para cnpj_original (${usuario.motivo})`);
    }
    const [semCnpj] = await conexao.query(
        "SELECT id_usuario, nome, email FROM usuarios WHERE tipo = 'cliente' AND cnpj_cpf IS NULL ORDER BY id_usuario"
    );
    if (semCnpj.length > 0) {
        log(`  ${semCnpj.length} cliente(s) sem CNPJ válido não conseguirão entrar até a equipe corrigir (GET /clientes?sem_cnpj=true):`);
        for (const cliente of semCnpj) {
            log(`    #${cliente.id_usuario} ${cliente.nome} <${cliente.email}>`);
        }
    }
}

module.exports = { up };
