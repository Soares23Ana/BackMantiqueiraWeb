const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { importarCatalogo } = require('../servicos/importadorCatalogo');
    const { Endereco } = require('../models');
    const { USUARIOS } = require('../scripts/seed-dev');
    await importarCatalogo(fs.readFileSync(path.join(__dirname, '..', 'seeds', 'catalogo_inicial.csv'), 'utf8'));

    // Os mesmos usuários do seed:dev que o seed:demo procura.
    const { endereco, ...dadosCliente } = USUARIOS.find((u) => u.tipo === 'cliente');
    const { usuario: cliente } = await criarUsuario('cliente', dadosCliente);
    await Endereco.create({ ...endereco, id_usuario: cliente.id_usuario });
    await criarUsuario('equipe', USUARIOS.find((u) => u.pode_gerenciar_equipe));
});

after(async () => {
    await sequelize.close();
});

describe('seed:demo', () => {
    const { semearDemo, verificarAmbienteSeguro, CONFIGURACOES, BANNERS, CAMPANHA, PEDIDOS } = require('../scripts/seed-demo');
    const silencioso = { log: () => {} };
    const contar = async (tabela) => (await sequelize.query(`SELECT COUNT(*) AS total FROM ${tabela}`))[0][0].total;
    const estoques = async () => (await sequelize.query('SELECT sku, quantidade_estoque FROM produtos ORDER BY sku'))[0];

    test('recusa produção e RDS (mesma regra do seed:dev)', () => {
        const base = { producao: false, db: { host: 'localhost' } };
        assert.equal(verificarAmbienteSeguro(base, {}), null);
        assert.match(verificarAmbienteSeguro({ ...base, producao: true }, {}), /produção/);
        assert.match(verificarAmbienteSeguro({ ...base, db: { host: 'x.rds.amazonaws.com' } }, {}), /RDS/);
    });

    test('cria contatos, aviso, banners, campanha ativa e pedidos em cada status', async () => {
        await semearDemo(silencioso);

        const publicas = (await request(app).get('/api/v1/configuracoes/publicas').expect(200)).body;
        const valores = JSON.stringify(publicas);
        for (const valor of Object.values(CONFIGURACOES)) assert.ok(valores.includes(valor), valor);

        const banners = (await request(app).get('/api/v1/cms').expect(200)).body;
        const titulos = JSON.stringify(banners);
        for (const banner of BANNERS) {
            assert.ok(titulos.includes(banner.titulo));
            assert.match(banner.imagem_url, /^\/img\//);
        }

        const { campanhas } = (await request(app).get('/api/v1/campanhas/ativas').expect(200)).body;
        assert.equal(campanhas.length, 1);
        assert.equal(campanhas[0].titulo, CAMPANHA.titulo);
        assert.equal(campanhas[0].selo, CAMPANHA.selo);
        assert.deepEqual(campanhas[0].produtos.map((p) => p.sku).sort(), [...CAMPANHA.skus].sort());

        const [pedidos] = await sequelize.query('SELECT status FROM pedidos ORDER BY id_pedido');
        assert.deepEqual(pedidos.map((p) => p.status), PEDIDOS.map((p) => p.status));
        // Pelo fluxo real: histórico de cada mudança e o estoque do cancelado devolvido.
        const [[{ historico }]] = await sequelize.query('SELECT COUNT(*) AS historico FROM pedido_historico');
        assert.equal(historico, 5 + 1 + 2 + 3 + 1);
    });

    test('rodar de novo não duplica nada nem mexe no estoque', async () => {
        const antes = { banners: await contar('conteudo_cms'), campanhas: await contar('campanhas'),
            vinculos: await contar('campanhas_produtos'), pedidos: await contar('pedidos'),
            movimentacoes: await contar('movimentacoes_estoque'), estoque: await estoques() };
        await semearDemo(silencioso);
        assert.deepEqual({ banners: await contar('conteudo_cms'), campanhas: await contar('campanhas'),
            vinculos: await contar('campanhas_produtos'), pedidos: await contar('pedidos'),
            movimentacoes: await contar('movimentacoes_estoque'), estoque: await estoques() }, antes);
    });

    test('sem os usuários do seed:dev, pula os pedidos sem falhar', async () => {
        const mensagens = [];
        await sequelize.query("UPDATE usuarios SET cnpj = NULL WHERE tipo = 'cliente'");
        try {
            await semearDemo({ log: (m) => mensagens.push(m) });
        } finally {
            const { USUARIOS } = require('../scripts/seed-dev');
            await sequelize.query("UPDATE usuarios SET cnpj = ? WHERE tipo = 'cliente'",
                { replacements: [USUARIOS.find((u) => u.tipo === 'cliente').cnpj] });
        }
        assert.ok(mensagens.some((m) => /seed:dev/.test(m)));
    });
});
