const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');
const { lerDataHoraSaoPaulo } = require('../lib/datas');

const HORA = 3600 * 1000;
let app;
let sequelize;
let equipe;
let cliente;
let Produto;
let importarCatalogo;
let contador = 0;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto } = require('../models'));
    ({ importarCatalogo } = require('../servicos/importadorCatalogo'));
    const { Endereco } = require('../models');
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
    await Endereco.create({
        id_usuario: cliente.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
        bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
    });
});

after(async () => {
    await sequelize.close();
});

const horaSP = (data) => new Date(data.getTime() - 3 * HORA).toISOString().slice(0, 19).replace('T', ' ');
const novoProduto = async (estoque = 100) => {
    contador += 1;
    return Produto.create({ sku: `EP-${contador}`, nome: `Produto ${contador}`, quantidade_estoque: estoque });
};
// Pedido feito pela API (baixa o estoque), com a data do pedido recuada para "ha" milissegundos.
const pedir = async (produto, quantidade, ha = 0) => {
    const resposta = await request(app).post('/api/v1/pedidos').set('Authorization', cliente.auth)
        .send({ itens: [{ id_produto: produto.id_produto, quantidade }] }).expect(201);
    const id = resposta.body.pedido.id_pedido;
    if (ha) await sequelize.query('UPDATE pedidos SET data_pedido = ? WHERE id_pedido = ?', { replacements: [new Date(Date.now() - ha), id] });
    return id;
};
const estoqueDe = async (produto) => (await Produto.findByPk(produto.id_produto)).quantidade_estoque;
const importar = (linhas, opcoes = {}) => importarCatalogo(['sku;estoque;gerado_em', ...linhas].join('\n'), opcoes);
const movimentacao = async (produto) => (await sequelize.query(
    "SELECT quantidade, observacao FROM movimentacoes_estoque WHERE id_produto = ? AND tipo = 'importacao' ORDER BY id_movimentacao DESC LIMIT 1",
    { replacements: [produto.id_produto], type: 'SELECT' }))[0];

describe('data e hora de São Paulo (gerado_em)', () => {
    test('aceita os formatos da planilha e recusa datas inválidas', () => {
        const iguais = [
            ['2026-11-10 08:30:15', '2026-11-10T11:30:15.000Z'],
            ['2026-11-10T08:30', '2026-11-10T11:30:00.000Z'],
            ['10/11/2026 08:30', '2026-11-10T11:30:00.000Z'],
            ['10/11/2026', '2026-11-10T03:00:00.000Z'],
            ['2026-11-10', '2026-11-10T03:00:00.000Z'],
            ['2026-11-10T08:30:00-03:00', '2026-11-10T11:30:00.000Z'],
            ['2026-11-10T11:30:00Z', '2026-11-10T11:30:00.000Z']
        ];
        for (const [texto, esperado] of iguais) assert.equal(lerDataHoraSaoPaulo(texto).toISOString(), esperado, texto);
        for (const invalido of ['', 'ontem', '31/02/2026', '2026-13-01', '2026-11-10 25:00', '10-11-2026', '2026-11-10 8:30']) {
            assert.equal(lerDataHoraSaoPaulo(invalido), null, invalido);
        }
    });
});

