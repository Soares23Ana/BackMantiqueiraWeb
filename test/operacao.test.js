const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

const CSV = fs.readFileSync(path.join(__dirname, '..', 'seeds', 'catalogo_inicial.csv'));
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);
const PASTA_UPLOADS = path.join(__dirname, '..', 'publico', 'uploads');

let app;
let sequelize;
let Produto;
let equipe;
let cliente;

const importar = (conteudo, nome = 'catalogo.csv', query = '') =>
    request(app).post(`/api/v1/produtos/importar${query}`).set('Authorization', equipe.auth)
        .attach('arquivo', Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo), nome);
const estoqueDe = async (sku) => (await Produto.findOne({ where: { sku } })).quantidade_estoque;
const arquivoDoUpload = (url) => path.join(PASTA_UPLOADS, url.replace('/arquivos/uploads/', ''));

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto } = require('../models'));
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
});

after(async () => {
    await sequelize.close();
});

describe('importação por upload (POST /produtos/importar)', () => {
    test('exige equipe e um arquivo .csv', async () => {
        await request(app).post('/api/v1/produtos/importar').attach('arquivo', CSV, 'catalogo.csv').expect(401);
        await request(app).post('/api/v1/produtos/importar').set('Authorization', cliente.auth)
            .attach('arquivo', CSV, 'catalogo.csv').expect(403);
        await request(app).post('/api/v1/produtos/importar').set('Authorization', equipe.auth).expect(422);
        const txt = await importar('sku;nome', 'catalogo.txt').expect(422);
        assert.match(txt.body.mensagem, /\.csv/);
    });

    test('simulação devolve o relatório, registra o log e não grava', async () => {
        const resposta = await importar(CSV, 'catalogo.csv', '?simular=true').expect(200);
        assert.equal(resposta.body.relatorio.criados, 38);
        assert.equal(resposta.body.relatorio.simulado, true);
        const [[{ total }]] = await sequelize.query('SELECT COUNT(*) AS total FROM produtos');
        assert.equal(total, 0);
        const log = await request(app).get(`/api/v1/produtos/importacoes/${resposta.body.id_sincronizacao}`)
            .set('Authorization', equipe.auth).expect(200);
        assert.equal(log.body.importacao.simulado, true);
        assert.equal(log.body.importacao.status, 'sucesso');
    });

    test('importa de verdade e aparece no histórico e no /saude/detalhado', async () => {
        const resposta = await importar(CSV).expect(200);
        assert.equal(resposta.body.relatorio.criados, 38);
        assert.equal(resposta.body.status, 'sucesso');

        const lista = await request(app).get('/api/v1/produtos/importacoes?tipo=importacao_manual').set('Authorization', equipe.auth).expect(200);
        assert.equal(lista.body.paginacao.total, 2);
        assert.equal(lista.body.importacoes[0].usuario.id_usuario, equipe.usuario.id_usuario);
        assert.equal(lista.body.importacoes[0].relatorio, undefined);

        const saude = await request(app).get('/saude/detalhado').set('Authorization', equipe.auth).expect(200);
        assert.ok(saude.body.sincronizacoes.ultima);
    });

    test('linhas com erro: status parcial e erros linha a linha no log', async () => {
        const resposta = await importar('sku;nome;estoque\nNOVO-A;Produto A;10\nNOVO-B;;-1\n').expect(200);
        assert.equal(resposta.body.status, 'parcial');
        assert.equal(resposta.body.relatorio.criados, 1);
        const log = await request(app).get(`/api/v1/produtos/importacoes/${resposta.body.id_sincronizacao}`)
            .set('Authorization', equipe.auth);
        assert.deepEqual(log.body.importacao.relatorio.erros.map((e) => [e.linha, e.campo]).sort(), [[3, 'estoque'], [3, 'nome']]);
    });

    test('arquivo salvo pelo Excel em Windows-1252 é lido corretamente', async () => {
        await importar(Buffer.from('sku;nome\nLATIN-1;Loção Ação Bebê\n', 'latin1')).expect(200);
        assert.equal((await Produto.findOne({ where: { sku: 'LATIN-1' } })).nome, 'Loção Ação Bebê');
    });

    test('CSV sem coluna sku vira falha no log', async () => {
        const resposta = await importar('nome;estoque\nX;1').expect(422);
        assert.equal(resposta.body.codigo, 'CSV_INVALIDO');
        const [[ultimo]] = await sequelize.query('SELECT status, mensagem FROM sincronizacoes_log ORDER BY id_sincronizacao DESC LIMIT 1');
        assert.equal(ultimo.status, 'falha');
        assert.match(ultimo.mensagem, /sku/);
    });

    test('carga completa com erro no arquivo não desativa ninguém', async () => {
        const resposta = await importar('sku;nome\nSKU-101;Loção\n;sem sku\n', 'catalogo.csv', '?carga_completa=true&simular=true').expect(200);
        assert.equal(resposta.body.relatorio.desativados, 0);
        assert.match(resposta.body.relatorio.avisos.join(' '), /Nenhum produto foi desativado/);
    });
});

