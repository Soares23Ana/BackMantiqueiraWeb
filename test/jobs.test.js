const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario, config, semRequestId } = require('./ajuda');
const { validarAmbiente } = require('../config/ambiente');

let app;
let sequelize;
let equipe;
let cliente;
let jobs;
let pasta;
let pastaOriginal;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
    jobs = require('../jobs');
    pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'mantiqueira-jobs-'));
    pastaOriginal = config.importacao.pasta;
    config.importacao.pasta = pasta;
    fs.mkdirSync(path.join(pasta, 'entrada'), { recursive: true });
});

after(async () => {
    config.importacao.pasta = pastaOriginal;
    fs.rmSync(pasta, { recursive: true, force: true });
    await sequelize.close();
});

const base = { JWT_SECRET: 'x'.repeat(40) };
const definicao = (nome) => jobs.buscarDefinicao(nome);
const saude = async () => (await request(app).get('/saude/detalhado').set('Authorization', equipe.auth).expect(200)).body;

describe('horários dos jobs (variáveis de ambiente)', () => {
    test('padrões: catálogo de hora em hora, carga completa à meia-noite, estoque a cada 30 min', () => {
        const { config: lida, erros } = validarAmbiente(base);
        assert.deepEqual(erros, []);
        assert.deepEqual(lida.jobs.cron, { catalogo: '0 * * * *', cargaCompleta: '0 0 * * *', estoque: '*/30 * * * *' });
    });

    test('aceita expressões próprias e recusa as inválidas ao iniciar', () => {
        const valido = validarAmbiente({ ...base, JOB_CATALOGO_CRON: '15 * * * *', JOB_ESTOQUE_CRON: '*/10 * * * *' });
        assert.deepEqual(valido.erros, []);
        assert.equal(valido.config.jobs.cron.catalogo, '15 * * * *');
        for (const [variavel, valor] of [['JOB_CATALOGO_CRON', 'toda hora'], ['JOB_CARGA_COMPLETA_CRON', '99 * * * *'], ['JOB_ESTOQUE_CRON', '* * * *'], ['JOB_ESTOQUE_CRON', '*/5 * * * * *']]) {
            const { erros } = validarAmbiente({ ...base, [variavel]: valor });
            assert.equal(erros.length, 1, `${variavel}=${valor}`);
            assert.match(erros[0], new RegExp(variavel));
        }
    });
});

describe('importação por pasta: catálogo incremental x carga completa', () => {
    const escrever = (nome, conteudo) => {
        const caminho = path.join(pasta, 'entrada', nome);
        fs.writeFileSync(caminho, conteudo);
        const passado = new Date(Date.now() - 2 * 60 * 1000);
        fs.utimesSync(caminho, passado, passado);
    };

    test('catalogo*.csv cria e atualiza sem desativar os ausentes; carga_completa*.csv desativa', async () => {
        const { Produto } = require('../models');
        const { processarPasta } = require('../servicos/sincronizacao');
        await Produto.create({ sku: 'AUSENTE-1', nome: 'Produto ausente do arquivo', quantidade_estoque: 5 });

        escrever('catalogo_1000.csv', 'sku;nome\nINCR-1;Produto incremental\n');
        const [incremental] = await processarPasta('catalogo', pasta);
        assert.equal(incremental.status, 'sucesso');
        assert.equal((await Produto.findOne({ where: { sku: 'AUSENTE-1' } })).ativo, true);
        const [[log]] = await sequelize.query('SELECT tipo, desativados FROM sincronizacoes_log WHERE id_sincronizacao = ?',
            { replacements: [incremental.id_sincronizacao] });
        assert.deepEqual(log, { tipo: 'catalogo', desativados: 0 });

        // O job incremental não pega arquivos de carga completa, e vice-versa.
        escrever('carga_completa_0000.csv', 'sku;nome\nINCR-1;Produto incremental\n');
        assert.deepEqual(await processarPasta('catalogo', pasta), []);
        const [completa] = await processarPasta('carga_completa', pasta);
        assert.equal(completa.status, 'sucesso');
        assert.equal((await Produto.findOne({ where: { sku: 'AUSENTE-1' } })).ativo, false);
        assert.equal((await Produto.findOne({ where: { sku: 'INCR-1' } })).ativo, true);
    });

    test('carga completa com erro no arquivo continua sem desativar ninguém', async () => {
        const { Produto } = require('../models');
        const { processarPasta } = require('../servicos/sincronizacao');
        await Produto.update({ ativo: true }, { where: { sku: 'AUSENTE-1' } });
        escrever('carga_completa_0001.csv', 'sku;nome\nINCR-1;Produto incremental\n;sem sku\n');
        const [resultado] = await processarPasta('carga_completa', pasta);
        assert.equal(resultado.status, 'parcial');
        assert.equal((await Produto.findOne({ where: { sku: 'AUSENTE-1' } })).ativo, true);
    });
});