describe('estoque da planilha x pedidos feitos depois dela', () => {
    test('pedido posterior ao gerado_em é descontado e a movimentação registra o desconto', async () => {
        const produto = await novoProduto(100);
        await pedir(produto, 7); // agora: estoque 93
        assert.equal(await estoqueDe(produto), 93);
        const relatorio = await importar([`${produto.sku};120;${horaSP(new Date(Date.now() - HORA))}`]);
        assert.equal(relatorio.com_erro, 0);
        assert.equal(await estoqueDe(produto), 113, 'planilha 120 - pedido de 7 feito depois');
        assert.deepEqual([relatorio.total_descontado, relatorio.produtos_com_desconto], [7, 1]);
        const mov = await movimentacao(produto);
        assert.match(mov.observacao, /Estoque da planilha: 120; descontadas 7 un\. de pedidos feitos depois de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    });

    test('pedido anterior ao gerado_em não é descontado', async () => {
        const produto = await novoProduto(100);
        await pedir(produto, 7, 2 * HORA); // feito há 2 h
        const relatorio = await importar([`${produto.sku};100;${horaSP(new Date(Date.now() - HORA))}`]);
        assert.equal(await estoqueDe(produto), 100, 'a planilha já continha esse pedido');
        assert.deepEqual([relatorio.total_descontado, relatorio.produtos_com_desconto], [0, 0]);
        assert.doesNotMatch((await movimentacao(produto)).observacao, /descontadas/);
    });

    test('pedido cancelado não é descontado', async () => {
        const produto = await novoProduto(100);
        const id = await pedir(produto, 7);
        await request(app).post(`/api/v1/pedidos/${id}/cancelar`).set('Authorization', equipe.auth).send({ motivo: 'Teste do desconto' }).expect(200);
        const relatorio = await importar([`${produto.sku};100;${horaSP(new Date(Date.now() - HORA))}`]);
        assert.equal(await estoqueDe(produto), 100);
        assert.equal(relatorio.total_descontado, 0);
    });

    test('o estoque nunca fica negativo', async () => {
        const produto = await novoProduto(100);
        await pedir(produto, 8);
        const relatorio = await importar([`${produto.sku};5;${horaSP(new Date(Date.now() - HORA))}`]);
        assert.equal(await estoqueDe(produto), 0);
        assert.equal(relatorio.total_descontado, 5, 'desconta só o que a planilha tinha');
    });

    test('soma vários pedidos e vários itens do mesmo produto; ignora pedidos de outros produtos', async () => {
        const a = await novoProduto(100);
        const b = await novoProduto(100);
        await pedir(a, 3);
        await pedir(a, 4);
        await pedir(b, 10);
        const relatorio = await importar([`${a.sku};50;${horaSP(new Date(Date.now() - HORA))}`]);
        assert.equal(await estoqueDe(a), 43);
        assert.equal(await estoqueDe(b), 90);
        assert.equal(relatorio.total_descontado, 7);
    });

    test('gerado_em por linha: cada produto usa o seu instante', async () => {
        const antigo = await novoProduto(100);
        const recente = await novoProduto(100);
        await pedir(antigo, 4, 30 * 60 * 1000); // há 30 min
        await pedir(recente, 4, 30 * 60 * 1000);
        const relatorio = await importar([
            `${antigo.sku};60;${horaSP(new Date(Date.now() - HORA))}`, // gerada há 1 h: o pedido é posterior
            `${recente.sku};60;${horaSP(new Date(Date.now() - 10 * 60 * 1000))}` // gerada há 10 min: o pedido é anterior
        ]);
        assert.equal(relatorio.com_erro, 0);
        assert.equal(await estoqueDe(antigo), 56);
        assert.equal(await estoqueDe(recente), 60);
        assert.equal(relatorio.total_descontado, 4);
    });

    test('gerado_em inválido ou no futuro é erro da linha; as outras entram', async () => {
        const bom = await novoProduto(1);
        const ruim = await novoProduto(1);
        const futuro = await novoProduto(1);
        const relatorio = await importar([
            `${bom.sku};9;${horaSP(new Date(Date.now() - HORA))}`,
            `${ruim.sku};9;ontem de manhã`,
            `${futuro.sku};9;${horaSP(new Date(Date.now() + 24 * HORA))}`
        ]);
        assert.deepEqual(relatorio.erros.map((e) => [e.linha, e.campo]), [[3, 'gerado_em'], [4, 'gerado_em']]);
        assert.equal(await estoqueDe(bom), 9);
        assert.equal(await estoqueDe(ruim), 1);
    });

    test('a simulação calcula o desconto, mas não grava', async () => {
        const produto = await novoProduto(100);
        await pedir(produto, 6);
        const relatorio = await importar([`${produto.sku};100;${horaSP(new Date(Date.now() - HORA))}`], { simular: true });
        assert.equal(relatorio.total_descontado, 6);
        assert.equal(await estoqueDe(produto), 94);
    });

    test('sem a coluna gerado_em e sem data padrão (seed, linha de comando), nada é descontado', async () => {
        const produto = await novoProduto(100);
        await pedir(produto, 6);
        const relatorio = await importarCatalogo(`sku;estoque\n${produto.sku};100`);
        assert.equal(await estoqueDe(produto), 100);
        assert.equal(relatorio.total_descontado, 0);
        assert.equal(relatorio.gerado_em_padrao, null);
    });

    test('planilha .xlsx com a data de geração como data do Excel', async () => {
        const writeXlsxFile = require('write-excel-file/node').default;
        const produto = await novoProduto(100);
        await pedir(produto, 5);
        // O Excel guarda o "relógio de parede": hora de São Paulo, sem fuso.
        const relogio = new Date(Date.now() - HORA - 3 * HORA);
        const buffer = await writeXlsxFile([
            [{ value: 'código', type: String }, { value: 'saldo', type: String }, { value: 'gerado_em', type: String }],
            [{ value: produto.sku, type: String }, { value: 40, type: Number }, { value: relogio, type: Date, format: 'yyyy-mm-dd hh:mm:ss' }]
        ]).toBuffer();
        const relatorio = await importarCatalogo(buffer, { formato: 'xlsx' });
        assert.equal(relatorio.com_erro, 0);
        assert.equal(await estoqueDe(produto), 35);
        assert.equal(relatorio.total_descontado, 5);
    });
});

describe('data padrão: upload manual e jobs de pasta', () => {
    test('upload manual usa o horário do envio: pedidos de antes do envio não são descontados', async () => {
        const produto = await novoProduto(100);
        await pedir(produto, 6); // antes do envio
        const resposta = await request(app).post('/api/v1/produtos/importar').set('Authorization', equipe.auth)
            .attach('arquivo', Buffer.from(`sku;estoque\n${produto.sku};100`), { filename: 'estoque.csv' }).expect(200);
        assert.equal(await estoqueDe(produto), 100);
        assert.equal(resposta.body.relatorio.total_descontado, 0);
        assert.ok(resposta.body.relatorio.gerado_em_padrao);
        // Com a coluna, o desconto vale também no envio manual, e fica no log.
        const segundo = await request(app).post('/api/v1/produtos/importar').set('Authorization', equipe.auth)
            .attach('arquivo', Buffer.from(`sku;estoque;gerado_em\n${produto.sku};100;${horaSP(new Date(Date.now() - HORA))}`), { filename: 'estoque2.csv' }).expect(200);
        assert.equal(await estoqueDe(produto), 94);
        assert.equal(segundo.body.relatorio.total_descontado, 6);
        const detalhe = await request(app).get(`/api/v1/produtos/importacoes/${segundo.body.id_sincronizacao}`).set('Authorization', equipe.auth).expect(200);
        assert.equal(detalhe.body.importacao.estoque_descontado, 6);
        assert.equal(detalhe.body.importacao.relatorio.total_descontado, undefined, 'o relatório do log guarda só erros e avisos');
        const lista = await request(app).get('/api/v1/produtos/importacoes').set('Authorization', equipe.auth).expect(200);
        assert.equal(lista.body.importacoes[0].estoque_descontado, 6);
    });

    test('job de pasta usa a data de modificação do arquivo', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mantiqueira-estoque-'));
        try {
            fs.mkdirSync(path.join(base, 'entrada'), { recursive: true });
            const produto = await novoProduto(100);
            await pedir(produto, 9, 30 * 60 * 1000); // há 30 min
            const arquivo = path.join(base, 'entrada', 'estoque_0800.csv');
            fs.writeFileSync(arquivo, `sku;estoque\n${produto.sku};100`);
            // O arquivo foi gerado há 1 h: o pedido de 30 min atrás é posterior.
            const geradoHa = new Date(Date.now() - HORA);
            fs.utimesSync(arquivo, geradoHa, geradoHa);
            const [resultado] = await processarPasta('estoque', base);
            assert.equal(resultado.status, 'sucesso');
            assert.equal(await estoqueDe(produto), 91);
            const [[log]] = await sequelize.query('SELECT estoque_descontado FROM sincronizacoes_log WHERE id_sincronizacao = ?', { replacements: [resultado.id_sincronizacao] });
            assert.equal(log.estoque_descontado, 9);
        } finally {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });
});

describe('pedido feito durante a importação continua consistente', () => {
    test('importação e pedido esperando o mesmo bloqueio: o estoque final é a planilha menos todos os pedidos posteriores', async () => {
        for (let rodada = 0; rodada < 4; rodada += 1) {
            const produto = await novoProduto(100);
            await pedir(produto, 3); // pedido já gravado, posterior à planilha
            const geradoEm = horaSP(new Date(Date.now() - HORA));

            // Quem segura o bloqueio da linha do produto faz importação e pedido esperarem juntos.
            const trava = await sequelize.transaction();
            await sequelize.query('SELECT id_produto FROM produtos WHERE id_produto = ? FOR UPDATE', { replacements: [produto.id_produto], transaction: trava });
            const importacao = importar([`${produto.sku};100;${geradoEm}`]);
            const pedido = pedir(produto, 5);
            await new Promise((resolver) => setTimeout(resolver, 150));
            await trava.commit();
            const [relatorio] = await Promise.all([importacao, pedido]);

            assert.equal(relatorio.com_erro, 0);
            // Qualquer que seja a ordem: 100 - 3 (já gravado) - 5 (o pedido concorrente).
            assert.equal(await estoqueDe(produto), 92, `rodada ${rodada}`);
        }
    });

    test('várias importações e pedidos disparados juntos também fecham a conta', async () => {
        const produto = await novoProduto(1000);
        const geradoEm = horaSP(new Date(Date.now() - HORA));
        await Promise.all([
            importar([`${produto.sku};1000;${geradoEm}`]),
            pedir(produto, 2),
            pedir(produto, 3),
            pedir(produto, 4)
        ]);
        // As importações que rodaram depois dos pedidos descontaram todos; as que rodaram antes foram baixadas por eles.
        assert.equal(await estoqueDe(produto), 1000 - 9);
        await importar([`${produto.sku};1000;${geradoEm}`]);
        assert.equal(await estoqueDe(produto), 991, 'repetir a importação dá o mesmo resultado (idempotente)');
    });
});
