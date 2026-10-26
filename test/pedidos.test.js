const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let Produto;
let Endereco;
let cliente;
let outroCliente;
let funcionario;
let gerente;
const produtos = {};

async function criarClienteComEndereco() {
    const novo = await criarUsuario('cliente');
    const endereco = await Endereco.create({
        id_usuario: novo.usuario.id_usuario,
        cep: '13870-000',
        logradouro: 'Rua das Flores',
        numero: '100',
        bairro: 'Centro',
        cidade: 'São João da Boa Vista',
        estado: 'SP',
        principal: true
    });
    return { ...novo, endereco };
}

const estoqueDe = async (sku) => (await Produto.findOne({ where: { sku } })).quantidade_estoque;
const pedir = (auth, corpo) => request(app).post('/api/v1/pedidos').set('Authorization', auth).send(corpo);
const mudarStatus = (auth, id, status) =>
    request(app).put(`/api/v1/pedidos/${id}/status`).set('Authorization', auth).send({ status });
const cancelar = (auth, id, motivo = 'Cliente desistiu') =>
    request(app).post(`/api/v1/pedidos/${id}/cancelar`).set('Authorization', auth).send({ motivo });

function amanha(dias = 1) {
    const data = new Date(Date.now() - 3 * 3600 * 1000);
    data.setUTCDate(data.getUTCDate() + dias);
    return data.toISOString().slice(0, 10);
}

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto, Endereco } = require('../models'));
    const { importarCatalogo } = require('../servicos/importadorCatalogo');
    await importarCatalogo(fs.readFileSync(path.join(__dirname, '..', 'seeds', 'catalogo_inicial.csv'), 'utf8'));
    for (const produto of await Produto.findAll()) produtos[produto.sku] = produto.id_produto;

    // Produtos controlados pelos testes.
    await Produto.create({ sku: 'T-MULT6', nome: 'Caixa com 6', multiplo_venda: 6, quantidade_estoque: 30 });
    await Produto.create({ sku: 'T-INATIVO', nome: 'Fora de linha', ativo: false, quantidade_estoque: 50 });
    await Produto.create({ sku: 'T-ULTIMOS', nome: 'Últimas 5', quantidade_estoque: 5 });
    for (const produto of await Produto.findAll({ where: { sku: ['T-MULT6', 'T-INATIVO', 'T-ULTIMOS'] } })) {
        produtos[produto.sku] = produto.id_produto;
    }

    cliente = await criarClienteComEndereco();
    outroCliente = await criarClienteComEndereco();
    funcionario = await criarUsuario('funcionario');
    gerente = await criarUsuario('gerente');
});

after(async () => {
    await sequelize.close();
});

