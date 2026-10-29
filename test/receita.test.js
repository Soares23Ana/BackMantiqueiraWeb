const { test, before, after, beforeEach, describe, mock } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, config } = require('./ajuda');

let app;
let sequelize;

// Simula o fetch: cada host responde com a função dada; os demais falham como se estivessem fora do ar.
const chamadas = [];
function simularServicos(respostasPorHost) {
    chamadas.length = 0;
    mock.method(globalThis, 'fetch', async (url) => {
        const host = new URL(url).host;
        chamadas.push(url);
        const responder = respostasPorHost[host];
        if (!responder) throw new TypeError('fetch failed');
        return responder(url);
    });
}
const json = (status, corpo) => () => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
const empresa = (extra = {}) => json(200, {
    cnpj: '11222333000181', razao_social: 'MERCADINHO DA ESQUINA LTDA', nome_fantasia: 'MERCADINHO DA ESQUINA',
    descricao_situacao_cadastral: 'ATIVA', municipio: 'SAO JOAO DA BOA VISTA', uf: 'SP', ...extra
});
const naoEncontrado = json(404, { message: 'CNPJ não encontrado.' });

const cadastro = (cnpj, email) => request(app).post('/api/v1/auth/register').send({
    cnpj, nome: 'Maria Responsável', email, telefone: '(19) 99999-0000', senha: 'Senha@Forte1',
    endereco: { cep: '13870-000', logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'São João da Boa Vista', estado: 'SP' }
});
const usuarioPorEmail = async (email) => (await sequelize.query('SELECT cnpj, razao_social FROM usuarios WHERE email = ?', { replacements: [email] }))[0][0];

before(async () => {
    ({ app, sequelize } = await prepararApp());
});

after(async () => {
    await sequelize.close();
});

beforeEach(() => {
    require('../servicos/receita').limparCacheReceita();
    mock.restoreAll();
});

describe('GET /cnpj/:cnpj', () => {
    test('BrasilAPI: devolve cnpj formatado, razão social, nome fantasia, situação, cidade e estado', async () => {
        simularServicos({ 'brasilapi.com.br': empresa() });
        const { body } = await request(app).get('/api/v1/cnpj/11222333000181').expect(200);
        assert.deepEqual(body, {
            cnpj: '11.222.333/0001-81', razao_social: 'MERCADINHO DA ESQUINA LTDA', nome_fantasia: 'MERCADINHO DA ESQUINA',
            situacao: 'ATIVA', cidade: 'SAO JOAO DA BOA VISTA', estado: 'SP'
        });
        assert.deepEqual(chamadas, ['https://brasilapi.com.br/api/cnpj/v1/11222333000181']);
    });

    test('com pontuação (barra codificada) e alfanumérico em minúsculas, consulta o CNPJ normalizado', async () => {
        simularServicos({ 'brasilapi.com.br': empresa({ cnpj: '12ABC34501DE35' }) });
        await request(app).get(`/api/v1/cnpj/${encodeURIComponent('12.abc.345/01de-35')}`).expect(200);
        assert.deepEqual(chamadas, ['https://brasilapi.com.br/api/cnpj/v1/12ABC34501DE35']);
    });

    test('se a BrasilAPI falhar ou recusar o formato (400), usa a Minha Receita', async () => {
        for (const falha of [() => { throw new TypeError('fetch failed'); }, json(500, {}), json(400, { name: 'BadRequestError' })]) {
            require('../servicos/receita').limparCacheReceita();
            simularServicos({ 'brasilapi.com.br': falha, 'minhareceita.org': empresa({ nome_fantasia: '' }) });
            const { body } = await request(app).get('/api/v1/cnpj/11222333000181').expect(200);
            assert.equal(body.razao_social, 'MERCADINHO DA ESQUINA LTDA');
            assert.equal(body.nome_fantasia, '');
            assert.deepEqual(chamadas, ['https://brasilapi.com.br/api/cnpj/v1/11222333000181', 'https://minhareceita.org/11222333000181']);
        }
    });

    test('não encontrado: 404 CNPJ_NAO_ENCONTRADO; fora do ar: 503 SERVICO_INDISPONIVEL; inválido: 422 sem consultar', async () => {
        simularServicos({ 'brasilapi.com.br': naoEncontrado, 'minhareceita.org': naoEncontrado });
        const nao = await request(app).get('/api/v1/cnpj/11444777000161').expect(404);
        assert.equal(nao.body.codigo, 'CNPJ_NAO_ENCONTRADO');

        simularServicos({});
        const fora = await request(app).get('/api/v1/cnpj/45723174000110').expect(503);
        assert.equal(fora.body.codigo, 'SERVICO_INDISPONIVEL');

        simularServicos({});
        const invalido = await request(app).get('/api/v1/cnpj/11222333000182').expect(422);
        assert.equal(invalido.body.codigo, 'VALIDACAO');
        assert.equal(chamadas.length, 0);
    });

    test('cache de 24 h: a segunda consulta não chama o serviço', async () => {
        simularServicos({ 'brasilapi.com.br': empresa() });
        await request(app).get('/api/v1/cnpj/11222333000181').expect(200);
        await request(app).get(`/api/v1/cnpj/${encodeURIComponent('11.222.333/0001-81')}`).expect(200);
        assert.equal(chamadas.length, 1);
    });

    test('cada serviço tem no máximo 5 segundos', async () => {
        const tempos = [];
        const original = AbortSignal.timeout.bind(AbortSignal);
        mock.method(AbortSignal, 'timeout', (ms) => { tempos.push(ms); return original(ms); });
        simularServicos({ 'minhareceita.org': empresa() });
        await request(app).get('/api/v1/cnpj/11222333000181').expect(200);
        assert.deepEqual(tempos, [5000, 5000]);
    });
});

