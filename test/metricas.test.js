const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let Evento;
let equipe;
let cliente;
let clienteSemPedido;
const produtos = {};

const enviar = (corpo, auth) => {
    const req = request(app).post('/api/v1/eventos').send(corpo);
    return auth ? req.set('Authorization', auth) : req;
};
const metrica = (rota) => request(app).get(`/api/v1/metricas/${rota}`).set('Authorization', equipe.auth);

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Endereco } = require('../models');
    ({ Evento } = require('../models'));
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente', { nome: 'Cliente Comprador' });
    clienteSemPedido = await criarUsuario('cliente', { nome: 'Cliente Sumido', razao_social: 'Sumido LTDA' });
    await Endereco.create({
        id_usuario: cliente.usuario.id_usuario, cep: '13870-000', logradouro: 'Rua A', numero: '1',
        bairro: 'Centro', cidade: 'São João da Boa Vista', estado: 'SP', principal: true
    });
    for (const [sku, nome] of [['M-1', 'Sabonete Lavanda'], ['M-2', 'Shampoo Infantil']]) {
        produtos[sku] = (await Produto.create({ sku, nome, quantidade_estoque: 100 })).id_produto;
    }
});

after(async () => {
    await sequelize.close();
});

describe('POST /eventos', () => {
    test('aceita os tipos do front, associa o usuário logado e não guarda IP', async () => {
        await enviar({ tipo: 'produto_visto', id_produto: produtos['M-1'], sessao: 'sessao-abc-123' }).expect(202);
        await enviar({ tipo: 'carrinho_adicionar', id_produto: produtos['M-1'], quantidade: 3 }, cliente.auth).expect(202);
        await enviar({ tipo: 'checkout_iniciado' }, cliente.auth).expect(202);
        await enviar({ tipo: 'banner_clique', id_banner: 5 }).expect(202);
        await enviar({ tipo: 'campanha_clique', id_campanha: 2 }).expect(202);

        const [linhas] = await sequelize.query("SELECT tipo, id_usuario, sessao, quantidade FROM eventos WHERE tipo IN ('produto_visto', 'carrinho_adicionar') ORDER BY id_evento");
        assert.deepEqual(linhas, [
            { tipo: 'produto_visto', id_usuario: null, sessao: 'sessao-abc-123', quantidade: null },
            { tipo: 'carrinho_adicionar', id_usuario: cliente.usuario.id_usuario, sessao: null, quantidade: 3 }
        ]);
        const [colunas] = await sequelize.query("SELECT COLUMN_NAME AS nome FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'eventos'");
        assert.ok(!colunas.some((c) => /(^|_)ip($|_)/i.test(c.nome)));
    });

    test('recusa tipos registrados pelo servidor, campos faltando ou a mais', async () => {
        for (const tipo of ['busca', 'busca_sem_resultado', 'pedido_concluido', 'inventado']) {
            const resposta = await enviar({ tipo }).expect(422);
            assert.equal(resposta.body.detalhes[0].campo, 'tipo');
        }
        await enviar({ tipo: 'produto_visto' }).expect(422);
        await enviar({ tipo: 'produto_visto', id_produto: -1 }).expect(422);
        await enviar({ tipo: 'checkout_iniciado', id_produto: 1 }).expect(422);
        await enviar({ tipo: 'checkout_iniciado', sessao: 'x' }).expect(422);
    });
});

describe('eventos registrados pelo servidor', () => {
    test('busca na vitrine (só a 1ª página, não para a equipe) e busca sem resultado', async () => {
        await request(app).get('/api/v1/produtos?busca=SABONETE').expect(200);
        await request(app).get('/api/v1/produtos?busca=sabonete&pagina=2').expect(200);
        await request(app).get('/api/v1/produtos?busca=sabonete').set('Authorization', cliente.auth).expect(200);
        await request(app).get('/api/v1/produtos?busca=sabonete').set('Authorization', equipe.auth).expect(200);
        await request(app).get('/api/v1/produtos?busca=perfume importado').expect(200);
        await request(app).get('/api/v1/produtos').expect(200);

        const [linhas] = await sequelize.query("SELECT tipo, termo, resultados, id_usuario FROM eventos WHERE tipo LIKE 'busca%' ORDER BY id_evento");
        assert.deepEqual(linhas, [
            { tipo: 'busca', termo: 'sabonete', resultados: 1, id_usuario: null },
            { tipo: 'busca', termo: 'sabonete', resultados: 1, id_usuario: cliente.usuario.id_usuario },
            { tipo: 'busca_sem_resultado', termo: 'perfume importado', resultados: 0, id_usuario: null }
        ]);
    });

    test('pedido concluído é registrado no checkout', async () => {
        const { body } = await request(app).post('/api/v1/pedidos').set('Authorization', cliente.auth)
            .send({ itens: [{ id_produto: produtos['M-1'], quantidade: 4 }, { id_produto: produtos['M-2'], quantidade: 1 }] }).expect(201);
        const [[evento]] = await sequelize.query("SELECT id_pedido, id_usuario FROM eventos WHERE tipo = 'pedido_concluido'");
        assert.deepEqual(evento, { id_pedido: body.pedido.id_pedido, id_usuario: cliente.usuario.id_usuario });
    });
});