describe('checkout (POST /pedidos)', () => {
    test('cria o pedido, baixa o estoque, registra movimentação e histórico', async () => {
        const antes = await estoqueDe('SKU-101');
        const resposta = await pedir(cliente.auth, {
            itens: [{ id_produto: produtos['SKU-101'], quantidade: 3 }, { id_produto: produtos['SKU-101'], quantidade: 2 }],
            observacao: 'Entregar pela manhã',
            data_entrega_desejada: amanha(2)
        }).expect(201);

        const pedido = resposta.body.pedido;
        assert.equal(pedido.status, 'Aguardando Separação');
        assert.deepEqual(pedido.itens.map((i) => [i.sku, i.quantidade]), [['SKU-101', 5]]);
        assert.equal(pedido.endereco_entrega.cidade, 'São João da Boa Vista');
        assert.equal(pedido.data_entrega_desejada, amanha(2));
        assert.equal(pedido.pode_cancelar, true);
        assert.equal(await estoqueDe('SKU-101'), antes - 5);

        const [[movimentacao]] = await sequelize.query(
            "SELECT tipo, quantidade, id_pedido FROM movimentacoes_estoque WHERE id_pedido = ? AND tipo = 'pedido'",
            { replacements: [pedido.id_pedido] }
        );
        assert.deepEqual(movimentacao, { tipo: 'pedido', quantidade: -5, id_pedido: pedido.id_pedido });
        const [historico] = await sequelize.query('SELECT status_anterior, status_novo FROM pedido_historico WHERE id_pedido = ?',
            { replacements: [pedido.id_pedido] });
        assert.deepEqual(historico, [{ status_anterior: null, status_novo: 'Aguardando Separação' }]);
        // Nenhum valor financeiro na resposta.
        assert.doesNotMatch(JSON.stringify(resposta.body), /preco|valor|total_pedido/);
    });

    test('devolve todos os itens com problema de uma vez e não grava nada', async () => {
        const antes = await estoqueDe('SKU-102');
        const resposta = await pedir(cliente.auth, {
            itens: [
                { id_produto: produtos['SKU-102'], quantidade: 1 },
                { id_produto: 999999, quantidade: 1 },
                { id_produto: produtos['T-INATIVO'], quantidade: 1 },
                { id_produto: produtos['T-MULT6'], quantidade: 4 },
                { id_produto: produtos['T-ULTIMOS'], quantidade: 8 },
                { id_produto: produtos['SKU-104'], quantidade: 1 }
            ]
        }).expect(409);
        assert.equal(resposta.body.codigo, 'ITENS_INDISPONIVEIS');
        const porProduto = Object.fromEntries(resposta.body.detalhes.map((d) => [d.id_produto, d]));
        assert.equal(resposta.body.detalhes.length, 5);
        assert.equal(porProduto[999999].motivo, 'produto_inexistente');
        assert.equal(porProduto[produtos['T-INATIVO']].motivo, 'produto_inativo');
        assert.deepEqual(
            { motivo: porProduto[produtos['T-MULT6']].motivo, multiplo: porProduto[produtos['T-MULT6']].multiplo_venda, disponivel: porProduto[produtos['T-MULT6']].disponivel },
            { motivo: 'multiplo_de_venda', multiplo: 6, disponivel: 30 }
        );
        assert.deepEqual(
            { motivo: porProduto[produtos['T-ULTIMOS']].motivo, solicitado: porProduto[produtos['T-ULTIMOS']].solicitado, disponivel: porProduto[produtos['T-ULTIMOS']].disponivel },
            { motivo: 'estoque_insuficiente', solicitado: 8, disponivel: 5 }
        );
        assert.equal(porProduto[produtos['SKU-104']].motivo, 'estoque_insuficiente');
        assert.equal(await estoqueDe('SKU-102'), antes);
    });

    test('valida corpo, endereço e data de entrega', async () => {
        const invalido = await pedir(cliente.auth, { itens: [], extra: 1, data_entrega_desejada: '2026-02-30' }).expect(422);
        assert.deepEqual(invalido.body.detalhes.map((d) => d.campo).sort(), ['data_entrega_desejada', 'extra', 'itens']);

        const passado = await pedir(cliente.auth, {
            itens: [{ id_produto: produtos['SKU-102'], quantidade: 1 }],
            data_entrega_desejada: amanha(0)
        }).expect(422);
        assert.match(passado.body.mensagem, /entre amanhã/);

        const enderecoAlheio = await pedir(cliente.auth, {
            itens: [{ id_produto: produtos['SKU-102'], quantidade: 1 }],
            id_endereco: outroCliente.endereco.id_endereco
        }).expect(422);
        assert.equal(enderecoAlheio.body.detalhes[0].campo, 'id_endereco');

        const semEndereco = await criarUsuario('cliente');
        const resposta = await pedir(semEndereco.auth, { itens: [{ id_produto: produtos['SKU-102'], quantidade: 1 }] }).expect(422);
        assert.equal(resposta.body.codigo, 'ENDERECO_OBRIGATORIO');
    });

    test('só cliente cria pedido', async () => {
        await pedir(gerente.auth, { itens: [{ id_produto: produtos['SKU-102'], quantidade: 1 }] }).expect(403);
        await request(app).post('/api/v1/pedidos').send({}).expect(401);
    });

    test('concorrência: dois pedidos pelas últimas unidades, só um passa', async () => {
        const antes = await estoqueDe('T-ULTIMOS');
        assert.equal(antes, 5);
        const corpo = { itens: [{ id_produto: produtos['T-ULTIMOS'], quantidade: 5 }] };
        const respostas = await Promise.all([pedir(cliente.auth, corpo), pedir(outroCliente.auth, corpo), pedir(cliente.auth, corpo)]);
        const status = respostas.map((r) => r.status).sort();
        assert.deepEqual(status, [201, 409, 409]);
        assert.equal(await estoqueDe('T-ULTIMOS'), 0);
        const [[{ total }]] = await sequelize.query(
            "SELECT COUNT(*) AS total FROM itens_pedido WHERE id_produto = ?",
            { replacements: [produtos['T-ULTIMOS']] }
        );
        assert.equal(total, 1);
    });
});

