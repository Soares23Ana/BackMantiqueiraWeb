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
    await Produto.create({ sku: 'T-IDEMP', nome: 'Últimas 4', quantidade_estoque: 4 });
    for (const produto of await Produto.findAll({ where: { sku: ['T-MULT6', 'T-INATIVO', 'T-ULTIMOS', 'T-IDEMP'] } })) {
        produtos[produto.sku] = produto.id_produto;
    }

    cliente = await criarClienteComEndereco();
    outroCliente = await criarClienteComEndereco();
    funcionario = await criarUsuario('equipe', { cargo: 'Estoquista' });
    gerente = await criarUsuario('equipe', { cargo: 'Gerente' });
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

describe('idempotência do checkout (Idempotency-Key)', () => {
    const pedirComChave = (auth, chave, corpo) => pedir(auth, corpo).set('Idempotency-Key', chave);

    test('requisições simultâneas com a mesma chave criam um pedido só e baixam o estoque uma vez', async () => {
        // O estoque dá para exatamente um pedido: as repetições não podem cair em 409.
        assert.equal(await estoqueDe('T-IDEMP'), 4);
        const corpo = { itens: [{ id_produto: produtos['T-IDEMP'], quantidade: 4 }] };
        const chave = 'checkout-simultaneo-0001';
        const respostas = await Promise.all([
            pedirComChave(cliente.auth, chave, corpo),
            pedirComChave(cliente.auth, chave, corpo),
            pedirComChave(cliente.auth, chave, corpo)
        ]);
        assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 200, 201]);
        assert.equal(new Set(respostas.map((r) => r.body.pedido.id_pedido)).size, 1);
        assert.equal(await estoqueDe('T-IDEMP'), 0);

        const idPedido = respostas[0].body.pedido.id_pedido;
        const [[{ movimentacoes }]] = await sequelize.query(
            'SELECT COUNT(*) AS movimentacoes FROM movimentacoes_estoque WHERE id_pedido = ?', { replacements: [idPedido] });
        assert.equal(movimentacoes, 1);
        const [[{ eventos }]] = await sequelize.query(
            "SELECT COUNT(*) AS eventos FROM eventos WHERE tipo = 'pedido_concluido' AND id_pedido = ?", { replacements: [idPedido] });
        assert.equal(eventos, 1);

        // Depois, a mesma chave continua devolvendo o mesmo pedido, mesmo com outro corpo.
        const repetida = await pedirComChave(cliente.auth, chave, { itens: [{ id_produto: produtos['SKU-102'], quantidade: 1 }] }).expect(200);
        assert.equal(repetida.body.pedido.id_pedido, idPedido);
        assert.equal(repetida.body.mensagem, 'Este pedido já foi criado.');
        assert.deepEqual(repetida.body.pedido.itens.map((i) => [i.sku, i.quantidade]), [['T-IDEMP', 4]]);
        assert.equal(repetida.body.pedido.chave_idempotencia, undefined);
    });

    test('a chave vale por cliente e diferencia maiúsculas', async () => {
        const corpo = { itens: [{ id_produto: produtos['SKU-102'], quantidade: 1 }] };
        const primeiro = await pedirComChave(cliente.auth, 'chave-por-cliente', corpo).expect(201);
        const outro = await pedirComChave(outroCliente.auth, 'chave-por-cliente', corpo).expect(201);
        const maiusculas = await pedirComChave(cliente.auth, 'CHAVE-POR-CLIENTE', corpo).expect(201);
        assert.equal(new Set([primeiro, outro, maiusculas].map((r) => r.body.pedido.id_pedido)).size, 3);
    });

    test('chave inválida devolve 400 e não cria pedido', async () => {
        const corpo = { itens: [{ id_produto: produtos['SKU-102'], quantidade: 1 }] };
        const antes = await estoqueDe('SKU-102');
        for (const chave of ['curta', 'x'.repeat(65), 'com espaço no meio']) {
            const resposta = await pedirComChave(cliente.auth, chave, corpo).expect(400);
            assert.equal(resposta.body.codigo, 'REQUISICAO_INVALIDA');
        }
        assert.equal(await estoqueDe('SKU-102'), antes);
    });

    test('um checkout que falhou não "gasta" a chave', async () => {
        const chave = 'falhou-e-tentou-de-novo';
        await pedirComChave(cliente.auth, chave, { itens: [{ id_produto: produtos['T-MULT6'], quantidade: 4 }] }).expect(409);
        await pedirComChave(cliente.auth, chave, { itens: [{ id_produto: produtos['T-MULT6'], quantidade: 6 }] }).expect(201);
    });

    test('o CORS libera o cabeçalho Idempotency-Key', async () => {
        const resposta = await request(app)
            .options('/api/v1/pedidos')
            .set('Origin', 'http://localhost:5173')
            .set('Access-Control-Request-Method', 'POST')
            .set('Access-Control-Request-Headers', 'idempotency-key');
        assert.match(resposta.headers['access-control-allow-headers'], /Idempotency-Key/);
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

        // Qualquer usuário da equipe ainda pode cancelar em "Em Separação".
        const antes = await estoqueDe('SKU-106');
        await cancelar(funcionario.auth, id, 'Avaria no estoque').expect(200);
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

    test('cliente não muda status; qualquer usuário da equipe muda', async () => {
        await mudarStatus(cliente.auth, id, 'Em Separação').expect(403);
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-110'], quantidade: 1 }] }).expect(201);
        const resposta = await mudarStatus(funcionario.auth, body.pedido.id_pedido, 'Em Separação').expect(200);
        assert.equal(resposta.body.pedido.id_funcionario, funcionario.usuario.id_usuario);
    });
});

