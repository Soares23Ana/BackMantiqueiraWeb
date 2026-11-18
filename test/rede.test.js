const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { config, prepararApp, criarUsuario } = require('./ajuda');
const { avaliarRede, AVISO_PROXY, AVISO_SITE_URL } = require('../lib/rede');

describe('avaliarRede (função pura)', () => {
    const dev = { producao: false, trustProxy: null, siteUrl: null };

    test('sem proxy configurado e sem cabeçalho: nenhum aviso', () => {
        assert.deepEqual(avaliarRede(dev, false), {
            trust_proxy: false, recebeu_x_forwarded_for: false, site_url_definida: false, avisos: []
        });
    });

    test('com X-Forwarded-For e sem TRUST_PROXY: avisa', () => {
        const rede = avaliarRede(dev, true);
        assert.equal(rede.recebeu_x_forwarded_for, true);
        assert.deepEqual(rede.avisos, [AVISO_PROXY]);
    });

    test('com TRUST_PROXY definido não avisa, e devolve o número', () => {
        const rede = avaliarRede({ ...dev, trustProxy: 1 }, true);
        assert.equal(rede.trust_proxy, 1);
        assert.deepEqual(rede.avisos, []);
    });

    test('produção sem SITE_URL avisa; com SITE_URL ou fora de produção não', () => {
        assert.deepEqual(avaliarRede({ ...dev, producao: true }, false).avisos, [AVISO_SITE_URL]);
        const comSite = avaliarRede({ ...dev, producao: true, siteUrl: 'https://www.site.com.br' }, false);
        assert.deepEqual(comSite.avisos, []);
        assert.equal(comSite.site_url_definida, true);
        assert.deepEqual(avaliarRede(dev, false).avisos, []);
    });

    test('os dois avisos podem aparecer juntos e nunca expõem o valor de SITE_URL', () => {
        const rede = avaliarRede({ producao: true, trustProxy: null, siteUrl: null }, true);
        assert.equal(rede.avisos.length, 2);
        const ligada = avaliarRede({ producao: true, trustProxy: 2, siteUrl: 'https://segredo.exemplo.com' }, false);
        assert.ok(!JSON.stringify(ligada).includes('segredo.exemplo.com'));
    });
});

describe('/saude/detalhado: bloco rede', () => {
    let app;
    let sequelize;
    let equipe;
    const original = {};

    before(async () => {
        ({ app, sequelize } = await prepararApp());
        equipe = await criarUsuario('equipe');
        for (const chave of ['trustProxy', 'producao', 'siteUrl']) original[chave] = config[chave];
    });
    after(async () => {
        Object.assign(config, original);
        await sequelize.close();
    });

    const detalhado = (cabecalhos = {}) => {
        let req = request(app).get('/saude/detalhado').set('Authorization', equipe.auth);
        for (const [nome, valor] of Object.entries(cabecalhos)) req = req.set(nome, valor);
        return req;
    };

    test('sem cabeçalho e sem produção: bloco sem avisos e campos existentes intactos', async () => {
        Object.assign(config, { trustProxy: null, producao: false, siteUrl: null });
        const { body } = await detalhado().expect(200);
        assert.deepEqual(body.rede, { trust_proxy: false, recebeu_x_forwarded_for: false, site_url_definida: false, avisos: [] });
        for (const campo of ['status', 'versao', 'banco', 'processo', 'jobs', 'uploads', 'sincronizacoes']) {
            assert.ok(campo in body, `campo ${campo} deve continuar existindo`);
        }
    });

    test('com X-Forwarded-For e sem TRUST_PROXY: aviso, mas o status segue ok', async () => {
        Object.assign(config, { trustProxy: null, producao: false, siteUrl: null });
        const { body } = await detalhado({ 'X-Forwarded-For': '203.0.113.7' }).expect(200);
        assert.equal(body.rede.recebeu_x_forwarded_for, true);
        assert.deepEqual(body.rede.avisos, [AVISO_PROXY]);
        assert.equal(body.status, 'ok');
    });

    test('com TRUST_PROXY=1 e o cabeçalho: sem aviso e trust_proxy 1', async () => {
        Object.assign(config, { trustProxy: 1, producao: false, siteUrl: null });
        const { body } = await detalhado({ 'X-Forwarded-For': '203.0.113.7' }).expect(200);
        assert.equal(body.rede.trust_proxy, 1);
        assert.deepEqual(body.rede.avisos, []);
    });

    test('produção simulada: sem SITE_URL avisa; com SITE_URL não; status não muda', async () => {
        Object.assign(config, { trustProxy: 1, producao: true, siteUrl: null });
        const sem = (await detalhado().expect(200)).body;
        assert.deepEqual(sem.rede.avisos, [AVISO_SITE_URL]);
        assert.equal(sem.rede.site_url_definida, false);
        assert.equal(sem.status, 'ok');

        config.siteUrl = 'https://www.site.com.br';
        const com = (await detalhado().expect(200)).body;
        assert.deepEqual(com.rede.avisos, []);
        assert.equal(com.rede.site_url_definida, true);
        assert.equal(com.status, 'ok');
        assert.ok(!JSON.stringify(com).includes('www.site.com.br'));
    });
});

describe('BancoMantiqueira.sql', () => {
    test('a última migration listada é a do último arquivo em migrations/', () => {
        const raiz = path.join(__dirname, '..');
        const arquivos = fs.readdirSync(path.join(raiz, 'migrations'))
            .filter((nome) => /^\d{3}_.+\.(sql|js)$/.test(nome)).sort();
        const [, versao, nome] = arquivos[arquivos.length - 1].match(/^(\d{3})_(.+)\.(?:sql|js)$/);
        const sql = fs.readFileSync(path.join(raiz, 'BancoMantiqueira.sql'), 'utf8');
        const versoes = [...sql.matchAll(/^\('(\d{3})', '([^']+)', '[0-9a-f]+'\)[,;]/gm)];
        assert.ok(versoes.length > 0, 'o INSERT de schema_migrations não foi encontrado');
        const ultima = versoes[versoes.length - 1];
        assert.deepEqual([ultima[1], ultima[2]], [versao, nome],
            'BancoMantiqueira.sql desatualizado: rode "npm run schema:gerar"');
    });
});
