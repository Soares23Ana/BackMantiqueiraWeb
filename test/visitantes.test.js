const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;
let cliente;
let Evento;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Evento } = require('../models'));
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
});

after(async () => {
    await sequelize.close();
});

const diaSP = (deslocamento = 0) =>
    new Date(Date.now() - 3 * 3600 * 1000 + deslocamento * 86400000).toISOString().slice(0, 10);
const visitar = (corpo, auth) => {
    const req = request(app).post('/api/v1/eventos');
    return (auth ? req.set('Authorization', auth) : req).send({ tipo: 'visita', ...corpo });
};
const metricas = (query = '', url = '/api/v1/metricas/visitantes') =>
    request(app).get(`${url}${query}`).set('Authorization', equipe.auth);

describe('POST /eventos com tipo visita', () => {
    test('exige a sessão', async () => {
        const resposta = await visitar({}).expect(422);
        assert.equal(resposta.body.detalhes[0].campo, 'sessao');
        await visitar({ sessao: 'curta' }).expect(422);
    });

    test('no máximo uma visita por sessão por dia; repetições são ignoradas', async () => {
        assert.equal((await visitar({ sessao: 'sessao-aaaa-1' }).expect(202)).body.registrado, true);
        assert.equal((await visitar({ sessao: 'sessao-aaaa-1' }).expect(202)).body.registrado, false);
        assert.equal((await visitar({ sessao: 'sessao-aaaa-1' }, cliente.auth).expect(202)).body.registrado, false);
        assert.equal((await visitar({ sessao: 'sessao-bbbb-2' }, cliente.auth).expect(202)).body.registrado, true);
        assert.equal(await Evento.count({ where: { tipo: 'visita' } }), 2);
        // Requisições simultâneas da mesma sessão também gravam uma só.
        await Promise.all(Array.from({ length: 5 }, () => visitar({ sessao: 'sessao-cccc-3' }).expect(202)));
        assert.equal(await Evento.count({ where: { tipo: 'visita', sessao: 'sessao-cccc-3' } }), 1);
    });

    test('no dia seguinte a mesma sessão conta de novo e o evento não guarda IP', async () => {
        await Evento.create({ tipo: 'visita', sessao: 'sessao-aaaa-1', dia_visita: diaSP(-1), criado_em: new Date(Date.now() - 86400000) });
        const [colunas] = await sequelize.query("SHOW COLUMNS FROM eventos WHERE Field IN ('ip', 'ip_origem', 'endereco_ip')");
        assert.equal(colunas.length, 0);
    });
});

describe('GET /metricas/visitantes e resumo', () => {
    test('totais, média diária e dias sem visita zerados', async () => {
        const de = diaSP(-2);
        const ate = diaSP(0);
        const resposta = await metricas(`?de=${de}&ate=${ate}`).expect(200);
        assert.deepEqual(resposta.body.periodo, { de, ate });
        // Hoje: 3 sessões (aaaa-1, bbbb-2 logada, cccc-3); ontem: aaaa-1; anteontem: ninguém.
        assert.equal(resposta.body.total_sessoes, 3);
        assert.deepEqual(resposta.body.por_dia, [
            { data: de, sessoes: 0, clientes_logados: 0 },
            { data: diaSP(-1), sessoes: 1, clientes_logados: 0 },
            { data: ate, sessoes: 3, clientes_logados: 1 }
        ]);
        assert.equal(resposta.body.media_diaria, 1.3);
    });

    test('o resumo traz visitantes sem a lista por dia', async () => {
        const resposta = await metricas(`?de=${diaSP(-2)}&ate=${diaSP(0)}`, '/api/v1/metricas/resumo').expect(200);
        assert.deepEqual(resposta.body.visitantes, { total_sessoes: 3, media_diaria: 1.3 });
        assert.equal(resposta.body.eventos.visita, 4);
    });

    test('só a equipe, e valida o período', async () => {
        await request(app).get('/api/v1/metricas/visitantes').expect(401);
        await request(app).get('/api/v1/metricas/visitantes').set('Authorization', cliente.auth).expect(403);
        await metricas('?de=2026-13-01').expect(400);
        const padrao = await metricas().expect(200);
        assert.equal(padrao.body.por_dia.length, 30);
    });
});
