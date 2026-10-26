// Usuários de teste para desenvolvimento. Recusa-se a rodar em produção ou contra o RDS.
// Uso: npm run seed:dev
//      npm run seed:dev -- --redefinir-senhas  → volta a senha dos usuários de teste para a padrão
const bcrypt = require('bcrypt');
const config = require('../config/ambiente');

const SENHA_PADRAO = process.env.SEED_SENHA || 'Mantiqueira@2026';

const USUARIOS = [
    { nome: 'Administrador Mantiqueira', email: 'admin@mantiqueira.com', tipo: 'admin', cargo: 'Administrador' },
    { nome: 'Gerente Geral', email: 'gerente@mantiqueira.com', tipo: 'gerente', cargo: 'Gerente' },
    { nome: 'Carlos Estoquista', email: 'funcionario@mantiqueira.com', tipo: 'funcionario', cargo: 'Estoquista', telefone: '11977777777' },
    {
        nome: 'Mercadinho da Esquina',
        razao_social: 'Mercadinho da Esquina LTDA',
        email: 'compras@mercadinho-exemplo.com.br',
        tipo: 'cliente',
        // 11.222.333/0001-81: CNPJ de exemplo com dígitos verificadores válidos.
        cnpj_cpf: '11222333000181',
        telefone: '11999999999',
        endereco: {
            cep: '13870-000',
            logradouro: 'Rua das Flores',
            numero: '100',
            bairro: 'Centro',
            cidade: 'São João da Boa Vista',
            estado: 'SP',
            principal: true
        }
    }
];

function verificarAmbienteSeguro(cfg = config, env = process.env) {
    if (cfg.producao) {
        return 'NODE_ENV=production: o seed de desenvolvimento não roda em produção.';
    }
    if (/rds\.amazonaws\.com$/i.test(cfg.db.host) && env.SEED_DEV_PERMITIR_REMOTO !== '1') {
        return `DB_HOST aponta para o RDS (${cfg.db.host}). Defina SEED_DEV_PERMITIR_REMOTO=1 se for mesmo um banco de testes.`;
    }
    return null;
}

async function principal() {
    const motivo = verificarAmbienteSeguro();
    if (motivo) {
        console.error(`Recusado: ${motivo}`);
        process.exitCode = 1;
        return;
    }
    const sequelize = require('../db/conn');
    const { Usuario, Endereco } = require('../models');
    const redefinir = process.argv.includes('--redefinir-senhas');
    try {
        const hash = await bcrypt.hash(SENHA_PADRAO, 12);
        for (const { endereco, ...dados } of USUARIOS) {
            const [usuario, criado] = await Usuario.findOrCreate({
                where: { email: dados.email },
                defaults: { ...dados, senha: hash }
            });
            if (!criado && redefinir) {
                await usuario.update({ senha: hash });
            }
            if (criado && endereco) {
                await Endereco.create({ ...endereco, id_usuario: usuario.id_usuario });
            }
            console.log(`${criado ? 'criado   ' : 'existente'} ${dados.tipo.padEnd(11)} ${dados.cnpj_cpf || dados.email}`);
        }
        console.log(`\nSenha dos usuários criados${redefinir ? '/redefinidos' : ''}: ${SENHA_PADRAO}`);
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

module.exports = { verificarAmbienteSeguro, USUARIOS };