describe('trava do MySQL', () => {
    test('com a trava ocupada por outra conexão, a execução é pulada', async () => {
        const { executarComTrava } = require('../lib/travaMysql');
        const { processarPastaComTrava, TRAVA_IMPORTACAO } = require('../servicos/sincronizacao');
        const outra = await sequelize.connectionManager.getConnection({ type: 'write' });
        try {
            await outra.promise().query('SELECT GET_LOCK(?, 0)', [TRAVA_IMPORTACAO]);
            const resultado = await executarComTrava(TRAVA_IMPORTACAO, async () => 'rodou');
            assert.deepEqual(resultado, { executado: false });
            assert.deepEqual(await processarPastaComTrava('estoque', os.tmpdir()), { ignorado: 'outra importação em andamento' });
        } finally {
            await outra.promise().query('SELECT RELEASE_LOCK(?)', [TRAVA_IMPORTACAO]);
            sequelize.connectionManager.releaseConnection(outra);
        }
        assert.deepEqual(await executarComTrava(TRAVA_IMPORTACAO, async () => 'rodou'), { executado: true, resultado: 'rodou' });
    });
});

describe('importação por pasta (jobs)', () => {
    let base;
    const entrada = () => path.join(base, 'entrada');
    // Arquivos com data de 2 minutos atrás: os recém-modificados são ignorados pelos jobs.
    const envelhecer = (caminho) => {
        const passado = new Date(Date.now() - 2 * 60 * 1000);
        fs.utimesSync(caminho, passado, passado);
    };
    const escrever = (nome, conteudo) => {
        fs.writeFileSync(path.join(entrada(), nome), conteudo);
        envelhecer(path.join(entrada(), nome));
    };
    const arquivosEm = (pasta) => (fs.existsSync(path.join(base, pasta)) ? fs.readdirSync(path.join(base, pasta)) : []);

    before(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'mantiqueira-importacao-'));
        fs.mkdirSync(entrada(), { recursive: true });
    });
    after(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });

    test('job de estoque aplica só sku e estoque e move para processados com relatório', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        const nomeAntes = (await Produto.findOne({ where: { sku: 'SKU-102' } })).nome;
        escrever('estoque_0800.csv', 'sku;estoque;nome\nSKU-102;77;Nome que deve ser ignorado\n');
        escrever('outro.csv', 'sku;estoque\nSKU-102;1\n');

        const [resultado, ...resto] = await processarPasta('estoque', base);
        assert.equal(resto.length, 0);
        assert.equal(resultado.status, 'sucesso');
        assert.equal(await estoqueDe('SKU-102'), 77);
        assert.equal((await Produto.findOne({ where: { sku: 'SKU-102' } })).nome, nomeAntes);

        const processados = arquivosEm('processados');
        assert.equal(processados.length, 2);
        const relatorio = JSON.parse(fs.readFileSync(path.join(base, 'processados', processados.find((n) => n.endsWith('.json'))), 'utf8'));
        assert.match(relatorio.avisos.join(' '), /nome/);
        // Arquivo fora do padrão de nome continua na entrada.
        assert.deepEqual(fs.readdirSync(entrada()), ['outro.csv']);

        const [[log]] = await sequelize.query('SELECT tipo, origem FROM sincronizacoes_log WHERE id_sincronizacao = ?',
            { replacements: [resultado.id_sincronizacao] });
        assert.deepEqual(log, { tipo: 'estoque', origem: 'arquivo: estoque_0800.csv' });
    });

    test('ignora arquivos modificados nos últimos 60 segundos e os processa depois', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        const caminho = path.join(entrada(), 'estoque_0815.csv');
        fs.writeFileSync(caminho, 'sku;estoque\nSKU-102;55\n');
        // .tmp (cópia ainda em andamento) nunca é lido.
        fs.writeFileSync(path.join(entrada(), 'estoque_0816.tmp'), 'sku;estoque\nSKU-102;1\n');
        envelhecer(path.join(entrada(), 'estoque_0816.tmp'));

        const [recente, ...resto] = await processarPasta('estoque', base);
        assert.equal(resto.length, 0);
        assert.deepEqual(recente, { arquivo: 'estoque_0815.csv', status: 'ignorado', motivo: 'modificado há menos de 60 segundos' });
        assert.equal(await estoqueDe('SKU-102'), 77);
        assert.ok(fs.existsSync(caminho));

        envelhecer(caminho);
        const [depois] = await processarPasta('estoque', base);
        assert.equal(depois.status, 'sucesso');
        assert.equal(await estoqueDe('SKU-102'), 55);
        assert.deepEqual(fs.readdirSync(entrada()).sort(), ['estoque_0816.tmp', 'outro.csv']);
        fs.rmSync(path.join(entrada(), 'estoque_0816.tmp'));
        await Produto.update({ quantidade_estoque: 77 }, { where: { sku: 'SKU-102' } });
    });

    test('arquivos ilegíveis ou com todas as linhas erradas vão para rejeitados', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        escrever('estoque_0830.csv', 'sku;nome\nSKU-102;sem coluna estoque\n');
        escrever('estoque_0900.csv', 'sku;estoque\nSKU-102;-5\nSKU-103;abc\n');
        const resultados = await processarPasta('estoque', base);
        assert.deepEqual(resultados.map((r) => [r.arquivo, r.destino]), [
            ['estoque_0830.csv', 'rejeitados'],
            ['estoque_0900.csv', 'rejeitados']
        ]);
        assert.equal(arquivosEm('rejeitados').filter((n) => n.endsWith('.csv')).length, 2);
        assert.equal(await estoqueDe('SKU-102'), 77);
    });

    test('carga completa da meia-noite desativa produtos ausentes do arquivo', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        escrever('catalogo_completo.csv', CSV);
        const [resultado] = await processarPasta('carga_completa', base);
        assert.equal(resultado.status, 'sucesso');
        // NOVO-A e LATIN-1 vieram de outros testes e não estão no catálogo.
        const inativos = await Produto.findAll({ where: { ativo: false }, attributes: ['sku'], order: [['sku', 'ASC']] });
        assert.deepEqual(inativos.map((p) => p.sku), ['LATIN-1', 'NOVO-A']);
    });

    test('arquivos de importacao/exemplos/ funcionam como esperado na demo', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        const { importarCatalogo } = require('../servicos/importadorCatalogo');
        const exemplos = path.join(__dirname, '..', 'importacao', 'exemplos');

        const catalogo = await importarCatalogo(fs.readFileSync(path.join(exemplos, 'catalogo_exemplo.csv'), 'utf8'),
            { simular: true, desativarAusentes: true });
        assert.equal(catalogo.com_erro, 0);
        assert.equal(catalogo.criados, 1);

        fs.copyFileSync(path.join(exemplos, 'estoque_exemplo.csv'), path.join(entrada(), 'estoque_exemplo.csv'));
        envelhecer(path.join(entrada(), 'estoque_exemplo.csv'));
        const [resultado] = await processarPasta('estoque', base);
        assert.equal(resultado.status, 'parcial');
        assert.equal(await estoqueDe('SKU-109'), 20);
        const [[log]] = await sequelize.query('SELECT relatorio FROM sincronizacoes_log WHERE id_sincronizacao = ?',
            { replacements: [resultado.id_sincronizacao] });
        assert.deepEqual(log.relatorio.erros.map((e) => [e.sku, e.mensagem]),
            [['SKU-999', 'SKU não cadastrado. O arquivo de estoque não cria produtos.']]);

        // Volta o estoque do catálogo original; o teste do painel depende dele.
        for (const [sku, quantidade] of [['SKU-103', 8], ['SKU-107', 6], ['SKU-109', 4], ['SKU-115', 25]]) {
            await Produto.update({ quantidade_estoque: quantidade }, { where: { sku } });
        }
    });

    test('jobs têm expressões válidas e ficam desligados nos testes', () => {
        const cron = require('node-cron');
        const { DEFINICOES, situacaoJobs } = require('../jobs');
        assert.deepEqual(DEFINICOES.map((d) => [d.nome, d.expressao]), [['carga-completa', '0 0 * * *'], ['estoque', '*/30 * * * *'], ['limpeza-eventos', '0 3 * * *']]);
        assert.ok(DEFINICOES.every((d) => cron.validate(d.expressao)));
        assert.ok(situacaoJobs().every((job) => job.ativo === false && job.fuso === 'America/Sao_Paulo'));
    });
});

