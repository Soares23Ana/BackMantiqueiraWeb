const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

const DIA = 86400000;

let app;
let sequelize;
let equipe;
let cliente;
let outro;
let pedidoId;
const p = {};

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Endereco } = require('../models');
    equipe = await criarUsuario('equipe', { nome: 'Atendente' });
    cliente = await criarUsuario('cliente', { nome: 'Cliente Histórico', razao_social: 'Histórico Ltda', telefone: '35999991234' });
    outro = await criarUsuario('cliente', { nome: 'Outro Cliente' });
    for (const c of [cliente, outro]) {
        await Endereco.create({
            id_usuario: c.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
            bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
        });
    }
    p.a = (await Produto.create({ sku: 'HIS-A', nome: 'Produto Histórico A', quantidade_estoque: 100 })).id_produto;
    p.b = (await Produto.create({ sku: 'HIS-B', nome: 'Produto Histórico B', quantidade_estoque: 100 })).id_produto;
});

after(async () => {
    await sequelize.close();
});

const api = (metodo, url, usuario) => {
    const req = request(app)[metodo](`/api/v1${url}`);
    return usuario ? req.set('Authorization', usuario.auth) : req;
};
const historico = async (query = '', id = cliente.usuario.id_usuario) => (await api('get', `/clientes/${id}/historico${query}`, equipe).expect(200)).body;
const titulos = (corpo) => corpo.historico.map((e) => e.titulo);
const mover = (sql, valores) => sequelize.query(sql, { replacements: valores });