describe('cancelamento', () => {
    test('cliente cancela o próprio pedido e o estoque volta com movimentação', async () => {
        const antes = await estoqueDe('SKU-105');
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-105'], quantidade: 7 }] }).expect(201);
        assert.equal(await estoqueDe('SKU-105'), antes - 7);

        await request(app).post(`/api/v1/pedidos/${body.pedido.id_pedido}/cancelar`).set('Authorization', cliente.auth)
            .send({ motivo: '' }).expect(422);
        const resposta = await cancelar(cliente.auth, body.pedido.id_pedido, 'Pedi errado').expect(200);
        assert.equal(resposta.body.pedido.status, 'Cancelado');
        assert.equal(resposta.body.pedido.motivo_cancelamento, 'Pedi errado');
        assert.equal(await estoqueDe('SKU-105'), antes);

        const [[movimentacao]] = await sequelize.query(
            "SELECT quantidade FROM movimentacoes_estoque WHERE id_pedido = ? AND tipo = 'cancelamento'",
            { replacements: [body.pedido.id_pedido] }
        );
        assert.equal(movimentacao.quantidade, 7);

        // Não cancela duas vezes nem devolve o estoque de novo.
        await cancelar(cliente.auth, body.pedido.id_pedido).expect(409);
        assert.equal(await estoqueDe('SKU-105'), antes);
    });

    test('cliente não cancela pedido de outro nem depois que a separação começou', async () => {
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-106'], quantidade: 1 }] }).expect(201);
        const id = body.pedido.id_pedido;
        await cancelar(outroCliente.auth, id).expect(404);

        await mudarStatus(gerente.auth, id, 'Em Separação').expect(200);
        const resposta = await cancelar(cliente.auth, id).expect(409);
        assert.equal(resposta.body.codigo, 'CANCELAMENTO_NAO_PERMITIDO');

        // Gerente ainda pode cancelar em "Em Separação"; funcionário não cancela.
        await cancelar(funcionario.auth, id).expect(403);
        const antes = await estoqueDe('SKU-106');
        await cancelar(gerente.auth, id, 'Avaria no estoque').expect(200);
        assert.equal(await estoqueDe('SKU-106'), antes + 1);
    });

    test('gerente não cancela pedido que já saiu para entrega', async () => {
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-108'], quantidade: 1 }] }).expect(201);
        const id = body.pedido.id_pedido;
        await mudarStatus(gerente.auth, id, 'Em Separação').expect(200);
        await mudarStatus(gerente.auth, id, 'Saiu para Entrega').expect(200);
        await cancelar(gerente.auth, id).expect(409);
    });
});

describe('transições de status', () => {
    let id;

    before(async () => {
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-110'], quantidade: 2 }] }).expect(201);
        id = body.pedido.id_pedido;
    });

    test('não pula etapas nem volta', async () => {
        const pulo = await mudarStatus(gerente.auth, id, 'Entregue').expect(409);
        assert.equal(pulo.body.codigo, 'TRANSICAO_INVALIDA');
        assert.equal(pulo.body.detalhes.proximo_permitido, 'Em Separação');
        await mudarStatus(gerente.auth, id, 'Aguardando Separação').expect(409);
        const cancelado = await mudarStatus(gerente.auth, id, 'Cancelado').expect(422);
        assert.match(cancelado.body.mensagem, /cancelar/);
        await mudarStatus(gerente.auth, id, 'Inventado').expect(422);
    });

    test('segue o fluxo completo, grava id_funcionario, data de entrega e histórico', async () => {
        await mudarStatus(gerente.auth, id, 'Em Separação').expect(200);
        await mudarStatus(gerente.auth, id, 'Em Separação').expect(409);
        await request(app).patch(`/api/v1/pedidos/${id}/status`).set('Authorization', gerente.auth)
            .send({ status: 'Saiu para Entrega', observacao: 'Rota 3' }).expect(200);
        const entregue = await mudarStatus(gerente.auth, id, 'Entregue').expect(200);
        assert.ok(entregue.body.pedido.data_entrega);
        assert.equal(entregue.body.pedido.id_funcionario, gerente.usuario.id_usuario);
        await mudarStatus(gerente.auth, id, 'Em Separação').expect(409);

        const detalhe = await request(app).get(`/api/v1/pedidos/${id}`).set('Authorization', funcionario.auth).expect(200);
        assert.deepEqual(detalhe.body.pedido.historico.map((h) => h.status_novo),
            ['Aguardando Separação', 'Em Separação', 'Saiu para Entrega', 'Entregue']);
        assert.equal(detalhe.body.pedido.historico[2].observacao, 'Rota 3');
        assert.equal(detalhe.body.pedido.historico[3].usuario.id_usuario, gerente.usuario.id_usuario);
        assert.equal(detalhe.body.pedido.funcionario.id_usuario, gerente.usuario.id_usuario);
        assert.equal(detalhe.body.pedido.proximo_status, null);
    });

    test('funcionário e cliente não mudam status', async () => {
        await mudarStatus(funcionario.auth, id, 'Em Separação').expect(403);
        await mudarStatus(cliente.auth, id, 'Em Separação').expect(403);
    });
});