describe('CMS: banners', () => {
    const criar = (campos = {}) => {
        const req = request(app).post('/api/v1/cms').set('Authorization', equipe.auth);
        for (const [campo, valor] of Object.entries({ titulo: 'Banner', ...campos })) req.field(campo, String(valor));
        return req.attach('imagem', PNG, { filename: 'b.png', contentType: 'image/png' });
    };
    const publicos = async () => (await request(app).get('/api/v1/cms').expect(200)).body.banners.map((b) => b.titulo);
    const ids = {};

    test('cria banners e respeita a janela de exibição', async () => {
        ids.a = (await criar({ titulo: 'A' }).expect(201)).body.banner.id_banner;
        const futuro = await criar({ titulo: 'Futuro', inicio_em: '2099-01-01T08:00' }).expect(201);
        assert.equal(futuro.body.banner.situacao, 'agendado');
        ids.futuro = futuro.body.banner.id_banner;
        const passado = await criar({ titulo: 'Passado', fim_em: '2020-01-01' }).expect(201);
        assert.equal(passado.body.banner.situacao, 'expirado');
        ids.b = (await criar({ titulo: 'B' }).expect(201)).body.banner.id_banner;
        assert.deepEqual(await publicos(), ['A', 'B']);

        const invalido = await criar({ inicio_em: '2026-12-10', fim_em: '2026-12-01' }).expect(422);
        assert.equal(invalido.body.detalhes[0].campo, 'fim_em');
        await request(app).post('/api/v1/cms').set('Authorization', cliente.auth).field('titulo', 'X').expect(403);
    });

    test('equipe vê todos com a situação; reordena com a lista completa', async () => {
        const todos = await request(app).get('/api/v1/cms/todos').set('Authorization', equipe.auth).expect(200);
        assert.equal(todos.body.banners.length, 4);
        const ordem = [ids.b, ids.a, ...todos.body.banners.map((b) => b.id_banner).filter((id) => id !== ids.a && id !== ids.b)];
        await request(app).put('/api/v1/cms/ordem').set('Authorization', equipe.auth).send({ ids: [ids.b, ids.a] }).expect(422);
        await request(app).put('/api/v1/cms/ordem').set('Authorization', equipe.auth).send({ ids: ordem }).expect(200);
        assert.deepEqual(await publicos(), ['B', 'A']);
    });

    test('edita por JSON, desativa e troca a imagem apagando a antiga', async () => {
        await request(app).patch(`/api/v1/cms/${ids.a}`).set('Authorization', equipe.auth).send({ titulo: 'A2', link: '/promocoes' }).expect(200);
        await request(app).patch(`/api/v1/cms/${ids.futuro}`).set('Authorization', equipe.auth).send({ inicio_em: null }).expect(200);
        assert.deepEqual(await publicos(), ['B', 'A2', 'Futuro']);
        await request(app).patch(`/api/v1/cms/${ids.futuro}`).set('Authorization', equipe.auth).send({ ativo: false }).expect(200);
        assert.deepEqual(await publicos(), ['B', 'A2']);
        await request(app).patch(`/api/v1/cms/${ids.a}`).set('Authorization', equipe.auth).send({ link: 'javascript:alert(1)' }).expect(422);

        const antes = (await request(app).get('/api/v1/cms/todos').set('Authorization', equipe.auth)).body.banners.find((b) => b.id_banner === ids.a);
        const trocado = await request(app).patch(`/api/v1/cms/${ids.a}`).set('Authorization', equipe.auth)
            .attach('imagem', PNG, { filename: 'novo.png', contentType: 'image/png' }).expect(200);
        assert.notEqual(trocado.body.banner.imagem_url, antes.imagem_url);
        assert.equal(fs.existsSync(arquivoDoUpload(antes.imagem_url)), false);
        assert.equal(fs.existsSync(arquivoDoUpload(trocado.body.banner.imagem_url)), true);
    });

    test('exclui o banner e a imagem', async () => {
        const todos = (await request(app).get('/api/v1/cms/todos').set('Authorization', equipe.auth)).body.banners;
        for (const banner of todos) {
            await request(app).delete(`/api/v1/cms/${banner.id_banner}`).set('Authorization', equipe.auth).expect(200);
            assert.equal(fs.existsSync(arquivoDoUpload(banner.imagem_url)), false);
        }
        await request(app).delete(`/api/v1/cms/${ids.a}`).set('Authorization', equipe.auth).expect(404);
    });
});