describe('GET /clientes/:id/historico', () => {
    test('preparação: cadastro, pedido com mudanças de status e cancelamento, carrinho, acessos e nota', async () => {
        const id = cliente.usuario.id_usuario;
        const { Evento } = require('../models');
        // Tudo recuado no tempo para a ordem ficar previsível.
        const criado = await api('post', '/pedidos', cliente).send({ itens: [{ id_produto: p.a, quantidade: 4 }, { id_produto: p.b, quantidade: 2 }] }).expect(201);
        pedidoId = criado.body.pedido.id_pedido;
        await api('put', `/pedidos/${pedidoId}/status`, equipe).send({ status: 'Em Separação', observacao: 'Separando agora' }).expect(200);
        await api('post', `/pedidos/${pedidoId}/cancelar`, equipe).send({ motivo: 'Cliente desistiu' }).expect(200);
        const segundo = await api('post', '/pedidos', cliente).send({ itens: [{ id_produto: p.a, quantidade: 1 }] }).expect(201);
        // Os pedidos ficam 10 dias para trás: o carrinho de baixo é mais novo que eles... e mesmo assim parado há 5 dias.
        const antigo = new Date(Date.now() - 10 * DIA);
        await mover('UPDATE pedidos SET data_pedido = ? WHERE id_cliente = ?', [antigo, id]);
        await mover('UPDATE pedido_historico h JOIN pedidos p ON p.id_pedido = h.id_pedido SET h.criado_em = ? WHERE p.id_cliente = ?', [antigo, id]);

        await Evento.create({ tipo: 'produto_visto', id_usuario: id, id_produto: p.a });
        await Evento.create({ tipo: 'carrinho_adicionar', id_usuario: id, id_produto: p.b, quantidade: 3 });
        await Evento.create({ tipo: 'checkout_iniciado', id_usuario: id });
        await Evento.create({ tipo: 'pedido_concluido', id_usuario: id, id_pedido: segundo.body.pedido.id_pedido });
        await Evento.create({ tipo: 'busca', id_usuario: id, termo: 'sabonete' });
        await Evento.create({ tipo: 'produto_visto', id_usuario: outro.usuario.id_usuario, id_produto: p.a });

        await api('put', '/carrinho', cliente).send({ itens: [{ id_produto: p.a, quantidade: 2 }, { id_produto: p.b, quantidade: 5 }] }).expect(200);
        await mover('UPDATE carrinhos SET atualizado_em = ? WHERE id_usuario = ?', [new Date(Date.now() - 5 * DIA), id]);
        await api('patch', `/carrinhos-abandonados/${id}/contatado`, equipe).send({ observacao: 'Ligou e vai pedir' }).expect(200);
        await api('post', `/clientes/${id}/notas`, equipe).send({ texto: 'Prefere entrega pela manhã.' }).expect(201);
        await api('put', '/carrinho', outro).send({ itens: [{ id_produto: p.a, quantidade: 1 }] }).expect(200);
    });

    test('só a equipe; cliente inexistente e filtros inválidos', async () => {
        const id = cliente.usuario.id_usuario;
        await api('get', `/clientes/${id}/historico`).expect(401);
        await api('get', `/clientes/${id}/historico`, cliente).expect(403);
        await api('get', '/clientes/999999/historico', equipe).expect(404);
        await api('get', `/clientes/${equipe.usuario.id_usuario}/historico`, equipe).expect(404);
        await api('get', '/clientes/abc/historico', equipe).expect(400);
        for (const query of ['?tipo=outro', '?de=ontem', '?ate=2026-13-45', '?limite=0', '?de=2026-02-01&ate=2026-01-01']) {
            await api('get', `/clientes/${id}/historico${query}`, equipe).expect(400);
        }
    });

    test('une as fontes, do mais recente ao mais antigo, no formato { tipo, data, titulo, detalhe, referencia }', async () => {
        const corpo = await historico('?limite=200');
        assert.ok(corpo.historico.every((e) => ['tipo', 'data', 'titulo', 'detalhe', 'referencia'].every((chave) => chave in e)));
        const datas = corpo.historico.map((e) => new Date(e.data).getTime());
        assert.deepEqual(datas, [...datas].sort((a, b) => b - a));

        const lista = titulos(corpo);
        for (const esperado of ['Cadastro criado', `Pedido #${pedidoId} feito`, `Pedido #${pedidoId}: Em Separação`, `Pedido #${pedidoId} cancelado`,
            'Carrinho atualizado', 'Carrinho abandonado', 'Contato sobre o carrinho abandonado', 'Viu um produto',
            'Adicionou ao carrinho', 'Iniciou o checkout', 'Nota de Atendente']) {
            assert.ok(lista.includes(esperado), `faltou: ${esperado}`);
        }
        assert.ok(lista.some((t) => t.startsWith('Concluiu o pedido #')));
        // Busca não é "acesso" do histórico e eventos de outro cliente não entram.
        assert.equal(corpo.historico.filter((e) => e.titulo === 'Viu um produto').length, 1);
        assert.equal(corpo.paginacao.total, corpo.historico.length);

        const porTitulo = Object.fromEntries(corpo.historico.map((e) => [e.titulo, e]));
        assert.deepEqual(porTitulo[`Pedido #${pedidoId} feito`].referencia, { tipo: 'pedido', id: pedidoId });
        assert.equal(porTitulo[`Pedido #${pedidoId} feito`].detalhe, '2 itens, 6 unidades.');
        assert.equal(porTitulo[`Pedido #${pedidoId} cancelado`].detalhe, 'Motivo: Cliente desistiu');
        assert.equal(porTitulo[`Pedido #${pedidoId}: Em Separação`].detalhe, 'Separando agora');
        assert.equal(porTitulo['Carrinho atualizado'].detalhe, '2 itens, 7 unidades.');
        assert.equal(porTitulo['Carrinho abandonado'].tipo, 'carrinho');
        assert.match(porTitulo['Contato sobre o carrinho abandonado'].detalhe, /Por Atendente\. Ligou e vai pedir/);
        assert.deepEqual(porTitulo['Viu um produto'].referencia, { tipo: 'produto', id: p.a });
        assert.equal(porTitulo['Viu um produto'].detalhe, 'Produto Histórico A');
        assert.equal(porTitulo['Adicionou ao carrinho'].detalhe, 'Produto Histórico B — 3 un.');
        assert.equal(porTitulo['Iniciou o checkout'].referencia, null);
        assert.equal(porTitulo['Nota de Atendente'].detalhe, 'Prefere entrega pela manhã.');
        assert.equal(porTitulo['Nota de Atendente'].referencia.tipo, 'nota');
        assert.deepEqual(porTitulo['Cadastro criado'].referencia, { tipo: 'cliente', id: cliente.usuario.id_usuario });
    });

    test('filtro por tipo', async () => {
        const pedidos = await historico('?tipo=pedido&limite=200');
        assert.ok(pedidos.historico.every((e) => e.tipo === 'pedido'));
        // 2 pedidos feitos, 1 mudança de status e 1 cancelamento ("concluiu o pedido" é acesso).
        assert.equal(pedidos.historico.length, 4);
    });

    test('filtro por tipo: carrinho, acesso e nota', async () => {
        const carrinho = await historico('?tipo=carrinho');
        assert.deepEqual(titulos(carrinho).sort(), ['Carrinho abandonado', 'Carrinho atualizado', 'Contato sobre o carrinho abandonado'].sort());
        const acesso = await historico('?tipo=acesso');
        // Os dois pedidos reais registram "pedido concluído" sozinhos, e o teste criou mais um.
        assert.deepEqual(titulos(acesso).filter((t) => !t.startsWith('Concluiu')).sort(), ['Adicionou ao carrinho', 'Iniciou o checkout', 'Viu um produto']);
        assert.equal(titulos(acesso).filter((t) => t.startsWith('Concluiu o pedido #')).length, 3);
        assert.ok(acesso.historico.every((e) => e.tipo === 'acesso'));
        const notas = await historico('?tipo=nota');
        assert.deepEqual(titulos(notas), ['Nota de Atendente']);
        const cadastro = await historico('?tipo=cadastro');
        assert.deepEqual(titulos(cadastro), ['Cadastro criado']);
    });

    test('filtro por período e paginação', async () => {
        const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
        const recente = await historico(`?de=${hoje}&ate=${hoje}&limite=200`);
        assert.ok(!titulos(recente).includes('Carrinho atualizado'), 'o carrinho foi recuado 5 dias');
        assert.ok(titulos(recente).includes('Viu um produto'));
        assert.equal((await historico('?ate=2020-01-01')).historico.length, 0);
        assert.equal((await historico('?de=2999-01-01')).paginacao.total, 0);

        const todos = await historico('?limite=200');
        const pagina1 = await historico('?limite=3&pagina=1');
        const pagina2 = await historico('?limite=3&pagina=2');
        assert.deepEqual([...titulos(pagina1), ...titulos(pagina2)], titulos(todos).slice(0, 6));
        assert.equal(pagina1.paginacao.total_paginas, Math.ceil(todos.paginacao.total / 3));
    });

    test('carrinho recente não aparece como abandonado e histórico de outro cliente fica separado', async () => {
        const corpo = await historico('?tipo=carrinho', outro.usuario.id_usuario);
        assert.deepEqual(titulos(corpo), ['Carrinho atualizado']);
        assert.deepEqual((await historico('?tipo=nota', outro.usuario.id_usuario)).historico, []);
    });
});

