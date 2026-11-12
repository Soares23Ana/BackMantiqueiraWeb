const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);
const DIA = 86400000;
const em = (dias) => new Date(Date.now() + dias * DIA).toISOString();

let app;
let sequelize;
let equipe;
const ids = {};

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Categoria, Marca } = require('../models');
    equipe = await criarUsuario('equipe');
    ids.produto = (await Produto.create({ sku: 'BD-1', nome: 'Produto BD 1', quantidade_estoque: 10 })).id_produto;
    ids.outro = (await Produto.create({ sku: 'BD-2', nome: 'Produto BD 2', quantidade_estoque: 10 })).id_produto;
    ids.categoria = (await Categoria.create({ nome: 'Higiene', slug: 'higiene' })).id_categoria;
    ids.marca = (await Marca.create({ nome: 'Marca Y', slug: 'marca-y' })).id_marca;
});

after(async () => {
    await sequelize.close();
});

const criarBanner = (campos) => {
    const req = request(app).post('/api/v1/cms').set('Authorization', equipe.auth);
    for (const [campo, valor] of Object.entries({ titulo: 'Banner', ...campos })) req.field(campo, String(valor));
    return req.attach('imagem', PNG, { filename: 'b.png', contentType: 'image/png' });
};
const criarCampanha = (corpo) => request(app).post('/api/v1/campanhas').set('Authorization', equipe.auth).send(corpo);

describe('campanhas com slug', () => {
    test('slug é gerado do título, único e devolvido em /campanhas/ativas', async () => {
        const a = await criarCampanha({ titulo: 'Semana da Higiene', inicio_em: em(-1), fim_em: em(5), produtos: [ids.produto] }).expect(201);
        assert.equal(a.body.campanha.slug, 'semana-da-higiene');
        ids.campanha = a.body.campanha.id_campanha;
        const b = await criarCampanha({ titulo: 'Semana da Higiene', inicio_em: em(-1), fim_em: em(5), produtos: [ids.outro] }).expect(201);
        assert.equal(b.body.campanha.slug, 'semana-da-higiene-2');
        const ativas = await request(app).get('/api/v1/campanhas/ativas').expect(200);
        assert.deepEqual(ativas.body.campanhas.map((c) => c.slug).sort(), ['semana-da-higiene', 'semana-da-higiene-2']);
        await criarCampanha({ titulo: 'Natal', inicio_em: em(10), fim_em: em(20), produtos: [ids.produto] }).expect(201);
        await criarCampanha({ titulo: 'Passada', inicio_em: em(-20), fim_em: em(-10), produtos: [ids.produto] }).expect(201);
    });

    test('GET /produtos?campanha= lista só os produtos de uma campanha ativa', async () => {
        const lista = async (slug) => (await request(app).get(`/api/v1/produtos?campanha=${slug}`).expect(200)).body.produtos.map((p) => p.sku);
        assert.deepEqual(await lista('semana-da-higiene'), ['BD-1']);
        assert.deepEqual(await lista('semana-da-higiene-2'), ['BD-2']);
        assert.deepEqual(await lista('natal'), []);
        assert.deepEqual(await lista('passada'), []);
        assert.deepEqual(await lista('nao-existe'), []);
        const filtros = await request(app).get('/api/v1/produtos/filtros?campanha=semana-da-higiene').expect(200);
        assert.equal(filtros.body.disponibilidade.em_estoque, 1);
    });
});

describe('banner com destino', () => {
    const destinoDe = (resposta) => resposta.body.banner.destino;

    test('cada tipo resolve o link interno', async () => {
        const casos = [
            [{ tipo_destino: 'produto', id_destino: ids.produto }, { tipo: 'produto', id: ids.produto, link: `/produto/${ids.produto}` }],
            [{ tipo_destino: 'categoria', id_destino: ids.categoria }, { tipo: 'categoria', id: ids.categoria, link: '/categoria/higiene' }],
            [{ tipo_destino: 'marca', id_destino: ids.marca }, { tipo: 'marca', id: ids.marca, link: '/marca/marca-y' }],
            [{ tipo_destino: 'campanha', id_destino: ids.campanha }, { tipo: 'campanha', id: ids.campanha, link: '/produtos?campanha=semana-da-higiene' }],
            [{ tipo_destino: 'link', link: 'https://exemplo.com/x' }, { tipo: 'link', id: null, link: 'https://exemplo.com/x' }],
            [{ tipo_destino: 'nenhum' }, { tipo: 'nenhum', id: null, link: null }],
            [{}, { tipo: 'nenhum', id: null, link: null }],
            // Formato antigo: só "link" vale como tipo "link".
            [{ link: '/promocoes' }, { tipo: 'link', id: null, link: '/promocoes' }]
        ];
        for (const [campos, esperado] of casos) {
            assert.deepEqual(destinoDe(await criarBanner(campos).expect(201)), esperado);
        }
        const publico = await request(app).get('/api/v1/cms').expect(200);
        assert.equal(publico.body.banners.length, casos.length);
        assert.deepEqual(publico.body.banners.map((b) => b.destino.tipo), casos.map(([, e]) => e.tipo));
        const todos = await request(app).get('/api/v1/cms/todos').set('Authorization', equipe.auth).expect(200);
        assert.equal(todos.body.banners[0].tipo_destino, 'produto');
    });

    test('destino inexistente ou inválido dá 422', async () => {
        for (const campos of [
            { tipo_destino: 'produto', id_destino: 999999 },
            { tipo_destino: 'categoria', id_destino: 999999 },
            { tipo_destino: 'marca', id_destino: 999999 },
            { tipo_destino: 'campanha', id_destino: 999999 },
            { tipo_destino: 'produto' },
            { tipo_destino: 'link' },
            { tipo_destino: 'link', link: 'javascript:alert(1)' },
            { tipo_destino: 'produto', id_destino: ids.produto, link: '/x' },
            { tipo_destino: 'loja', id_destino: 1 }
        ]) {
            const resposta = await criarBanner(campos).expect(422);
            assert.equal(resposta.body.codigo, 'VALIDACAO', JSON.stringify(campos));
        }
    });

    test('PATCH troca o destino e limpar o link volta para nenhum', async () => {
        const criado = await criarBanner({ tipo_destino: 'produto', id_destino: ids.produto }).expect(201);
        const url = `/api/v1/cms/${criado.body.banner.id_banner}`;
        const trocado = await request(app).patch(url).set('Authorization', equipe.auth).send({ tipo_destino: 'marca', id_destino: ids.marca }).expect(200);
        assert.equal(trocado.body.banner.destino.link, '/marca/marca-y');
        const campanha = await request(app).patch(url).set('Authorization', equipe.auth).send({ tipo_destino: 'campanha', id_destino: ids.campanha }).expect(200);
        assert.equal(campanha.body.banner.destino.link, '/produtos?campanha=semana-da-higiene');
        await request(app).patch(url).set('Authorization', equipe.auth).send({ tipo_destino: 'produto', id_destino: 999999 }).expect(422);
        const limpo = await request(app).patch(url).set('Authorization', equipe.auth).send({ link: '' }).expect(200);
        assert.deepEqual(limpo.body.banner.destino, { tipo: 'nenhum', id: null, link: null });
    });

    test('o clique segue registrado como evento banner_clique', async () => {
        const criado = await criarBanner({ tipo_destino: 'produto', id_destino: ids.produto }).expect(201);
        await request(app).post('/api/v1/eventos').send({ tipo: 'banner_clique', id_banner: criado.body.banner.id_banner }).expect(202);
    });
});
