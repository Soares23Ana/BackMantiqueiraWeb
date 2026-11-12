const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;
let ana;
let beto;
const p = {};

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Endereco } = require('../models');
    equipe = await criarUsuario('equipe');
    ana = await criarUsuario('cliente');
    beto = await criarUsuario('cliente');
    for (const cliente of [ana, beto]) {
        await Endereco.create({
            id_usuario: cliente.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
            bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
        });
    }
    p.a = (await Produto.create({ sku: 'CAR-A', nome: 'Produto A', quantidade_estoque: 4321, imagem_url: '/img/a.webp' })).id_produto;
    p.b = (await Produto.create({ sku: 'CAR-B', nome: 'Caixa com 6', quantidade_estoque: 600, multiplo_venda: 6 })).id_produto;
    p.c = (await Produto.create({ sku: 'CAR-C', nome: 'Produto C', quantidade_estoque: 20 })).id_produto;
    p.inativo = (await Produto.create({ sku: 'CAR-X', nome: 'Fora de linha', quantidade_estoque: 20, ativo: false })).id_produto;
});

after(async () => {
    await sequelize.close();
});

const api = (metodo, url, auth) => {
    const req = request(app)[metodo](`/api/v1${url}`);
    return auth ? req.set('Authorization', auth.auth) : req;
};

describe('carrinho por conta', () => {
    test('visitante recebe 401 e a equipe 403, em todas as rotas', async () => {
        for (const [metodo, url] of [['get', '/carrinho'], ['put', '/carrinho'], ['delete', '/carrinho'], ['get', '/favoritos'],
            ['put', `/favoritos/${p.a}`], ['delete', `/favoritos/${p.a}`]]) {
            await api(metodo, url).expect(401);
            await api(metodo, url, equipe).expect(403);
        }
    });

    test('começa vazio e PUT substitui o carrinho inteiro, sem estoque exato', async () => {
        const vazio = await api('get', '/carrinho', ana).expect(200);
        assert.deepEqual(vazio.body, { itens: [], total_itens: 0, atualizado_em: null });

        const salvo = await api('put', '/carrinho', ana).send({ itens: [{ id_produto: p.a, quantidade: 3 }, { id_produto: p.b, quantidade: 12 }] }).expect(200);
        assert.equal(salvo.body.total_itens, 15);
        assert.deepEqual(salvo.body.itens.map((i) => [i.sku, i.quantidade, i.multiplo_venda, i.ativo, i.disponibilidade]),
            [['CAR-A', 3, 1, true, 'disponivel'], ['CAR-B', 12, 6, true, 'disponivel']]);
        assert.equal(salvo.body.itens[0].nome, 'Produto A');
        assert.equal(salvo.body.itens[0].imagem_url, '/img/a.webp');
        assert.equal(salvo.body.itens[0].faixa_estoque.codigo, 'acima_do_limite');
        assert.ok(salvo.body.atualizado_em);
        assert.ok(!JSON.stringify(salvo.body).includes('4321'));
        assert.ok(!('estoque' in salvo.body.itens[0]));

        // Substitui: o item que não vem sai do carrinho.
        const novo = await api('put', '/carrinho', ana).send({ itens: [{ id_produto: p.c, quantidade: 2 }] }).expect(200);
        assert.deepEqual(novo.body.itens.map((i) => i.sku), ['CAR-C']);
        assert.deepEqual((await api('get', '/carrinho', ana).expect(200)).body.itens.map((i) => i.sku), ['CAR-C']);
        assert.equal(await sequelize.query('SELECT COUNT(*) AS n FROM carrinhos WHERE id_usuario = ?', { replacements: [ana.usuario.id_usuario], type: 'SELECT' }).then(([l]) => l.n), 1);
    });

    test('valida produto ativo, quantidade inteira positiva, múltiplo da embalagem e o máximo de 200 itens', async () => {
        const erro = async (itens) => (await api('put', '/carrinho', ana).send({ itens }).expect(422)).body;
        const inativo = await erro([{ id_produto: p.inativo, quantidade: 1 }]);
        assert.equal(inativo.codigo, 'VALIDACAO');
        assert.match(inativo.detalhes[0].mensagem, /inexistente ou inativo/);
        await erro([{ id_produto: 999999, quantidade: 1 }]);
        const multiplo = await erro([{ id_produto: p.b, quantidade: 5 }]);
        assert.match(multiplo.detalhes[0].mensagem, /múltipla de 6/);
        for (const quantidade of [0, -1, 1.5, '2', null]) await erro([{ id_produto: p.a, quantidade }]);
        await erro([{ id_produto: p.a, quantidade: 1 }, { id_produto: p.a, quantidade: 2 }]);
        const varios = await erro([{ id_produto: p.inativo, quantidade: 1 }, { id_produto: p.b, quantidade: 5 }, 'x']);
        assert.deepEqual(varios.detalhes.map((d) => d.campo).sort(), ['itens[0]', 'itens[1]', 'itens[2]']);
        await api('put', '/carrinho', ana).send({}).expect(422);
        await api('put', '/carrinho', ana).send({ itens: [], outro: 1 }).expect(422);

        const duzentos = Array.from({ length: 200 }, (_, i) => ({ id_produto: p.a + 100000 + i, quantidade: 1 }));
        await erro([...duzentos, { id_produto: p.a, quantidade: 1 }]);
        // Nada disso alterou o carrinho guardado.
        assert.deepEqual((await api('get', '/carrinho', ana).expect(200)).body.itens.map((i) => i.sku), ['CAR-C']);
        // Lista vazia é permitida (esvazia o carrinho).
        assert.deepEqual((await api('put', '/carrinho', ana).send({ itens: [] }).expect(200)).body.itens, []);
    });

    test('isolamento: cada cliente vê só o próprio carrinho e os favoritos próprios', async () => {
        await api('put', '/carrinho', ana).send({ itens: [{ id_produto: p.a, quantidade: 1 }] }).expect(200);
        await api('put', '/carrinho', beto).send({ itens: [{ id_produto: p.c, quantidade: 7 }] }).expect(200);
        assert.deepEqual((await api('get', '/carrinho', ana).expect(200)).body.itens.map((i) => [i.sku, i.quantidade]), [['CAR-A', 1]]);
        assert.deepEqual((await api('get', '/carrinho', beto).expect(200)).body.itens.map((i) => [i.sku, i.quantidade]), [['CAR-C', 7]]);
        await api('delete', '/carrinho', beto).expect(200);
        assert.equal((await api('get', '/carrinho', beto).expect(200)).body.itens.length, 0);
        assert.equal((await api('get', '/carrinho', ana).expect(200)).body.itens.length, 1);
        // DELETE é idempotente.
        await api('delete', '/carrinho', beto).expect(200);

        await api('put', `/favoritos/${p.a}`, ana).expect(200);
        assert.deepEqual((await api('get', '/favoritos', beto).expect(200)).body.produtos, []);
    });

    test('produto desativado depois continua no carrinho, marcado como indisponível', async () => {
        const { Produto } = require('../models');
        await api('put', '/carrinho', ana).send({ itens: [{ id_produto: p.c, quantidade: 2 }] }).expect(200);
        await Produto.update({ ativo: false }, { where: { id_produto: p.c } });
        const [item] = (await api('get', '/carrinho', ana).expect(200)).body.itens;
        assert.deepEqual([item.ativo, item.disponibilidade], [false, 'indisponivel']);
        await Produto.update({ ativo: true }, { where: { id_produto: p.c } });
    });

    test('o pedido limpa o carrinho do cliente na mesma transação (e só o dele)', async () => {
        await api('put', '/carrinho', ana).send({ itens: [{ id_produto: p.a, quantidade: 2 }] }).expect(200);
        await api('put', '/carrinho', beto).send({ itens: [{ id_produto: p.a, quantidade: 5 }] }).expect(200);
        await api('post', '/pedidos', ana).send({ itens: [{ id_produto: p.a, quantidade: 2 }] }).expect(201);
        assert.equal((await api('get', '/carrinho', ana).expect(200)).body.itens.length, 0);
        assert.equal((await api('get', '/carrinho', beto).expect(200)).body.itens.length, 1);

        // Pedido recusado (409) não mexe no carrinho.
        await api('put', '/carrinho', ana).send({ itens: [{ id_produto: p.c, quantidade: 2 }] }).expect(200);
        await api('post', '/pedidos', ana).send({ itens: [{ id_produto: p.c, quantidade: 999 }] }).expect(409);
        assert.equal((await api('get', '/carrinho', ana).expect(200)).body.itens.length, 1);
    });
});