describe('métricas (equipe)', () => {
    test('resumo do período', async () => {
        const { body } = await metrica('resumo').expect(200);
        assert.match(body.periodo.de, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(body.pedidos.total, 1);
        assert.equal(body.pedidos.por_status['Aguardando Separação'], 1);
        assert.equal(body.unidades_pedidas, 5);
        assert.equal(body.clientes_que_compraram, 1);
        assert.deepEqual(
            { busca: body.eventos.busca, sem: body.eventos.busca_sem_resultado, visto: body.eventos.produto_visto, concluido: body.eventos.pedido_concluido },
            { busca: 2, sem: 1, visto: 1, concluido: 1 }
        );
        const futuro = await metrica('resumo?de=2030-01-01&ate=2030-01-31').expect(200);
        assert.equal(futuro.body.pedidos.total, 0);
    });

    test('buscas mais feitas e sem resultado', async () => {
        const { body } = await metrica('buscas').expect(200);
        assert.deepEqual(body.mais_buscadas, [
            { termo: 'sabonete', total: 2, sem_resultado: 0 },
            { termo: 'perfume importado', total: 1, sem_resultado: 1 }
        ]);
        assert.deepEqual(body.sem_resultado.map((b) => [b.termo, b.total]), [['perfume importado', 1]]);
    });

    test('produtos mais pedidos em unidades, sem cancelados', async () => {
        const { body } = await metrica('produtos-mais-pedidos').expect(200);
        assert.deepEqual(body.produtos.map((p) => [p.sku, p.unidades, p.pedidos]), [['M-1', 4, 1], ['M-2', 1, 1]]);
    });

    test('clientes inativos: quem não compra há X dias, inclusive quem nunca comprou', async () => {
        const { body } = await metrica('clientes-inativos?dias=30').expect(200);
        assert.deepEqual(body.clientes.map((c) => c.nome_exibicao), ['Sumido LTDA']);
        assert.equal(body.clientes[0].ultimo_pedido_em, null);
        assert.equal(body.clientes[0].total_pedidos, 0);
        assert.deepEqual(body.paginacao, { total: 1, pagina: 1, limite: 20, total_paginas: 1 });

        // Um pedido de 90 dias atrás deixa o comprador inativo para "dias=30" e ativo para "dias=120".
        await sequelize.query("UPDATE pedidos SET data_pedido = NOW() - INTERVAL 90 DAY WHERE id_cliente = ?",
            { replacements: [cliente.usuario.id_usuario] });
        const trinta = await metrica('clientes-inativos?dias=30').expect(200);
        assert.equal(trinta.body.paginacao.total, 2);
        assert.equal(trinta.body.clientes[1].nome_exibicao, 'Cliente Comprador');
        const cento = await metrica('clientes-inativos?dias=120').expect(200);
        assert.equal(cento.body.paginacao.total, 1);
    });

    test('valida parâmetros e exige equipe', async () => {
        await metrica('resumo?de=01/10/2026').expect(400);
        await metrica('resumo?de=2026-10-10&ate=2026-10-01').expect(400);
        await metrica('resumo?de=2024-01-01&ate=2026-01-01').expect(400);
        await metrica('buscas?limite=500').expect(400);
        await metrica('clientes-inativos?dias=0').expect(400);
        await request(app).get('/api/v1/metricas/resumo').set('Authorization', cliente.auth).expect(403);
        await request(app).get('/api/v1/metricas/resumo').expect(401);
    });
});

describe('limpeza de eventos antigos', () => {
    test('apaga só eventos com mais de 12 meses', async () => {
        const { limparEventosAntigos } = require('../servicos/eventos');
        const antes = await Evento.count();
        await sequelize.query("INSERT INTO eventos (tipo, criado_em) VALUES ('checkout_iniciado', NOW() - INTERVAL 13 MONTH), ('checkout_iniciado', NOW() - INTERVAL 13 MONTH), ('checkout_iniciado', NOW() - INTERVAL 11 MONTH)");
        const resultado = await limparEventosAntigos({ tamanhoLote: 1 });
        assert.equal(resultado.removidos, 2);
        assert.equal(await Evento.count(), antes + 1);
    });
});