describe('CMS: blocos de conteúdo', () => {
    test('cria, lê, esconde quando inativo e exclui', async () => {
        await request(app).put('/api/v1/cms/blocos/politica-de-entrega').set('Authorization', equipe.auth)
            .send({ titulo: 'Política de entrega', conteudo: 'Entregamos em até 2 dias úteis.' }).expect(200);
        const publico = await request(app).get('/api/v1/cms/blocos/politica-de-entrega').expect(200);
        assert.equal(publico.body.bloco.conteudo, 'Entregamos em até 2 dias úteis.');

        await request(app).put('/api/v1/cms/blocos/politica-de-entrega').set('Authorization', equipe.auth)
            .send({ conteudo: 'Novo texto', ativo: false }).expect(200);
        await request(app).get('/api/v1/cms/blocos/politica-de-entrega').expect(404);
        const daEquipe = await request(app).get('/api/v1/cms/blocos/politica-de-entrega').set('Authorization', equipe.auth).expect(200);
        assert.equal(daEquipe.body.bloco.conteudo, 'Novo texto');
        assert.equal((await request(app).get('/api/v1/cms/blocos').expect(200)).body.blocos.length, 0);

        await request(app).put('/api/v1/cms/blocos/Chave Inválida').set('Authorization', equipe.auth).send({ conteudo: 'x' }).expect(422);
        await request(app).put('/api/v1/cms/blocos/sobre').set('Authorization', equipe.auth).send({}).expect(422);
        await request(app).put('/api/v1/cms/blocos/sobre').set('Authorization', cliente.auth).send({ conteudo: 'x' }).expect(403);
        await request(app).delete('/api/v1/cms/blocos/politica-de-entrega').set('Authorization', equipe.auth).expect(200);
        await request(app).delete('/api/v1/cms/blocos/politica-de-entrega').set('Authorization', equipe.auth).expect(404);
    });
});