describe('consulta de pedidos', () => {
    before(async () => {
        // No teste de concorrência, o pedido do outroCliente pode ter sido o recusado.
        await pedir(outroCliente.auth, { itens: [{ id_produto: produtos['SKU-113'], quantidade: 1 }] }).expect(201);
    });

    test('funcionário, gerente e admin veem qualquer pedido; cliente só o próprio', async () => {
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-111'], quantidade: 1 }] }).expect(201);
        const id = body.pedido.id_pedido;
        const admin = await criarUsuario('admin');
        for (const usuario of [funcionario, gerente, admin]) {
            const resposta = await request(app).get(`/api/v1/pedidos/${id}`).set('Authorization', usuario.auth).expect(200);
            assert.equal(resposta.body.pedido.cliente.id_usuario, cliente.usuario.id_usuario);
        }
        const doDono = await request(app).get(`/api/v1/pedidos/${id}`).set('Authorization', cliente.auth).expect(200);
        assert.equal(doDono.body.pedido.cliente, undefined);
        assert.equal(doDono.body.pedido.historico.length, 1);
        const alheio = await request(app).get(`/api/v1/pedidos/${id}`).set('Authorization', outroCliente.auth).expect(404);
        assert.equal(alheio.body.codigo, 'PEDIDO_NAO_ENCONTRADO');
        await request(app).get('/api/v1/pedidos/abc').set('Authorization', gerente.auth).expect(400);
    });

    test('GET /pedidos/meus lista só os pedidos do cliente, com filtro de status', async () => {
        const { body } = await request(app).get('/api/v1/pedidos/meus?limite=100').set('Authorization', outroCliente.auth).expect(200);
        assert.ok(body.pedidos.length >= 1);
        const [[{ total }]] = await sequelize.query('SELECT COUNT(*) AS total FROM pedidos WHERE id_cliente = ?',
            { replacements: [outroCliente.usuario.id_usuario] });
        assert.equal(body.paginacao.total, total);

        const cancelados = await request(app).get('/api/v1/pedidos/meus?status=Cancelado').set('Authorization', cliente.auth).expect(200);
        assert.ok(cancelados.body.pedidos.every((p) => p.status === 'Cancelado'));
        await request(app).get('/api/v1/pedidos/meus').set('Authorization', gerente.auth).expect(403);
    });

    test('GET /pedidos (equipe): paginação e filtros de status, cliente, período e busca', async () => {
        const todos = await request(app).get('/api/v1/pedidos?limite=2').set('Authorization', funcionario.auth).expect(200);
        assert.equal(todos.body.pedidos.length, 2);
        const [[{ total }]] = await sequelize.query('SELECT COUNT(*) AS total FROM pedidos');
        assert.equal(todos.body.paginacao.total, total);
        assert.equal(todos.body.paginacao.total_paginas, Math.ceil(total / 2));

        const varios = await request(app).get('/api/v1/pedidos?status=Cancelado,Entregue&limite=100').set('Authorization', gerente.auth);
        assert.ok(varios.body.pedidos.length >= 3);
        assert.ok(varios.body.pedidos.every((p) => ['Cancelado', 'Entregue'].includes(p.status)));

        const doCliente = await request(app).get(`/api/v1/pedidos?id_cliente=${outroCliente.usuario.id_usuario}&limite=100`)
            .set('Authorization', gerente.auth);
        assert.ok(doCliente.body.pedidos.every((p) => p.cliente.id_usuario === outroCliente.usuario.id_usuario));

        const hoje = amanha(0);
        const periodo = await request(app).get(`/api/v1/pedidos?de=${hoje}&ate=${hoje}&limite=100`).set('Authorization', gerente.auth);
        assert.equal(periodo.body.paginacao.total, total);
        const futuro = await request(app).get(`/api/v1/pedidos?de=${amanha(1)}`).set('Authorization', gerente.auth);
        assert.equal(futuro.body.paginacao.total, 0);

        const primeiro = todos.body.pedidos[0];
        const porNumero = await request(app).get(`/api/v1/pedidos?busca=${primeiro.id_pedido}`).set('Authorization', gerente.auth);
        assert.ok(porNumero.body.pedidos.some((p) => p.id_pedido === primeiro.id_pedido));
        const porNome = await request(app).get(`/api/v1/pedidos?busca=${encodeURIComponent(outroCliente.usuario.nome)}&limite=100`)
            .set('Authorization', gerente.auth);
        assert.ok(porNome.body.pedidos.length >= 1);
        assert.ok(porNome.body.pedidos.every((p) => p.cliente.id_usuario === outroCliente.usuario.id_usuario));

        await request(app).get('/api/v1/pedidos?status=Pendente').set('Authorization', gerente.auth).expect(400);
        await request(app).get('/api/v1/pedidos?de=26/10/2026').set('Authorization', gerente.auth).expect(400);
        await request(app).get('/api/v1/pedidos').set('Authorization', cliente.auth).expect(403);
    });
});
