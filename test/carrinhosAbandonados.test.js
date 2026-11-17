const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;
let cliente;
const c = {};
const p = {};
const DIA = 86400000;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Endereco } = require('../models');
    equipe = await criarUsuario('equipe', { nome: 'Fernanda da Equipe' });
    cliente = await criarUsuario('cliente');
    const novo = async (nome, extra) => {
        const usuario = await criarUsuario('cliente', { nome, razao_social: `${nome} Ltda`, ...extra });
        await Endereco.create({
            id_usuario: usuario.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
            bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
        });
        return usuario;
    };
    c.antigo = await novo('Mercado Antigo', { cnpj: '11222333000181', telefone: '35999991234' });
    c.recente = await novo('Mercado Recente', { telefone: '35988887777' });
    c.comPedido = await novo('Mercado Comprou', { telefone: '35977776666' });
    c.semFone = await novo('Mercado SemFone', { telefone: null });
    c.vazio = await novo('Mercado Vazio', { telefone: '35966665555' });
    p.a = (await Produto.create({ sku: 'AB-A', nome: 'Produto A', quantidade_estoque: 500 })).id_produto;
    p.b = (await Produto.create({ sku: 'AB-B', nome: 'Produto B', quantidade_estoque: 500 })).id_produto;
});

after(async () => {
    await sequelize.close();
});

const guardar = async (usuario, itens, diasAtras) => {
    await request(app).put('/api/v1/carrinho').set('Authorization', usuario.auth).send({ itens }).expect(200);
    await sequelize.query('UPDATE carrinhos SET atualizado_em = ? WHERE id_usuario = ?',
        { replacements: [new Date(Date.now() - diasAtras * DIA - 60000), usuario.usuario.id_usuario] });
};
const listar = (query = '', auth = equipe.auth) => request(app).get(`/api/v1/carrinhos-abandonados${query}`).set('Authorization', auth);
const ids = (resposta) => resposta.body.carrinhos.map((x) => x.cliente.nome_exibicao);