describe('configurações', () => {
    test('públicas aparecem sem login; meta_reposicao é privada', async () => {
        const resposta = await request(app).get('/api/v1/configuracoes/publicas').expect(200);
        assert.deepEqual(Object.keys(resposta.body).sort(), ['aviso_topo', 'email_contato', 'horario_atendimento', 'telefone_contato', 'whatsapp']);
        const daEquipe = await request(app).get('/api/v1/configuracoes').set('Authorization', equipe.auth).expect(200);
        assert.equal(daEquipe.body.configuracoes.find((c) => c.chave === 'meta_reposicao').valor, '50');
        await request(app).get('/api/v1/configuracoes').set('Authorization', cliente.auth).expect(403);
    });

    test('valida cada chave, normaliza e limpa com null', async () => {
        const url = (chave) => `/api/v1/configuracoes/${chave}`;
        await request(app).put(url('whatsapp')).set('Authorization', equipe.auth).send({ valor: '123' }).expect(422);
        const ok = await request(app).put(url('whatsapp')).set('Authorization', equipe.auth).send({ valor: '+55 (19) 99999-0000' }).expect(200);
        assert.equal(ok.body.configuracao.valor, '5519999990000');
        await request(app).put(url('aviso_topo')).set('Authorization', equipe.auth).send({ valor: 'Frete grátis acima de 10 caixas' }).expect(200);
        await request(app).put(url('email_contato')).set('Authorization', equipe.auth).send({ valor: 'nao-e-email' }).expect(422);
        await request(app).put(url('inventada')).set('Authorization', equipe.auth).send({ valor: 'x' }).expect(404);
        await request(app).put(url('aviso_topo')).set('Authorization', cliente.auth).send({ valor: 'x' }).expect(403);

        const publicas = await request(app).get('/api/v1/configuracoes/publicas');
        assert.equal(publicas.body.whatsapp, '5519999990000');
        assert.equal(publicas.body.aviso_topo, 'Frete grátis acima de 10 caixas');
        await request(app).put(url('aviso_topo')).set('Authorization', equipe.auth).send({ valor: null }).expect(200);
        assert.equal((await request(app).get('/api/v1/configuracoes/publicas')).body.aviso_topo, null);
    });
});