describe('/saude/detalhado: estado dos jobs', () => {
    test('mostra por job última execução, status, duração, próxima execução e falhas seguidas', async () => {
        jobs._teste.reiniciarParaTestes();
        const corpo = await saude();
        assert.deepEqual(corpo.jobs.map((j) => j.nome), ['catalogo', 'carga-completa', 'estoque', 'limpeza-eventos']);
        for (const job of corpo.jobs) {
            assert.equal(job.ultima_execucao, null);
            assert.equal(job.ultimo_status, null);
            assert.equal(job.falhas_seguidas, 0);
            assert.ok(job.proxima_execucao, 'próxima execução calculada mesmo com os jobs desligados');
            assert.equal(job.situacao, 'ok');
        }
        await jobs._teste.rodar(definicao('limpeza-eventos'));
        const depois = (await saude()).jobs.find((j) => j.nome === 'limpeza-eventos');
        assert.equal(depois.ultimo_status, 'sucesso');
        assert.equal(typeof depois.ultima_duracao_ms, 'number');
        assert.ok(depois.ultima_execucao);
        assert.equal(depois.falhas_seguidas, 0);
    });

    test('degradado depois de 2 falhas seguidas; um sucesso zera a contagem', async () => {
        jobs._teste.reiniciarParaTestes();
        const job = definicao('limpeza-eventos');
        const original = job.executar;
        job.executar = async () => { throw new Error('falha de teste'); };
        try {
            await jobs._teste.rodar(job);
            let corpo = await saude();
            assert.equal(corpo.status, 'ok');
            assert.equal(corpo.jobs.find((j) => j.nome === job.nome).falhas_seguidas, 1);
            await jobs._teste.rodar(job);
            corpo = await saude();
            assert.equal(corpo.status, 'degradado');
            const doJob = corpo.jobs.find((j) => j.nome === job.nome);
            assert.deepEqual([doJob.ultimo_status, doJob.falhas_seguidas, doJob.situacao], ['falha', 2, 'degradado']);
            job.executar = original;
            await jobs._teste.rodar(job);
            corpo = await saude();
            assert.equal(corpo.status, 'ok');
            assert.equal(corpo.jobs.find((j) => j.nome === job.nome).falhas_seguidas, 0);
        } finally {
            job.executar = original;
        }
    });

    test('degradado quando o job agendado não roda há mais de 2 intervalos', async () => {
        jobs._teste.reiniciarParaTestes();
        config.jobs.ativos = true;
        jobs.iniciarJobs();
        try {
            const agora = new Date();
            assert.deepEqual(jobs.jobsDegradados(agora), []);
            // O catálogo roda de hora em hora: 2h30 depois de os jobs subirem, sem nenhuma execução, está atrasado.
            const futuro = new Date(agora.getTime() + 150 * 60 * 1000);
            assert.ok(jobs.jobsDegradados(futuro).includes('catalogo'));
            assert.ok(!jobs.jobsDegradados(futuro).includes('limpeza-eventos'));
        } finally {
            await jobs.pararJobs();
            config.jobs.ativos = false;
            jobs._teste.marcarIniciado(null);
        }
    });
});