describe('carrinhos abandonados', () => {
    test('preparação: carrinhos com idades diferentes', async () => {
        await guardar(c.antigo, [{ id_produto: p.a, quantidade: 2 }, { id_produto: p.b, quantidade: 3 }], 10);
        await guardar(c.recente, [{ id_produto: p.a, quantidade: 1 }], 1);
        await guardar(c.semFone, [{ id_produto: p.b, quantidade: 4 }], 5);
        await guardar(c.vazio, [], 20);
        await guardar(c.comPedido, [{ id_produto: p.a, quantidade: 1 }], 8);
        // Pedido depois da última atualização do carrinho: deixa de ser abandonado (o pedido normal apagaria o carrinho;
        // aqui o carrinho é refeito antes e o pedido entra por fora, simulando um pedido feito por outro caminho).
        const { Pedido } = require('../models');
        await Pedido.create({ id_cliente: c.comPedido.usuario.id_usuario, status: 'Aguardando Separação' });
    });

    test('só a equipe acessa', async () => {
        await request(app).get('/api/v1/carrinhos-abandonados').expect(401);
        await listar('', cliente.auth).expect(403);
        await request(app).patch(`/api/v1/carrinhos-abandonados/${c.antigo.usuario.id_usuario}/contatado`).set('Authorization', cliente.auth).expect(403);
    });

    test('lista o abandonado (parado há 2 dias ou mais, com itens, sem pedido depois), do mais recente ao mais antigo', async () => {
        const resposta = await listar().expect(200);
        assert.equal(resposta.body.dias, 2);
        assert.deepEqual(ids(resposta), ['Mercado SemFone Ltda', 'Mercado Antigo Ltda']);
        assert.deepEqual(resposta.body.paginacao, { total: 2, pagina: 1, limite: 20, total_paginas: 1 });

        const antigo = resposta.body.carrinhos[1];
        assert.equal(antigo.cliente.id_usuario, c.antigo.usuario.id_usuario);
        assert.equal(antigo.cliente.cnpj, '11.222.333/0001-81');
        assert.equal(antigo.cliente.telefone, '35999991234');
        assert.equal(antigo.cliente.email, c.antigo.usuario.email);
        assert.equal(antigo.dias_parado, 10);
        assert.equal(antigo.total_unidades, 5);
        assert.deepEqual(antigo.itens, [
            { id_produto: p.a, sku: 'AB-A', nome: 'Produto A', quantidade: 2 },
            { id_produto: p.b, sku: 'AB-B', nome: 'Produto B', quantidade: 3 }
        ]);
        assert.ok(antigo.ultimo_movimento_em);
        assert.deepEqual([antigo.contatado_em, antigo.contatado_por], [null, null]);
        assert.equal(resposta.body.carrinhos[0].link_whatsapp, null, 'sem telefone, sem link');
    });

    test('link do WhatsApp: wa.me/55 + telefone em dígitos + mensagem educada, sem valores', async () => {
        const [, antigo] = (await listar().expect(200)).body.carrinhos;
        assert.match(antigo.link_whatsapp, /^https:\/\/wa\.me\/5535999991234\?text=/);
        const texto = decodeURIComponent(antigo.link_whatsapp.split('?text=')[1]);
        assert.match(texto, /Mercado Antigo Ltda/);
        assert.match(texto, /Mantiqueira Distribuidora/);
        assert.ok(!/R\$|\d+,\d{2}|desconto|preço|preco/i.test(texto));
        // Telefone já com o 55 não duplica o código do país.
        const { linkWhatsapp } = require('../servicos/carrinhosAbandonados');
        assert.match(linkWhatsapp('+55 (35) 99999-1234', 'X'), /^https:\/\/wa\.me\/5535999991234\?text=/);
        assert.equal(linkWhatsapp('123', 'X'), null);
    });

    test('filtros dias, busca e paginação', async () => {
        assert.deepEqual(ids(await listar('?dias=7').expect(200)), ['Mercado Antigo Ltda']);
        assert.deepEqual(ids(await listar('?dias=1').expect(200)), ['Mercado Recente Ltda', 'Mercado SemFone Ltda', 'Mercado Antigo Ltda']);
        assert.deepEqual(ids(await listar('?busca=antigo').expect(200)), ['Mercado Antigo Ltda']);
        assert.deepEqual(ids(await listar('?busca=11.222.333').expect(200)), ['Mercado Antigo Ltda']);
        assert.deepEqual(ids(await listar('?busca=zzz').expect(200)), []);
        const pagina = await listar('?limite=1&pagina=2').expect(200);
        assert.deepEqual(ids(pagina), ['Mercado Antigo Ltda']);
        assert.equal(pagina.body.paginacao.total_paginas, 2);
        for (const query of ['?dias=0', '?dias=abc', '?contatado=talvez', '?limite=0']) await listar(query).expect(400);
    });

    test('a configuração carrinho_abandonado_dias muda o corte', async () => {
        const url = '/api/v1/configuracoes/carrinho_abandonado_dias';
        for (const invalido of [0, 400, 'x', 1.5]) await request(app).put(url).set('Authorization', equipe.auth).send({ valor: invalido }).expect(422);
        await request(app).put(url).set('Authorization', equipe.auth).send({ valor: 7 }).expect(200);
        assert.deepEqual(ids(await listar().expect(200)), ['Mercado Antigo Ltda']);
        await request(app).put(url).set('Authorization', equipe.auth).send({ valor: null }).expect(200);
        assert.equal((await listar().expect(200)).body.carrinhos.length, 2);
    });

    test('contador do painel conta os abandonados ainda sem contato', async () => {
        const contadores = () => request(app).get('/api/v1/painel/contadores').set('Authorization', equipe.auth).expect(200);
        assert.equal((await contadores()).body.carrinhos_abandonados, 2);
    });

    test('PATCH contatado registra quem, quando e a observação; filtra por contatado', async () => {
        const url = (id) => `/api/v1/carrinhos-abandonados/${id}/contatado`;
        const registrar = (id, corpo) => request(app).patch(url(id)).set('Authorization', equipe.auth).send(corpo);
        const idAntigo = c.antigo.usuario.id_usuario;

        const feito = await registrar(idAntigo, { observacao: 'Falei pelo WhatsApp, vai pedir amanhã.' }).expect(200);
        assert.equal(feito.body.contato.contatado_por.nome, 'Fernanda da Equipe');
        assert.ok(feito.body.contato.contatado_em);

        const comContato = (await listar('?contatado=true').expect(200)).body.carrinhos;
        assert.deepEqual(comContato.map((x) => x.cliente.nome_exibicao), ['Mercado Antigo Ltda']);
        assert.equal(comContato[0].contatado_por.nome, 'Fernanda da Equipe');
        assert.ok(comContato[0].contatado_em);
        assert.deepEqual(ids(await listar('?contatado=false').expect(200)), ['Mercado SemFone Ltda']);
        assert.equal((await request(app).get('/api/v1/painel/contadores').set('Authorization', equipe.auth)).body.carrinhos_abandonados, 1);

        // Sem observação também vale; validações e cliente sem carrinho abandonado.
        await registrar(c.semFone.usuario.id_usuario, {}).expect(200);
        await registrar(idAntigo, { observacao: 'x'.repeat(501) }).expect(422);
        await registrar(idAntigo, { outro: 1 }).expect(422);
        await registrar(c.recente.usuario.id_usuario, {}).expect(404);
        await registrar(c.vazio.usuario.id_usuario, {}).expect(404);
        await registrar(999999, {}).expect(404);
        await registrar('abc', {}).expect(400);
        const { CarrinhoContato } = require('../models');
        assert.equal(await CarrinhoContato.count(), 2);
    });

    test('se o cliente mexe no carrinho de novo e o abandona outra vez, volta a ficar sem contato', async () => {
        // O contato foi há 6 dias; o cliente mexeu no carrinho há 4 dias e parou de novo.
        await sequelize.query('UPDATE carrinho_contatos SET criado_em = ? WHERE id_usuario = ?',
            { replacements: [new Date(Date.now() - 6 * DIA), c.antigo.usuario.id_usuario] });
        await guardar(c.antigo, [{ id_produto: p.a, quantidade: 9 }], 4);
        const resposta = await listar('?contatado=false').expect(200);
        assert.ok(ids(resposta).includes('Mercado Antigo Ltda'));
        assert.equal(resposta.body.carrinhos.find((x) => x.cliente.nome_exibicao === 'Mercado Antigo Ltda').total_unidades, 9);
    });

    test('cliente desativado não aparece', async () => {
        await sequelize.query('UPDATE usuarios SET ativo = 0 WHERE id_usuario = ?', { replacements: [c.semFone.usuario.id_usuario] });
        assert.ok(!ids(await listar().expect(200)).includes('Mercado SemFone Ltda'));
    });
});
