const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;
let cliente;
const produtos = {};

// Estoques escolhidos para serem fáceis de achar: nenhum deles pode aparecer em respostas de cliente/visitante.
const ESTOQUES = { 'F-ALTO': 4321, 'F-MEDIO': 37, 'F-POUCO': 3, 'F-ZERO': 0 };

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Endereco } = require('../models');
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
    await Endereco.create({
        id_usuario: cliente.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
        bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
    });
    for (const [sku, quantidade_estoque] of Object.entries(ESTOQUES)) {
        produtos[sku] = (await Produto.create({ sku, nome: `Produto ${sku}`, quantidade_estoque })).id_produto;
    }
});

after(async () => {
    await sequelize.close();
});

// Procura, em qualquer nível, chaves de estoque exato ou o número de estoque como valor.
function vazamentos(corpo) {
    const achados = [];
    const proibidas = ['estoque', 'quantidade_estoque', 'estoque_atual', 'disponivel', 'quantidade_disponivel'];
    const exatos = [4321, 37, 3];
    (function varrer(valor, caminho) {
        if (Array.isArray(valor)) return valor.forEach((item, i) => varrer(item, `${caminho}[${i}]`));
        if (valor && typeof valor === 'object') {
            for (const [chave, interno] of Object.entries(valor)) {
                if (proibidas.includes(chave)) achados.push(`${caminho}.${chave}`);
                varrer(interno, `${caminho}.${chave}`);
            }
        } else if (typeof valor === 'number' && exatos.includes(valor) && !/solicitado|quantidade|id_|total|limite|pagina|multiplo/.test(caminho)) {
            achados.push(`${caminho}=${valor}`);
        }
    })(corpo, '$');
    return achados;
}

const get = (url, auth) => {
    const req = request(app).get(url);
    return auth ? req.set('Authorization', auth) : req;
};