describe('nova tentativa automática', () => {
    test('falha transitória é repetida e, se der certo, não conta como falha', async () => {
        jobs._teste.reiniciarParaTestes({ atrasoRetry: 30 });
        const job = definicao('limpeza-eventos');
        const original = job.executar;
        let chamadas = 0;
        job.executar = async () => {
            chamadas += 1;
            if (chamadas === 1) {
                const erro = new Error('conexão perdida');
                erro.code = 'ECONNRESET';
                throw erro;
            }
            return { ok: true };
        };
        try {
            await jobs._teste.rodar(job);
            assert.equal(chamadas, 1);
            assert.ok((await saude()).jobs.find((j) => j.nome === job.nome).nova_tentativa_em);
            await new Promise((resolver) => setTimeout(resolver, 300));
            assert.equal(chamadas, 2);
            const doJob = (await saude()).jobs.find((j) => j.nome === job.nome);
            assert.deepEqual([doJob.ultimo_status, doJob.falhas_seguidas, doJob.nova_tentativa_em], ['sucesso', 0, null]);
        } finally {
            job.executar = original;
            jobs._teste.reiniciarParaTestes();
        }
    });

    test('falha que não é transitória não é repetida', async () => {
        jobs._teste.reiniciarParaTestes({ atrasoRetry: 30 });
        const job = definicao('limpeza-eventos');
        const original = job.executar;
        let chamadas = 0;
        job.executar = async () => { chamadas += 1; throw new Error('erro de lógica'); };
        try {
            await jobs._teste.rodar(job);
            await new Promise((resolver) => setTimeout(resolver, 150));
            assert.equal(chamadas, 1);
            assert.equal((await saude()).jobs.find((j) => j.nome === job.nome).falhas_seguidas, 1);
        } finally {
            job.executar = original;
            jobs._teste.reiniciarParaTestes();
        }
    });

    test('reconhece as falhas de conexão do Sequelize e do driver', () => {
        const { ConnectionError } = require('sequelize');
        assert.equal(jobs._teste.falhaTransitoria(new ConnectionError(new Error('x'))), true);
        assert.equal(jobs._teste.falhaTransitoria(Object.assign(new Error('d'), { original: { code: 'ER_LOCK_DEADLOCK' } })), true);
        assert.equal(jobs._teste.falhaTransitoria(new Error('outro')), false);
    });
});

describe('POST /admin/jobs/:nome/executar', () => {
    const executar = (nome, auth = equipe.auth) => request(app).post(`/api/v1/admin/jobs/${nome}/executar`).set('Authorization', auth);

    test('equipe roda o job na hora e recebe o relatório; cliente e visitante não', async () => {
        const arquivo = path.join(pasta, 'entrada', 'estoque_manual.csv');
        const { Produto } = require('../models');
        await Produto.create({ sku: 'MANUAL-1', nome: 'Produto manual', quantidade_estoque: 1 });
        fs.writeFileSync(arquivo, 'sku;estoque\nMANUAL-1;9\n');
        const passado = new Date(Date.now() - 2 * 60 * 1000);
        fs.utimesSync(arquivo, passado, passado);

        const resposta = await executar('estoque').expect(200);
        assert.equal(resposta.body.job, 'estoque');
        assert.equal(typeof resposta.body.duracao_ms, 'number');
        assert.equal(resposta.body.resultado[0].arquivo, 'estoque_manual.csv');
        assert.equal(resposta.body.resultado[0].status, 'sucesso');
        assert.equal((await Produto.findOne({ where: { sku: 'MANUAL-1' } })).quantidade_estoque, 9);
        const estado = (await saude()).jobs.find((j) => j.nome === 'estoque');
        assert.equal(estado.ultimo_status, 'sucesso');

        await executar('estoque', cliente.auth).expect(403);
        await request(app).post('/api/v1/admin/jobs/estoque/executar').expect(401);
    });

    test('job desconhecido dá 404 com request_id', async () => {
        const resposta = await executar('nao-existe').expect(404);
        assert.equal(resposta.body.codigo, 'JOB_NAO_ENCONTRADO');
        assert.equal(semRequestId(resposta.body).sucesso, false);
    });

    test('respeita a trava do MySQL: com o job rodando em outra conexão, devolve 409', async () => {
        const outra = await sequelize.connectionManager.getConnection({ type: 'write' });
        try {
            await outra.promise().query('SELECT GET_LOCK(?, 0)', ['mantiqueira:job:estoque']);
            const resposta = await executar('estoque').expect(409);
            assert.equal(resposta.body.codigo, 'JOB_EM_EXECUCAO');
        } finally {
            await outra.promise().query('SELECT RELEASE_LOCK(?)', ['mantiqueira:job:estoque']);
            sequelize.connectionManager.releaseConnection(outra);
        }
        await executar('estoque').expect(200);
    });

    test('falha do job vira 500 sem vazar a mensagem interna', async () => {
        const job = definicao('limpeza-eventos');
        const original = job.executar;
        job.executar = async () => { throw new Error("ER_BAD_FIELD_ERROR: Unknown column 'x'"); };
        try {
            const resposta = await executar('limpeza-eventos').expect(500);
            assert.equal(resposta.body.codigo, 'JOB_FALHOU');
            assert.ok(!JSON.stringify(resposta.body).includes('ER_BAD_FIELD'));
        } finally {
            job.executar = original;
            jobs._teste.reiniciarParaTestes();
        }
    });
});