describe('favoritos', () => {
    test('PUT e DELETE são idempotentes e GET usa o formato da vitrine, sem estoque exato', async () => {
        await api('put', `/favoritos/${p.a}`, beto).expect(200);
        const repetido = await api('put', `/favoritos/${p.a}`, beto).expect(200);
        assert.deepEqual([repetido.body.id_produto, repetido.body.favorito], [p.a, true]);
        await api('put', `/favoritos/${p.b}`, beto).expect(200);

        const lista = await api('get', '/favoritos', beto).expect(200);
        assert.deepEqual(lista.body.produtos.map((x) => x.sku), ['CAR-B', 'CAR-A']);
        assert.deepEqual(lista.body.paginacao, { total: 2, pagina: 1, limite: 24, total_paginas: 1 });
        const produto = lista.body.produtos[1];
        assert.ok(produto.faixa_estoque && produto.disponibilidade && produto.categoria !== undefined);
        assert.equal(produto.estoque, undefined);
        assert.equal(produto.preco, undefined);

        const removido = await api('delete', `/favoritos/${p.a}`, beto).expect(200);
        assert.equal(removido.body.favorito, false);
        await api('delete', `/favoritos/${p.a}`, beto).expect(200);
        assert.deepEqual((await api('get', '/favoritos', beto).expect(200)).body.produtos.map((x) => x.sku), ['CAR-B']);
    });

    test('valida o produto: inexistente ou inativo dá 404; id inválido dá 400; inativo some da lista', async () => {
        const { Produto } = require('../models');
        await api('put', '/favoritos/999999', beto).expect(404);
        await api('put', `/favoritos/${p.inativo}`, beto).expect(404);
        await api('put', '/favoritos/abc', beto).expect(400);
        await Produto.update({ ativo: false }, { where: { id_produto: p.b } });
        assert.deepEqual((await api('get', '/favoritos', beto).expect(200)).body.produtos, []);
        await Produto.update({ ativo: true }, { where: { id_produto: p.b } });
    });
});
