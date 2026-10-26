const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;
let cliente;
const produtos = {};
const ids = {};

const DIA = 24 * 60 * 60 * 1000;
const em = (dias) => new Date(Date.now() + dias * DIA).toISOString();
const criar = (corpo) => request(app).post('/api/v1/campanhas').set('Authorization', equipe.auth).send(corpo);

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto } = require('../models');
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
    for (const [sku, extra] of [['P-1', {}], ['P-2', {}], ['P-INATIVO', { ativo: false }]]) {
        produtos[sku] = (await Produto.create({ sku, nome: `Produto ${sku}`, quantidade_estoque: 40, ...extra })).id_produto;
    }
});

after(async () => {
    await sequelize.close();
});

describe('campanhas', () => {
    test('cria campanhas e calcula a situação pelas datas', async () => {
        const ativa = await criar({
            titulo: 'Semana da Higiene', selo: 'Leve 8 pague 6', inicio_em: em(-1), fim_em: em(5),
            produtos: [produtos['P-1'], produtos['P-INATIVO']]
        }).expect(201);
        assert.equal(ativa.body.campanha.situacao, 'ativa');
        assert.equal(ativa.body.campanha.total_produtos, 2);
        ids.ativa = ativa.body.campanha.id_campanha;

        const agendada = await criar({ titulo: 'Natal', inicio_em: em(30), fim_em: em(40), produtos: [produtos['P-2']] }).expect(201);
        assert.equal(agendada.body.campanha.situacao, 'agendada');
        assert.equal(agendada.body.campanha.selo, null);
        ids.agendada = agendada.body.campanha.id_campanha;

        const encerrada = await criar({ titulo: 'Volta às aulas', inicio_em: '2026-01-10', fim_em: '2026-02-10', produtos: [produtos['P-2']] }).expect(201);
        assert.equal(encerrada.body.campanha.situacao, 'encerrada');
        ids.encerrada = encerrada.body.campanha.id_campanha;
    });

    test('validação: selo até 40, período coerente, produtos existentes e sem repetir', async () => {
        const base = { titulo: 'Teste', inicio_em: em(1), fim_em: em(2), produtos: [produtos['P-1']] };
        const selo = await criar({ ...base, selo: 'x'.repeat(41) }).expect(422);
        assert.equal(selo.body.detalhes[0].campo, 'selo');
        await criar({ ...base, fim_em: em(0) }).expect(422);
        const inexistente = await criar({ ...base, produtos: [999999] }).expect(422);
        assert.match(inexistente.body.detalhes[0].mensagem, /999999/);
        await criar({ ...base, produtos: [produtos['P-1'], produtos['P-1']] }).expect(422);
        const vazio = await criar({}).expect(422);
        assert.deepEqual(vazio.body.detalhes.map((d) => d.campo).sort(), ['fim_em', 'inicio_em', 'produtos', 'titulo']);
        await criar({ ...base, limite_por_cliente: 3 }).expect(422);
    });

    test('GET /campanhas/ativas é público e mostra só as ativas, com produtos ativos no formato da vitrine', async () => {
        const { body } = await request(app).get('/api/v1/campanhas/ativas').expect(200);
        assert.deepEqual(body.campanhas.map((c) => c.titulo), ['Semana da Higiene']);
        const [campanha] = body.campanhas;
        assert.equal(campanha.selo, 'Leve 8 pague 6');
        assert.deepEqual(campanha.produtos.map((p) => p.sku), ['P-1']);
        assert.equal(campanha.produtos[0].disponibilidade, 'disponivel');
        assert.equal(campanha.produtos[0].estoque, undefined);
        assert.equal(campanha.produtos[0].preco, undefined);

        const logado = await request(app).get('/api/v1/campanhas/ativas').set('Authorization', cliente.auth).expect(200);
        assert.equal(logado.body.campanhas[0].produtos[0].estoque, 40);
    });

    test('equipe lista com filtro de situação; cliente não acessa a gestão', async () => {
        const todas = await request(app).get('/api/v1/campanhas').set('Authorization', equipe.auth).expect(200);
        assert.equal(todas.body.campanhas.length, 3);
        const agendadas = await request(app).get('/api/v1/campanhas?situacao=agendada').set('Authorization', equipe.auth).expect(200);
        assert.deepEqual(agendadas.body.campanhas.map((c) => c.id_campanha), [ids.agendada]);
        await request(app).get('/api/v1/campanhas?situacao=pausada').set('Authorization', equipe.auth).expect(400);
        await request(app).get('/api/v1/campanhas').set('Authorization', cliente.auth).expect(403);
        await criar({}).set('Authorization', cliente.auth).expect(403);
        const detalhe = await request(app).get(`/api/v1/campanhas/${ids.ativa}`).set('Authorization', equipe.auth).expect(200);
        assert.deepEqual(detalhe.body.campanha.produtos.map((p) => p.sku).sort(), ['P-1', 'P-INATIVO']);
    });

    test('edita: substitui produtos, antecipa o início e encerra antes do previsto', async () => {
        const url = `/api/v1/campanhas/${ids.agendada}`;
        const editada = await request(app).patch(url).set('Authorization', equipe.auth)
            .send({ inicio_em: em(-1), produtos: [produtos['P-1'], produtos['P-2']] }).expect(200);
        assert.equal(editada.body.campanha.situacao, 'ativa');
        assert.equal(editada.body.campanha.total_produtos, 2);
        assert.equal((await request(app).get('/api/v1/campanhas/ativas')).body.campanhas.length, 2);

        await request(app).patch(url).set('Authorization', equipe.auth).send({ fim_em: em(-2) }).expect(422);
        const encerrada = await request(app).patch(url).set('Authorization', equipe.auth).send({ fim_em: new Date().toISOString() }).expect(200);
        assert.equal(encerrada.body.campanha.situacao, 'encerrada');
        assert.equal((await request(app).get('/api/v1/campanhas/ativas')).body.campanhas.length, 1);
        await request(app).patch('/api/v1/campanhas/999999').set('Authorization', equipe.auth).send({ titulo: 'Nada' }).expect(404);
    });

    test('exclui', async () => {
        await request(app).delete(`/api/v1/campanhas/${ids.encerrada}`).set('Authorization', equipe.auth).expect(200);
        await request(app).delete(`/api/v1/campanhas/${ids.encerrada}`).set('Authorization', equipe.auth).expect(404);
        const [[{ total }]] = await sequelize.query('SELECT COUNT(*) AS total FROM campanhas_produtos WHERE id_campanha = ?',
            { replacements: [ids.encerrada] });
        assert.equal(total, 0);
    });
});
