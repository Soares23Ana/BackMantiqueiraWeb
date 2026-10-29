const { test, before, after, beforeEach, describe, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp } = require('./ajuda');

let app;
let sequelize;

// Simula o fetch: cada host responde com a função dada; os demais falham como se estivessem fora do ar.
const chamadas = [];
function simularServicos(respostasPorHost) {
    chamadas.length = 0;
    mock.method(globalThis, 'fetch', async (url, opcoes) => {
        const host = new URL(url).host;
        chamadas.push({ host, url, opcoes });
        const responder = respostasPorHost[host];
        if (!responder) throw new TypeError('fetch failed');
        return responder(url);
    });
}
const json = (status, corpo) => () => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const tempoEsgotado = () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
const consultar = (cep) => request(app).get(`/api/v1/cep/${cep}`);

before(async () => {
    ({ app, sequelize } = await prepararApp());
});

after(async () => {
    await sequelize.close();
});

beforeEach(() => {
    require('../servicos/cep').limparCacheCep();
    mock.restoreAll();
});

describe('GET /cep/:cep', () => {
    test('usa a BrasilAPI e devolve só cep, logradouro, bairro, cidade e estado', async () => {
        simularServicos({
            'brasilapi.com.br': json(200, { cep: '13870000', state: 'SP', city: 'São João da Boa Vista', neighborhood: 'Centro', street: 'Rua das Flores', service: 'correios' })
        });
        const { body } = await consultar('13870-000').expect(200);
        assert.deepEqual(body, { cep: '13870-000', logradouro: 'Rua das Flores', bairro: 'Centro', cidade: 'São João da Boa Vista', estado: 'SP' });
        assert.deepEqual(chamadas.map((c) => c.url), ['https://brasilapi.com.br/api/cep/v1/13870000']);
        // Toda chamada externa tem tempo máximo (AbortSignal).
        assert.ok(chamadas[0].opcoes.signal instanceof AbortSignal);
    });

    test('se a BrasilAPI falhar (erro, tempo esgotado ou 5xx), usa o ViaCEP; cidade com CEP único fica sem rua e bairro', async () => {
        for (const falha of [() => { throw new TypeError('fetch failed'); }, tempoEsgotado, json(502, { message: 'Bad gateway' })]) {
            require('../servicos/cep').limparCacheCep();
            simularServicos({
                'brasilapi.com.br': falha,
                'viacep.com.br': json(200, { cep: '13990-000', logradouro: '', bairro: '', localidade: 'Espírito Santo do Pinhal', uf: 'SP' })
            });
            const { body } = await consultar('13990000').expect(200);
            assert.deepEqual(body, { cep: '13990-000', logradouro: '', bairro: '', cidade: 'Espírito Santo do Pinhal', estado: 'SP' });
            assert.deepEqual(chamadas.map((c) => c.url), ['https://brasilapi.com.br/api/cep/v1/13990000', 'https://viacep.com.br/ws/13990000/json/']);
        }
    });

    test('não encontrado: 404 CEP_NAO_ENCONTRADO, guardado em cache por alguns minutos', async () => {
        simularServicos({
            'brasilapi.com.br': json(404, { name: 'CepPromiseError', type: 'service_error' }),
            'viacep.com.br': json(200, { erro: 'true' })
        });
        const resposta = await consultar('99999999').expect(404);
        assert.equal(resposta.body.codigo, 'CEP_NAO_ENCONTRADO');
        assert.equal(chamadas.length, 2);
        await consultar('99999-999').expect(404);
        assert.equal(chamadas.length, 2);
    });

    test('a BrasilAPI dizer 404 não basta se o ViaCEP encontrar', async () => {
        simularServicos({
            'brasilapi.com.br': json(404, { name: 'CepPromiseError' }),
            'viacep.com.br': json(200, { cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' })
        });
        assert.equal((await consultar('01001000').expect(200)).body.logradouro, 'Praça da Sé');
    });

    test('os dois fora do ar: 503 SERVICO_INDISPONIVEL, sem guardar em cache', async () => {
        simularServicos({ 'brasilapi.com.br': tempoEsgotado, 'viacep.com.br': json(500, {}) });
        const resposta = await consultar('13870000').expect(503);
        assert.equal(resposta.body.codigo, 'SERVICO_INDISPONIVEL');
        simularServicos({ 'brasilapi.com.br': json(200, { cep: '13870000', state: 'SP', city: 'São João da Boa Vista', neighborhood: '', street: '' }) });
        await consultar('13870000').expect(200);
        assert.equal(chamadas.length, 1);
    });

    test('CEP encontrado fica em cache: a segunda consulta não chama o serviço', async () => {
        simularServicos({ 'brasilapi.com.br': json(200, { cep: '13870000', state: 'SP', city: 'São João da Boa Vista', neighborhood: 'Centro', street: 'Rua A' }) });
        await consultar('13870000').expect(200);
        await consultar('13870-000').expect(200);
        assert.equal(chamadas.length, 1);
    });

    test('cada serviço tem no máximo 4 segundos', async () => {
        const tempos = [];
        const original = AbortSignal.timeout.bind(AbortSignal);
        mock.method(AbortSignal, 'timeout', (ms) => { tempos.push(ms); return original(ms); });
        simularServicos({ 'viacep.com.br': json(200, { cep: '01001-000', logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' }) });
        await consultar('01001000').expect(200);
        assert.deepEqual(tempos, [4000, 4000]);
    });

    test('CEP em formato inválido: 422, sem chamar nenhum serviço', async () => {
        simularServicos({});
        for (const cep of ['1387000', '138700000', '13870-00a', '1387-0000']) {
            const resposta = await consultar(cep).expect(422);
            assert.equal(resposta.body.codigo, 'VALIDACAO');
        }
        assert.equal(chamadas.length, 0);
    });

    test('funciona com o banco fora do ar (não usa o banco)', async () => {
        const { estado } = require('../db/conexao');
        simularServicos({ 'brasilapi.com.br': json(200, { cep: '13870000', state: 'SP', city: 'São João da Boa Vista', neighborhood: 'Centro', street: 'Rua A' }) });
        estado.conectado = false;
        try {
            await consultar('13870000').expect(200);
        } finally {
            estado.conectado = true;
        }
    });

    test('o cadastro não depende da consulta: endereço digitado à mão é aceito com os serviços fora do ar', async () => {
        simularServicos({});
        await request(app).post('/api/v1/auth/register').send({
            cnpj: '11.222.333/0001-81', nome: 'Maria Responsável', email: 'cep@cliente.com', telefone: '(19) 99999-0000', senha: 'Senha@Forte1',
            endereco: { cep: '13870-000', logradouro: 'Rua digitada', numero: '1', bairro: 'Centro', cidade: 'São João da Boa Vista', estado: 'SP' }
        }).expect(201);
        assert.equal(chamadas.length, 0);
    });

    test('limite de 30 consultas por minuto por IP', async () => {
        simularServicos({ 'brasilapi.com.br': json(200, { cep: '13870000', state: 'SP', city: 'São João da Boa Vista', neighborhood: 'Centro', street: 'Rua A' }) });
        const primeira = await consultar('13870000');
        assert.match(primeira.headers['ratelimit-policy'], /q=30/);
        let status;
        for (let i = 0; i < 31 && status !== 429; i += 1) ({ status } = await consultar('13870000'));
        assert.equal(status, 429);
    });
});