describe('faixa de estoque', () => {
    test('visitante e cliente recebem faixa_estoque e nunca o estoque exato', async () => {
        for (const auth of [undefined, cliente.auth]) {
            const lista = await get('/api/v1/produtos?busca=Produto F-&limite=50', auth).expect(200);
            assert.deepEqual(vazamentos(lista.body), []);
            const porSku = Object.fromEntries(lista.body.produtos.map((p) => [p.sku, p]));
            assert.deepEqual(porSku['F-ALTO'].faixa_estoque, { codigo: 'acima_do_limite', rotulo: 'Mais de 50 disponíveis' });
            assert.deepEqual(porSku['F-MEDIO'].faixa_estoque, { codigo: 'disponivel', rotulo: 'Disponível' });
            assert.deepEqual(porSku['F-POUCO'].faixa_estoque, { codigo: 'ultimas_unidades', rotulo: 'Últimas unidades' });
            assert.deepEqual(porSku['F-ZERO'].faixa_estoque, { codigo: 'indisponivel', rotulo: 'Indisponível' });
            assert.equal(porSku['F-ALTO'].disponibilidade, 'disponivel');

            const detalhe = await get(`/api/v1/produtos/${produtos['F-ALTO']}`, auth).expect(200);
            assert.deepEqual(vazamentos(detalhe.body), []);
            assert.equal(detalhe.body.produto.faixa_estoque.codigo, 'acima_do_limite');
        }
    });

    test('equipe continua vendo o estoque exato', async () => {
        const lista = await get('/api/v1/produtos?busca=F-ALTO', equipe.auth).expect(200);
        assert.equal(lista.body.produtos[0].estoque, 4321);
        assert.equal(lista.body.produtos[0].faixa_estoque.codigo, 'acima_do_limite');
    });

    test('estoque_faixa_alta é editável (1 a 10000) e muda o limite e o rótulo', async () => {
        const url = '/api/v1/configuracoes/estoque_faixa_alta';
        for (const invalido of [0, 10001, 'abc', 2.5, true]) {
            await request(app).put(url).set('Authorization', equipe.auth).send({ valor: invalido }).expect(422);
        }
        await request(app).put(url).set('Authorization', cliente.auth).send({ valor: 20 }).expect(403);
        await request(app).put(url).set('Authorization', equipe.auth).send({ valor: 20 }).expect(200);
        const medio = await get(`/api/v1/produtos/${produtos['F-MEDIO']}`).expect(200);
        assert.deepEqual(medio.body.produto.faixa_estoque, { codigo: 'acima_do_limite', rotulo: 'Mais de 20 disponíveis' });
        // Volta ao padrão (50).
        await request(app).put(url).set('Authorization', equipe.auth).send({ valor: null }).expect(200);
        const padrao = await get(`/api/v1/produtos/${produtos['F-MEDIO']}`).expect(200);
        assert.equal(padrao.body.produto.faixa_estoque.codigo, 'disponivel');
    });

    test('409 ITENS_INDISPONIVEIS traz motivo e disponibilidade, sem quantidade', async () => {
        const resposta = await request(app).post('/api/v1/pedidos').set('Authorization', cliente.auth).send({
            itens: [
                { id_produto: produtos['F-POUCO'], quantidade: 8 },
                { id_produto: produtos['F-ZERO'], quantidade: 1 }
            ]
        }).expect(409);
        assert.equal(resposta.body.codigo, 'ITENS_INDISPONIVEIS');
        assert.deepEqual(vazamentos(resposta.body), []);
        const porSku = Object.fromEntries(resposta.body.detalhes.map((d) => [d.sku, d]));
        assert.deepEqual([porSku['F-POUCO'].motivo, porSku['F-POUCO'].disponibilidade], ['estoque_insuficiente', 'ultimas_unidades']);
        assert.deepEqual([porSku['F-ZERO'].motivo, porSku['F-ZERO'].disponibilidade], ['estoque_insuficiente', 'indisponivel']);
        // Todo erro leva o X-Request-Id no corpo.
        assert.equal(resposta.body.request_id, resposta.headers['x-request-id']);
    });

    test('repetir pedido mantém a quantidade original, marca o item e não revela o estoque', async () => {
        const { Produto } = require('../models');
        const criado = await request(app).post('/api/v1/pedidos').set('Authorization', cliente.auth)
            .send({ itens: [{ id_produto: produtos['F-ALTO'], quantidade: 10 }] }).expect(201);
        await Produto.update({ quantidade_estoque: 4 }, { where: { id_produto: produtos['F-ALTO'] } });
        const resposta = await get(`/api/v1/pedidos/${criado.body.pedido.id_pedido}/repetir`, cliente.auth).expect(200);
        assert.deepEqual(vazamentos(resposta.body), []);
        const [item] = resposta.body.itens;
        assert.equal(item.quantidade_sugerida, 10);
        assert.equal(item.ajuste, 'estoque_parcial');
        assert.equal(item.faixa_estoque.codigo, 'ultimas_unidades');
        assert.deepEqual(resposta.body.itens_para_checkout, []);
        await Produto.update({ quantidade_estoque: 4311 }, { where: { id_produto: produtos['F-ALTO'] } });
    });

    test('campanhas ativas também usam a faixa', async () => {
        const dia = 24 * 60 * 60 * 1000;
        await request(app).post('/api/v1/campanhas').set('Authorization', equipe.auth).send({
            titulo: 'Faixa', inicio_em: new Date(Date.now() - dia).toISOString(), fim_em: new Date(Date.now() + dia).toISOString(),
            produtos: [produtos['F-ALTO']]
        }).expect(201);
        const resposta = await get('/api/v1/campanhas/ativas', cliente.auth).expect(200);
        const produto = resposta.body.campanhas[0].produtos[0];
        assert.equal(produto.estoque, undefined);
        assert.equal(produto.faixa_estoque.codigo, 'acima_do_limite');
    });
});
