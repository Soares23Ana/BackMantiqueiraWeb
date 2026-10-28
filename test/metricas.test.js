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

describe('métricas de funil, vistos, cliques, pedidos por dia e ciclo (equipe)', () => {
    // Período de 5 dias há uns 2 meses: longe dos eventos dos outros testes e dentro dos 12 meses guardados.
    const D = Array.from({ length: 31 }, (_, i) =>
        new Date(Date.now() - 3 * 3600 * 1000 - (65 - i) * 24 * 3600 * 1000).toISOString().slice(0, 10));
    const PERIODO = `de=${D[1]}&ate=${D[5]}`;
    let banner;
    let campanha;

    const evento = (tipo, criadoEm, campos = {}) => Evento.create({ tipo, criado_em: criadoEm, ...campos });

    before(async () => {
        const { Banner, Campanha, Pedido } = require('../models');
        banner = await Banner.create({ titulo: 'Banner do teste', imagem_url: '/img/banner-1.webp', ordem: 1 });
        campanha = await Campanha.create({ titulo: 'Campanha do teste', inicio_em: `${D[1]} 00:00:00`, fim_em: `${D[30]} 23:59:59` });
        const u = cliente.usuario.id_usuario;
        const dia = `${D[2]} 10:00:00`;

        // Funil: 4 sessões viram o produto (uma delas duas vezes), 2 adicionaram, 2 abriram o checkout, 1 concluiu.
        await evento('produto_visto', dia, { id_produto: produtos['M-1'], sessao: 'visitante-aaaa' });
        await evento('produto_visto', dia, { id_produto: produtos['M-1'], sessao: 'visitante-aaaa' });
        await evento('produto_visto', dia, { id_produto: produtos['M-1'], sessao: 'visitante-bbbb' });
        await evento('produto_visto', dia, { id_produto: produtos['M-2'], sessao: 'visitante-cccc' });
        await evento('produto_visto', dia, { id_produto: produtos['M-2'], id_usuario: u });
        // Sem usuário nem sessão: conta como visualização, mas não como sessão.
        await evento('produto_visto', dia, { id_produto: produtos['M-2'] });
        await evento('carrinho_adicionar', dia, { id_produto: produtos['M-1'], sessao: 'visitante-aaaa' });
        await evento('carrinho_adicionar', dia, { id_produto: produtos['M-2'], id_usuario: u });
        await evento('checkout_iniciado', dia, { sessao: 'visitante-aaaa' });
        await evento('checkout_iniciado', dia, { id_usuario: u });
        await evento('pedido_concluido', dia, { id_usuario: u, id_pedido: 1 });
        // Fora do período: não entra.
        await evento('produto_visto', `${D[0]} 10:00:00`, { id_produto: produtos['M-1'], sessao: 'visitante-zzzz' });

        await evento('banner_clique', dia, { id_banner: banner.id_banner, sessao: 'visitante-aaaa' });
        await evento('banner_clique', dia, { id_banner: banner.id_banner, sessao: 'visitante-aaaa' });
        await evento('banner_clique', dia, { id_banner: banner.id_banner, sessao: 'visitante-bbbb' });
        await evento('campanha_clique', dia, { id_campanha: campanha.id_campanha, id_usuario: u });

        // Pedidos: dois no dia 2 (um cancelado), um no dia 4 que percorreu o fluxo inteiro.
        const pedido = (data, status) => Pedido.create({ id_cliente: u, data_pedido: data, status });
        const completo = await pedido(`${D[4]} 08:00:00`, 'Entregue');
        const separado = await pedido(`${D[2]} 09:00:00`, 'Em Separação');
        await pedido(`${D[2]} 11:00:00`, 'Cancelado');
        const historico = (id, anterior, novo, quando) => sequelize.query(
            'INSERT INTO pedido_historico (id_pedido, status_anterior, status_novo, criado_em) VALUES (?, ?, ?, ?)',
            { replacements: [id, anterior, novo, quando] });
        await historico(completo.id_pedido, null, 'Aguardando Separação', `${D[4]} 08:00:00`);
        await historico(completo.id_pedido, 'Aguardando Separação', 'Em Separação', `${D[4]} 09:00:00`);
        await historico(completo.id_pedido, 'Em Separação', 'Saiu para Entrega', `${D[4]} 09:30:00`);
        await historico(completo.id_pedido, 'Saiu para Entrega', 'Entregue', `${D[4]} 13:30:00`);
        await historico(separado.id_pedido, null, 'Aguardando Separação', `${D[2]} 09:00:00`);
        await historico(separado.id_pedido, 'Aguardando Separação', 'Em Separação', `${D[2]} 12:00:00`);
    });

    test('funil: sessões distintas por etapa e taxa entre etapas', async () => {
        const { body } = await metrica(`funil?${PERIODO}`).expect(200);
        assert.deepEqual(body.periodo, { de: D[1], ate: D[5] });
        assert.deepEqual(body.etapas, [
            { etapa: 'produto_visto', sessoes: 4, taxa_da_anterior: null },
            { etapa: 'carrinho_adicionar', sessoes: 2, taxa_da_anterior: 0.5 },
            { etapa: 'checkout_iniciado', sessoes: 2, taxa_da_anterior: 1 },
            { etapa: 'pedido_concluido', sessoes: 1, taxa_da_anterior: 0.5 }
        ]);
        const vazio = await metrica('funil?de=2030-01-01&ate=2030-01-02').expect(200);
        assert.ok(vazio.body.etapas.every((e) => e.sessoes === 0 && (e.taxa_da_anterior === null)));
    });

    test('produtos vistos: visualizações e sessões', async () => {
        const { body } = await metrica(`produtos-vistos?${PERIODO}`).expect(200);
        assert.deepEqual(body.produtos.map((p) => [p.sku, p.visualizacoes, p.sessoes]), [['M-1', 3, 2], ['M-2', 3, 2]]);
        const um = await metrica(`produtos-vistos?${PERIODO}&limite=1`).expect(200);
        assert.equal(um.body.produtos.length, 1);
    });

    test('cliques por banner e por campanha', async () => {
        const { body } = await metrica(`banners-campanhas?${PERIODO}`).expect(200);
        assert.deepEqual(body.banners, [{ id_banner: banner.id_banner, titulo: 'Banner do teste', cliques: 3, sessoes: 2 }]);
        assert.deepEqual(body.campanhas, [{ id_campanha: campanha.id_campanha, titulo: 'Campanha do teste', cliques: 1, sessoes: 1 }]);
    });

    test('pedidos por dia, com os dias sem pedido zerados', async () => {
        const { body } = await metrica(`pedidos-por-dia?${PERIODO}`).expect(200);
        assert.deepEqual(body.dias, [
            { data: D[1], total: 0, cancelados: 0 },
            { data: D[2], total: 2, cancelados: 1 },
            { data: D[3], total: 0, cancelados: 0 },
            { data: D[4], total: 1, cancelados: 0 },
            { data: D[5], total: 0, cancelados: 0 }
        ]);
    });

    test('ciclo do pedido: tempo médio entre etapas pelo histórico', async () => {
        const { body } = await metrica(`ciclo-pedido?${PERIODO}`).expect(200);
        assert.deepEqual(body.etapas, [
            // (60 + 180) / 2 minutos
            { de: 'Aguardando Separação', para: 'Em Separação', pedidos: 2, media_minutos: 120 },
            { de: 'Em Separação', para: 'Saiu para Entrega', pedidos: 1, media_minutos: 30 },
            { de: 'Saiu para Entrega', para: 'Entregue', pedidos: 1, media_minutos: 240 }
        ]);
    });

    test('nenhum valor financeiro, validação de período e só equipe', async () => {
        for (const rota of ['funil', 'produtos-vistos', 'banners-campanhas', 'pedidos-por-dia', 'ciclo-pedido']) {
            const { body } = await metrica(`${rota}?${PERIODO}`).expect(200);
            assert.doesNotMatch(JSON.stringify(body), /preco|valor|total_pedido|desconto/);
            await metrica(`${rota}?de=${D[9]}&ate=${D[1]}`).expect(400);
            await request(app).get(`/api/v1/metricas/${rota}`).set('Authorization', cliente.auth).expect(403);
            await request(app).get(`/api/v1/metricas/${rota}`).expect(401);
        }
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