describe('painel com estoque mínimo e meta configuráveis', () => {
    test('usa o estoque mínimo de cada produto e a meta das configurações', async () => {
        const alertas = async () => (await request(app).get('/api/v1/painel/alertas-reposicao').set('Authorization', equipe.auth).expect(200)).body;
        let resposta = await alertas();
        const skus = resposta.alertas.map((a) => a.produto.sku).sort();
        // Do catálogo, só os com estoque <= 10 (mínimo padrão): 103 (8), 104 (0), 107 (6), 109 (4), 112 (0).
        assert.deepEqual(skus, ['SKU-103', 'SKU-104', 'SKU-107', 'SKU-109', 'SKU-112']);
        assert.equal(resposta.meta_reposicao, 50);
        assert.equal(resposta.alertas.find((a) => a.produto.sku === 'SKU-109').sugestao_compra, 46);

        await Produto.update({ estoque_minimo: 30 }, { where: { sku: 'SKU-115' } });
        await request(app).put('/api/v1/configuracoes/meta_reposicao').set('Authorization', equipe.auth).send({ valor: 100 }).expect(200);
        resposta = await alertas();
        assert.equal(resposta.meta_reposicao, 100);
        const plax = resposta.alertas.find((a) => a.produto.sku === 'SKU-115');
        assert.deepEqual({ estoque: plax.estoque_atual, minimo: plax.estoque_minimo, sugestao: plax.sugestao_compra }, { estoque: 25, minimo: 30, sugestao: 75 });

        const contadores = await request(app).get('/api/v1/painel/contadores').set('Authorization', equipe.auth).expect(200);
        assert.equal(contadores.body.estoque_baixo, 6);
    });
});

describe('/saude/detalhado', () => {
    test('equipe vê banco, migrations, processo, jobs e sincronizações', async () => {
        const resposta = await request(app).get('/saude/detalhado').set('Authorization', equipe.auth).expect(200);
        assert.equal(resposta.body.status, 'ok');
        assert.deepEqual(resposta.body.banco.migracoes_pendentes, []);
        assert.equal(typeof resposta.body.banco.latencia_ms, 'number');
        assert.equal(resposta.body.jobs.length, 3);
        assert.ok(resposta.body.sincronizacoes.ultima_carga_completa);
        assert.ok(resposta.body.sincronizacoes.ultima_estoque);
    });

    test('cliente recebe 403 e visitante 401, no formato padrão', async () => {
        const doCliente = await request(app).get('/saude/detalhado').set('Authorization', cliente.auth).expect(403);
        assert.equal(doCliente.body.codigo, 'ACESSO_NEGADO');
        const visitante = await request(app).get('/saude/detalhado').expect(401);
        assert.equal(visitante.body.sucesso, false);
    });
});