describe('GET /clientes/:id/detalhes: carrinho_atual e ultimo_evento_em', () => {
    const detalhes = async (id) => (await api('get', `/clientes/${id}/detalhes`, equipe).expect(200)).body;

    test('carrinho atual abandonado, com contato, e a data do último evento', async () => {
        const corpo = await detalhes(cliente.usuario.id_usuario);
        assert.ok(Array.isArray(corpo.historico_pedidos) && Array.isArray(corpo.produtos_mais_solicitados));
        const atual = corpo.carrinho_atual;
        assert.deepEqual(atual.itens.map((i) => [i.sku, i.quantidade]), [['HIS-A', 2], ['HIS-B', 5]]);
        assert.equal(atual.total_unidades, 7);
        assert.equal(atual.dias_parado, 5);
        assert.equal(atual.abandonado, true);
        assert.ok(atual.contatado_em);
        assert.ok(atual.ultimo_movimento_em);
        assert.ok(corpo.ultimo_evento_em);
        assert.ok(!Number.isNaN(Date.parse(corpo.ultimo_evento_em)));
    });

    test('carrinho recente não é abandonado; sem carrinho nem eventos, os campos vêm nulos', async () => {
        const recente = await detalhes(outro.usuario.id_usuario);
        assert.equal(recente.carrinho_atual.abandonado, false);
        assert.equal(recente.carrinho_atual.contatado_em, null);
        const vazio = await criarUsuario('cliente');
        const corpo = await detalhes(vazio.usuario.id_usuario);
        assert.equal(corpo.carrinho_atual, null);
        assert.equal(corpo.ultimo_evento_em, null);
    });

    test('pedido feito depois do carrinho tira o abandono', async () => {
        const novo = await criarUsuario('cliente');
        const { Endereco, Pedido } = require('../models');
        await Endereco.create({
            id_usuario: novo.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
            bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
        });
        await api('put', '/carrinho', novo).send({ itens: [{ id_produto: p.a, quantidade: 1 }] }).expect(200);
        await mover('UPDATE carrinhos SET atualizado_em = ? WHERE id_usuario = ?', [new Date(Date.now() - 6 * DIA), novo.usuario.id_usuario]);
        assert.equal((await detalhes(novo.usuario.id_usuario)).carrinho_atual.abandonado, true);
        await Pedido.create({ id_cliente: novo.usuario.id_usuario, status: 'Aguardando Separação' });
        assert.equal((await detalhes(novo.usuario.id_usuario)).carrinho_atual.abandonado, false);
        assert.ok(!titulos(await historico('?tipo=carrinho', novo.usuario.id_usuario)).includes('Carrinho abandonado'));
    });
});