describe('consulta de pedidos', () => {
    before(async () => {
        // No teste de concorrência, o pedido do outroCliente pode ter sido o recusado.
        await pedir(outroCliente.auth, { itens: [{ id_produto: produtos['SKU-113'], quantidade: 1 }] }).expect(201);
    });

    test('a equipe vê qualquer pedido; cliente só o próprio', async () => {
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-111'], quantidade: 1 }] }).expect(201);
        const id = body.pedido.id_pedido;
        const admin = await criarUsuario('equipe', { pode_gerenciar_equipe: true });
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

describe('repetir pedido (GET /pedidos/:id/repetir)', () => {
    test('sugere os itens ajustados ao catálogo atual e o resultado serve direto no checkout', async () => {
        const criar = (sku, estoque) => Produto.create({ sku, nome: `Produto ${sku}`, quantidade_estoque: estoque });
        const ok = await criar('R-OK', 100);
        const mult = await criar('R-MULT', 30);
        const pouco = await criar('R-POUCO', 50);
        const inativo = await criar('R-INATIVO', 50);
        const zerado = await criar('R-ZERO', 50);
        const { body } = await pedir(cliente.auth, {
            itens: [
                { id_produto: ok.id_produto, quantidade: 4 },
                { id_produto: mult.id_produto, quantidade: 5 },
                { id_produto: pouco.id_produto, quantidade: 10 },
                { id_produto: inativo.id_produto, quantidade: 2 },
                { id_produto: zerado.id_produto, quantidade: 2 }
            ]
        }).expect(201);
        const id = body.pedido.id_pedido;

        // O catálogo muda depois do pedido.
        await mult.update({ multiplo_venda: 6 });
        await pouco.update({ quantidade_estoque: 3 });
        await inativo.update({ ativo: false });
        await zerado.update({ quantidade_estoque: 0 });

        const resposta = await request(app).get(`/api/v1/pedidos/${id}/repetir`).set('Authorization', cliente.auth).expect(200);
        const porSku = Object.fromEntries(resposta.body.itens.map((i) => [i.sku, [i.quantidade_anterior, i.quantidade_sugerida, i.ajuste]]));
        assert.deepEqual(porSku, {
            'R-OK': [4, 4, null],
            'R-MULT': [5, 6, 'ajustado_ao_multiplo'],
            'R-POUCO': [10, 3, 'reduzido_ao_estoque'],
            'R-INATIVO': [2, 0, 'produto_inativo'],
            'R-ZERO': [2, 0, 'indisponivel']
        });
        assert.equal(resposta.body.id_pedido_origem, id);
        assert.equal(resposta.body.itens_ajustados, 4);
        assert.equal(resposta.body.itens_para_checkout.length, 3);

        await pedir(cliente.auth, { itens: resposta.body.itens_para_checkout }).expect(201);
    });

    test('só o cliente dono pode repetir', async () => {
        const { body } = await pedir(cliente.auth, { itens: [{ id_produto: produtos['SKU-101'], quantidade: 1 }] }).expect(201);
        const url = `/api/v1/pedidos/${body.pedido.id_pedido}/repetir`;
        await request(app).get(url).set('Authorization', outroCliente.auth).expect(404);
        await request(app).get(url).set('Authorization', gerente.auth).expect(403);
        await request(app).get('/api/v1/pedidos/999999/repetir').set('Authorization', cliente.auth).expect(404);
    });
});