describe('cadastro com VALIDAR_CNPJ_RECEITA', () => {
    const { validarAmbiente } = require('../config/ambiente');
    const base = { JWT_SECRET: 'x'.repeat(40), DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' };
    const ligar = (t) => {
        config.validarCnpjReceita = true;
        t.after(() => { config.validarCnpjReceita = false; });
    };

    test('padrão: ligado em produção, desligado em desenvolvimento e testes', () => {
        assert.equal(validarAmbiente({ ...base, NODE_ENV: 'production' }).config.validarCnpjReceita, true);
        assert.equal(validarAmbiente(base).config.validarCnpjReceita, false);
        assert.equal(validarAmbiente({ ...base, NODE_ENV: 'test' }).config.validarCnpjReceita, false);
        assert.equal(validarAmbiente({ ...base, NODE_ENV: 'production', VALIDAR_CNPJ_RECEITA: 'false' }).config.validarCnpjReceita, false);
        assert.deepEqual(validarAmbiente({ ...base, VALIDAR_CNPJ_RECEITA: 'sim' }).erros, ['VALIDAR_CNPJ_RECEITA deve ser true ou false.']);
    });

    test('desligado: não consulta a Receita', async () => {
        simularServicos({});
        await cadastro('11.222.333/0001-81', 'sem-receita@cliente.com').expect(201);
        assert.equal(chamadas.length, 0);
        assert.equal((await usuarioPorEmail('sem-receita@cliente.com')).razao_social, null);
    });

    test('CNPJ ativo: cadastra e grava a razão social da Receita', async (t) => {
        ligar(t);
        simularServicos({ 'brasilapi.com.br': empresa({ cnpj: '11444777000161', razao_social: 'EMPRESA ATIVA LTDA' }) });
        await cadastro('11.444.777/0001-61', 'ativa@cliente.com').expect(201);
        assert.deepEqual(await usuarioPorEmail('ativa@cliente.com'), { cnpj: '11444777000161', razao_social: 'EMPRESA ATIVA LTDA' });
    });

    test('CNPJ não encontrado, inativo ou serviço fora do ar: não cadastra', async (t) => {
        ligar(t);
        simularServicos({ 'brasilapi.com.br': naoEncontrado, 'minhareceita.org': naoEncontrado });
        const nao = await cadastro('45.723.174/0001-10', 'nao@cliente.com').expect(422);
        assert.deepEqual([nao.body.codigo, nao.body.mensagem, nao.body.detalhes[0].campo],
            ['CNPJ_NAO_ENCONTRADO', 'CNPJ não encontrado na Receita Federal.', 'cnpj']);

        require('../servicos/receita').limparCacheReceita();
        simularServicos({ 'brasilapi.com.br': empresa({ descricao_situacao_cadastral: 'BAIXADA' }) });
        const baixada = await cadastro('45.723.174/0001-10', 'baixada@cliente.com').expect(422);
        assert.equal(baixada.body.codigo, 'CNPJ_INATIVO');
        assert.match(baixada.body.mensagem, /"BAIXADA"/);

        require('../servicos/receita').limparCacheReceita();
        simularServicos({});
        const fora = await cadastro('45.723.174/0001-10', 'fora@cliente.com').expect(503);
        assert.deepEqual([fora.body.codigo, fora.body.mensagem],
            ['SERVICO_INDISPONIVEL', 'Não foi possível validar o CNPJ agora. Tente novamente em instantes.']);

        for (const email of ['nao@cliente.com', 'baixada@cliente.com', 'fora@cliente.com']) {
            assert.equal(await usuarioPorEmail(email), undefined);
        }
    });

    test('a razão social enviada pelo cliente continua recusada (só a da Receita é gravada)', async (t) => {
        ligar(t);
        simularServicos({ 'brasilapi.com.br': empresa() });
        const resposta = await request(app).post('/api/v1/auth/register').send({ cnpj: '33000167000101', razao_social: 'Outra' }).expect(422);
        assert.ok(resposta.body.detalhes.some((d) => d.campo === 'razao_social'));
        assert.equal(chamadas.length, 0);
    });
});

describe('limite de GET /cnpj/:cnpj', () => {
    test('20 consultas por minuto por IP', async () => {
        simularServicos({ 'brasilapi.com.br': empresa() });
        const primeira = await request(app).get('/api/v1/cnpj/11222333000181');
        assert.match(primeira.headers['ratelimit-policy'], /q=20/);
        let status;
        for (let i = 0; i < 21 && status !== 429; i += 1) ({ status } = await request(app).get('/api/v1/cnpj/11222333000181'));
        assert.equal(status, 429);
    });
});
