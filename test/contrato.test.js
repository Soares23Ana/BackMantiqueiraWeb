const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;
let comRazao;
let semRazao;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Endereco } = require('../models');
    equipe = await criarUsuario('equipe');
    comRazao = await criarUsuario('cliente', { nome: 'Ana Compras', razao_social: 'Mercado Bom Preço LTDA', cnpj: '11222333000181' });
    semRazao = await criarUsuario('cliente', { nome: 'Bruno Responsável', cnpj: '11444777000161' });
    await Endereco.create({
        id_usuario: semRazao.usuario.id_usuario, cep: '13870-000', logradouro: 'Rua A', numero: '1',
        bairro: 'Centro', cidade: 'São João da Boa Vista', estado: 'SP', principal: true
    });
    const produto = await Produto.create({ sku: 'C-1', nome: 'Produto contrato', quantidade_estoque: 10 });
    await request(app).post('/api/v1/pedidos').set('Authorization', semRazao.auth)
        .send({ itens: [{ id_produto: produto.id_produto, quantidade: 2 }] }).expect(201);
});

after(async () => {
    await sequelize.close();
});

describe('contrato padronizado', () => {
    test('GET /clientes: paginação padrão, CNPJ formatado e nome_exibicao', async () => {
        const { body } = await request(app).get('/api/v1/clientes?limite=1').set('Authorization', equipe.auth).expect(200);
        assert.deepEqual(body.paginacao, { total: 2, pagina: 1, limite: 1, total_paginas: 2 });
        const todos = (await request(app).get('/api/v1/clientes').set('Authorization', equipe.auth)).body.clientes;
        const porId = Object.fromEntries(todos.map((c) => [c.id_usuario, c]));
        assert.equal(porId[comRazao.usuario.id_usuario].nome_exibicao, 'Mercado Bom Preço LTDA');
        assert.equal(porId[semRazao.usuario.id_usuario].nome_exibicao, 'Bruno Responsável');
        assert.equal(porId[comRazao.usuario.id_usuario].cnpj, '11.222.333/0001-81');
        await request(app).get('/api/v1/clientes?limite=500').set('Authorization', equipe.auth).expect(400);
    });

    test('GET /clientes: cidade do endereço principal, total_pedidos sem cancelados, ordenar e busca por cidade', async (t) => {
        const { Endereco, Pedido } = require('../models');
        const id = comRazao.usuario.id_usuario;
        await Endereco.create({ id_usuario: id, cep: '13040-000', logradouro: 'Rua B', numero: '2', bairro: 'Centro', cidade: 'Campinas', estado: 'SP', principal: false });
        await Endereco.create({ id_usuario: id, cep: '13730-000', logradouro: 'Rua C', numero: '3', bairro: 'Centro', cidade: 'Mococa', estado: 'SP', principal: true });
        for (const status of ['Entregue', 'Aguardando Separação', 'Cancelado', 'Cancelado']) {
            await Pedido.create({ id_cliente: id, status });
        }
        const listar = (consulta) => request(app).get(`/api/v1/clientes${consulta}`).set('Authorization', equipe.auth);
        // Os outros testes deste arquivo contam pedidos e endereços: o que foi criado aqui é apagado no fim.
        t.after(async () => {
            await Pedido.destroy({ where: { id_cliente: id } });
            await Endereco.destroy({ where: { id_usuario: id } });
        });

        const porPedidos = (await listar('?ordenar=mais_pedidos').expect(200)).body.clientes;
        assert.deepEqual(porPedidos.map((c) => [c.nome_exibicao, c.cidade, c.total_pedidos]), [
            ['Mercado Bom Preço LTDA', 'Mococa', 2],
            ['Bruno Responsável', 'São João da Boa Vista', 1]
        ]);
        // Padrão continua por nome.
        assert.deepEqual((await listar('').expect(200)).body.clientes.map((c) => c.nome), ['Ana Compras', 'Bruno Responsável']);

        assert.deepEqual((await listar('?busca=mococa').expect(200)).body.clientes.map((c) => c.id_usuario), [id]);
        assert.deepEqual((await listar('?busca=boa vista').expect(200)).body.clientes.map((c) => c.id_usuario), [semRazao.usuario.id_usuario]);
        // Só a cidade do endereço principal entra na busca.
        assert.deepEqual((await listar('?busca=campinas').expect(200)).body.clientes, []);

        const invalido = await listar('?ordenar=receita').expect(400);
        assert.equal(invalido.body.codigo, 'FILTRO_INVALIDO');
        // Cliente sem endereço: cidade null.
        const semEndereco = await criarUsuario('cliente', { nome: 'Zeca Sem Endereço' });
        const zeca = (await listar('?busca=Zeca').expect(200)).body.clientes[0];
        assert.deepEqual([zeca.id_usuario, zeca.cidade, zeca.total_pedidos], [semEndereco.usuario.id_usuario, null, 0]);
        await semEndereco.usuario.destroy();
    });

    test('PUT /clientes/:id aceita CNPJ alfanumérico e as buscas por CNPJ encontram com ou sem pontuação', async (t) => {
        const alfa = await criarUsuario('cliente', { nome: 'Cliente Alfa' });
        t.after(() => alfa.usuario.destroy());
        const url = `/api/v1/clientes/${alfa.usuario.id_usuario}`;
        const atualizado = await request(app).put(url).set('Authorization', equipe.auth).send({ cnpj: '12.abc.345/01de-35' }).expect(200);
        assert.equal(atualizado.body.cliente.cnpj, '12.ABC.345/01DE-35');
        await request(app).put(url).set('Authorization', equipe.auth).send({ cnpj: '12.ABC.345/01DE-36' }).expect(422);

        for (const busca of ['12.ABC.345', 'abc34501', '01DE-35']) {
            const { body } = await request(app).get(`/api/v1/clientes?busca=${encodeURIComponent(busca)}`).set('Authorization', equipe.auth).expect(200);
            assert.deepEqual(body.clientes.map((c) => c.id_usuario), [alfa.usuario.id_usuario], busca);
        }
    });

    test('GET /clientes/:id/detalhes em snake_case', async () => {
        const { body } = await request(app).get(`/api/v1/clientes/${semRazao.usuario.id_usuario}/detalhes`)
            .set('Authorization', equipe.auth).expect(200);
        assert.deepEqual(Object.keys(body).sort(), ['cliente', 'historico_pedidos', 'produtos_mais_solicitados']);
        assert.equal(body.cliente.nome_exibicao, 'Bruno Responsável');
        assert.equal(body.cliente.cnpj, '11.444.777/0001-61');
        assert.deepEqual(body.produtos_mais_solicitados[0].quantidade_solicitada, 2);
    });

    test('pedidos trazem nome_exibicao e CNPJ formatado do cliente', async () => {
        const { body } = await request(app).get('/api/v1/pedidos').set('Authorization', equipe.auth).expect(200);
        assert.equal(body.pedidos[0].cliente.nome_exibicao, 'Bruno Responsável');
        assert.equal(body.pedidos[0].cliente.cnpj, '11.444.777/0001-61');
    });

    test('GET /painel e /painel/contadores em snake_case', async () => {
        const painel = await request(app).get('/api/v1/painel').set('Authorization', equipe.auth).expect(200);
        assert.deepEqual(Object.keys(painel.body).sort(), ['clientes_ativos', 'estoque_baixo', 'pedidos_pendentes']);
        assert.equal(painel.body.pedidos_pendentes, 1);
        const contadores = await request(app).get('/api/v1/painel/contadores').set('Authorization', equipe.auth).expect(200);
        assert.deepEqual(Object.keys(contadores.body).sort(), ['estoque_baixo', 'pedidos_pendentes']);
    });

    test('/admin/usuarios devolve o CNPJ formatado', async () => {
        const gestor = await criarUsuario('equipe', { pode_gerenciar_equipe: true });
        const { body } = await request(app).get('/api/v1/admin/usuarios?tipo=cliente').set('Authorization', gestor.auth).expect(200);
        assert.ok(body.usuarios.every((u) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(u.cnpj)));
    });
});

