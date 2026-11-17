const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario, config } = require('./ajuda');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

let app;
let sequelize;
let equipe;
let cliente;
let idProduto;
let idCategoria;
let idMarca;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Categoria, Marca } = require('../models');
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
    idProduto = (await Produto.create({ sku: 'POP-1', nome: 'Produto pop' })).id_produto;
    idCategoria = (await Categoria.create({ nome: 'Higiene', slug: 'higiene' })).id_categoria;
    idMarca = (await Marca.create({ nome: 'Marca X', slug: 'marca-x' })).id_marca;
});

after(async () => {
    await sequelize.close();
});

const salvar = (corpo, auth = equipe.auth) => request(app).put('/api/v1/cms/blocos/popup').set('Authorization', auth).send(corpo);
const publico = async () => (await request(app).get('/api/v1/cms/popup').expect(200)).body.popup;
const agoraMais = (dias) => new Date(Date.now() + dias * 86400000).toISOString();

describe('pop-up pelo painel (GET /cms/popup)', () => {
    test('sem pop-up salvo, devolve popup: null', async () => {
        assert.equal(await publico(), null);
    });

    test('só a equipe salva; valida título, destino e datas', async () => {
        await salvar({ titulo: 'Oi' }, cliente.auth).expect(403);
        await request(app).put('/api/v1/cms/blocos/popup').send({ titulo: 'Oi' }).expect(401);
        const invalido = await salvar({ titulo: '', fim_em: '2020-01-01', inicio_em: '2021-01-01', tipo_destino: 'produto', id_destino: 999999, extra: 1 }).expect(422);
        assert.deepEqual(invalido.body.detalhes.map((d) => d.campo).sort(), ['extra', 'fim_em', 'id_destino', 'titulo']);
        await salvar({ titulo: 'Oi', tipo_destino: 'produto' }).expect(422);
        await salvar({ titulo: 'Oi', tipo_destino: 'link', link: 'javascript:alert(1)' }).expect(422);
    });

    test('salva com destino, mostra no público e resolve o link', async () => {
        const salvo = await salvar({ titulo: 'Novidade', texto: 'Venha conferir', tipo_destino: 'produto', id_destino: idProduto }).expect(200);
        assert.equal(salvo.body.bloco.destino.link, `/produto/${idProduto}`);
        const popup = await publico();
        assert.deepEqual(
            { titulo: popup.titulo, texto: popup.texto, destino: popup.destino, imagem_url: popup.imagem_url },
            { titulo: 'Novidade', texto: 'Venha conferir', destino: { tipo: 'produto', id: idProduto, link: `/produto/${idProduto}` }, imagem_url: null }
        );
        await salvar({ titulo: 'Cat', tipo_destino: 'categoria', id_destino: idCategoria }).expect(200);
        assert.equal((await publico()).destino.link, '/categoria/higiene');
        await salvar({ titulo: 'Marca', tipo_destino: 'marca', id_destino: idMarca }).expect(200);
        assert.equal((await publico()).destino.link, '/marca/marca-x');
        await salvar({ titulo: 'Link', tipo_destino: 'link', link: 'https://exemplo.com/x' }).expect(200);
        assert.deepEqual((await publico()).destino, { tipo: 'link', id: null, link: 'https://exemplo.com/x' });
        await salvar({ titulo: 'Sem destino' }).expect(200);
        assert.deepEqual((await publico()).destino, { tipo: 'nenhum', id: null, link: null });
    });

    test('respeita a janela de datas', async () => {
        await salvar({ titulo: 'Futuro', inicio_em: agoraMais(2), fim_em: agoraMais(5) }).expect(200);
        assert.equal(await publico(), null);
        await salvar({ titulo: 'Passado', inicio_em: agoraMais(-5), fim_em: agoraMais(-2) }).expect(200);
        assert.equal(await publico(), null);
        await salvar({ titulo: 'Agora', inicio_em: agoraMais(-1), fim_em: agoraMais(1) }).expect(200);
        assert.equal((await publico()).titulo, 'Agora');
        await salvar({ titulo: 'Só início', inicio_em: agoraMais(-1) }).expect(200);
        assert.equal((await publico()).titulo, 'Só início');
    });

    test('PATCH ativo liga e desliga', async () => {
        const url = '/api/v1/cms/blocos/popup';
        await request(app).patch(url).set('Authorization', equipe.auth).send({ ativo: false }).expect(200);
        assert.equal(await publico(), null);
        const ligado = await request(app).patch(url).set('Authorization', equipe.auth).send({ ativo: true }).expect(200);
        assert.equal(ligado.body.bloco.ativo, true);
        assert.ok(await publico());
    });

    test('imagem enviada pelo upload existente é mantida ao salvar de novo e o pop-up some das rotas de blocos públicas', async () => {
        const envio = await request(app).post('/api/v1/cms/blocos/popup/imagem').set('Authorization', equipe.auth)
            .attach('imagem', PNG, { filename: 'p.png', contentType: 'image/png' }).expect(200);
        const url = envio.body.bloco.imagem_url;
        assert.match(url, /^\/arquivos\/uploads\/[0-9a-f-]{36}\.png$/);
        await salvar({ titulo: 'Com imagem' }).expect(200);
        assert.equal((await publico()).imagem_url, url);
        assert.ok(fs.existsSync(path.join(config.uploads.dir, url.replace('/arquivos/uploads/', ''))));
        // Rotas genéricas de blocos não expõem o pop-up ao público.
        const lista = await request(app).get('/api/v1/cms/blocos').expect(200);
        assert.ok(!lista.body.blocos.some((b) => b.chave === 'popup'));
        await request(app).get('/api/v1/cms/blocos/popup').expect(404);
        const daEquipe = await request(app).get('/api/v1/cms/blocos/popup').set('Authorization', equipe.auth).expect(200);
        assert.equal(daEquipe.body.bloco.imagem_url, url);
        await request(app).post('/api/v1/cms/blocos/outro/imagem').set('Authorization', equipe.auth)
            .attach('imagem', PNG, { filename: 'p.png', contentType: 'image/png' }).expect(404);
        await request(app).delete('/api/v1/cms/blocos/popup').set('Authorization', equipe.auth).expect(200);
        assert.ok(!fs.existsSync(path.join(config.uploads.dir, url.replace('/arquivos/uploads/', ''))));
        assert.equal(await publico(), null);
    });
});