describe('PUT /clientes/:id/senha (senha temporária)', () => {
    const login = (identificador, senha) => request(app).post('/api/v1/auth/login').send({ identificador, senha });

    test('a equipe define a senha e o cliente entra com ela', async () => {
        await login('11.444.777/0001-61', 'Temporaria@1').expect(401);
        const resposta = await request(app).put(`/api/v1/clientes/${semRazao.usuario.id_usuario}/senha`)
            .set('Authorization', equipe.auth).send({ senha: 'Temporaria@1' }).expect(200);
        assert.match(resposta.body.mensagem, /Senha temporária/);
        await login('11.444.777/0001-61', 'Temporaria@1').expect(200);

        const [[usuario]] = await sequelize.query('SELECT senha FROM usuarios WHERE id_usuario = ?',
            { replacements: [semRazao.usuario.id_usuario] });
        assert.match(usuario.senha, /^\$2b\$12\$/);
    });

    test('valida a senha, recusa outros campos e não serve para equipe', async () => {
        const url = `/api/v1/clientes/${semRazao.usuario.id_usuario}/senha`;
        await request(app).put(url).set('Authorization', equipe.auth).send({ senha: 'curta' }).expect(422);
        await request(app).put(url).set('Authorization', equipe.auth).send({ senha: 'Temporaria@2', ativo: true }).expect(422);
        await request(app).put(`/api/v1/clientes/${equipe.usuario.id_usuario}/senha`).set('Authorization', equipe.auth)
            .send({ senha: 'Temporaria@2' }).expect(404);
        await request(app).put(url).set('Authorization', comRazao.auth).send({ senha: 'Temporaria@2' }).expect(403);
        await request(app).put(url).send({ senha: 'Temporaria@2' }).expect(401);
    });
});
