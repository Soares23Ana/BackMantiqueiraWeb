const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');
const { aplicarMigracoes, abrirConexao } = require('../db/migracoes');

let app;
let sequelize;
let Pedido;
let cliente;
let outroCliente;
let equipeA;
let equipeB;

const novoPedido = (idCliente = cliente.usuario.id_usuario) => Pedido.create({ id_cliente: idCliente });
const abrir = (auth, id) => request(app).get(`/api/v1/pedidos/${id}`).set('Authorization', auth);
const listar = (auth, consulta = '') => request(app).get(`/api/v1/pedidos${consulta}`).set('Authorization', auth);
const contadores = async () =>
    (await request(app).get('/api/v1/painel/contadores').set('Authorization', equipeA.auth).expect(200)).body;
const recarregar = (id) => Pedido.findByPk(id);

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Pedido } = require('../models'));
    cliente = await criarUsuario('cliente');
    outroCliente = await criarUsuario('cliente');
    equipeA = await criarUsuario('equipe');
    equipeB = await criarUsuario('equipe');
});

after(async () => {
    await sequelize.close();
});

describe('migration 027: pedidos já existentes viram vistos', () => {
    test('marca todos como vistos (sem autor), cria índice e a exclusão de usuário não é barrada', async () => {
        const nome = 'mantiqueira_visto_test';
        const conexao = await abrirConexao();
        try {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await aplicarMigracoes({ nomeBanco: nome, ateVersao: '026' });
            await conexao.query(`USE \`${nome}\``);
            await conexao.query(`
                INSERT INTO usuarios (id_usuario, nome, email, senha, tipo) VALUES (1, 'Cliente', 'c@x.com', 'h', 'cliente');
                INSERT INTO pedidos (id_cliente, data_pedido) VALUES (1, NOW()), (1, NOW())
            `);
            await aplicarMigracoes({ nomeBanco: nome });
            const [linhas] = await conexao.query('SELECT visto_em IS NOT NULL AS visto, visto_por FROM pedidos ORDER BY id_pedido');
            assert.deepEqual(linhas, [{ visto: 1, visto_por: null }, { visto: 1, visto_por: null }]);

            // Rodar de novo não faz nada; pedido novo nasce não visto.
            const { aplicadas } = await aplicarMigracoes({ nomeBanco: nome });
            assert.deepEqual(aplicadas, []);
            await conexao.query('INSERT INTO pedidos (id_cliente, data_pedido) VALUES (1, NOW())');
            const [[novo]] = await conexao.query('SELECT visto_em FROM pedidos ORDER BY id_pedido DESC LIMIT 1');
            assert.equal(novo.visto_em, null);

            const [indices] = await conexao.query(
                "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'pedidos' AND INDEX_NAME = 'idx_pedidos_visto_em'",
                [nome]
            );
            assert.equal(indices.length, 1);

            await conexao.query("INSERT INTO usuarios (id_usuario, nome, email, senha, tipo) VALUES (2, 'Eq', 'e@x.com', 'h', 'equipe')");
            await conexao.query('UPDATE pedidos SET visto_em = NOW(), visto_por = 2 WHERE visto_em IS NULL');
            await conexao.query('DELETE FROM usuarios WHERE id_usuario = 2');
            const [[apos]] = await conexao.query('SELECT visto_por FROM pedidos ORDER BY id_pedido DESC LIMIT 1');
            assert.equal(apos.visto_por, null);
        } finally {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await conexao.end();
        }
    });
});

describe('visto compartilhado da equipe', () => {
    test('a listagem não marca nada e traz visto=false e visto_em=null', async () => {
        const pedido = await novoPedido();
        const resposta = await listar(equipeA.auth, `?id_cliente=${cliente.usuario.id_usuario}`).expect(200);
        const item = resposta.body.pedidos.find((p) => p.id_pedido === pedido.id_pedido);
        assert.equal(item.visto, false);
        assert.equal(item.visto_em, null);
        assert.equal((await recarregar(pedido.id_pedido)).visto_em, null);
    });

    test('equipe abrindo marca como visto e o detalhe já traz visto=true', async () => {
        const pedido = await novoPedido();
        const resposta = await abrir(equipeA.auth, pedido.id_pedido).expect(200);
        assert.equal(resposta.body.pedido.visto, true);
        assert.match(resposta.body.pedido.visto_em, /^\d{4}-\d{2}-\d{2}T/);
        const gravado = await recarregar(pedido.id_pedido);
        assert.equal(gravado.visto_por, equipeA.usuario.id_usuario);
        assert.notEqual(gravado.visto_em, null);
    });

    test('cliente abrindo o próprio pedido não marca e não recebe os campos de visto', async () => {
        const pedido = await novoPedido();
        const resposta = await abrir(cliente.auth, pedido.id_pedido).expect(200);
        assert.equal('visto' in resposta.body.pedido, false);
        assert.equal('visto_em' in resposta.body.pedido, false);
        assert.equal('visto_por' in resposta.body.pedido, false);
        assert.equal((await recarregar(pedido.id_pedido)).visto_em, null);

        const meus = await request(app).get('/api/v1/pedidos/meus').set('Authorization', cliente.auth).expect(200);
        assert.ok(meus.body.pedidos.length > 0);
        for (const item of meus.body.pedidos) {
            assert.equal('visto' in item, false);
            assert.equal('visto_em' in item, false);
        }
        // Pedido de outro cliente continua 404 e também não marca.
        await abrir(outroCliente.auth, pedido.id_pedido).expect(404);
        assert.equal((await recarregar(pedido.id_pedido)).visto_em, null);
    });

    test('o segundo acesso (de outra pessoa da equipe) não troca visto_por nem visto_em', async () => {
        const pedido = await novoPedido();
        await abrir(equipeA.auth, pedido.id_pedido).expect(200);
        const primeiro = await recarregar(pedido.id_pedido);
        const resposta = await abrir(equipeB.auth, pedido.id_pedido).expect(200);
        const segundo = await recarregar(pedido.id_pedido);
        assert.equal(segundo.visto_por, equipeA.usuario.id_usuario);
        assert.equal(segundo.visto_em.getTime(), primeiro.visto_em.getTime());
        assert.equal(resposta.body.pedido.visto, true);
    });

    test('acessos simultâneos: só o primeiro marca e o resultado não muda depois', async () => {
        const pedido = await novoPedido();
        await Promise.all([abrir(equipeA.auth, pedido.id_pedido), abrir(equipeB.auth, pedido.id_pedido)]);
        const gravado = await recarregar(pedido.id_pedido);
        assert.ok([equipeA.usuario.id_usuario, equipeB.usuario.id_usuario].includes(gravado.visto_por));
        await abrir(equipeA.auth, pedido.id_pedido).expect(200);
        await abrir(equipeB.auth, pedido.id_pedido).expect(200);
        const depois = await recarregar(pedido.id_pedido);
        assert.equal(depois.visto_por, gravado.visto_por);
        assert.equal(depois.visto_em.getTime(), gravado.visto_em.getTime());
    });

    test('abrir o pedido não altera atualizado_em', async () => {
        const pedido = await novoPedido();
        const antes = (await recarregar(pedido.id_pedido)).atualizado_em.getTime();
        await abrir(equipeA.auth, pedido.id_pedido).expect(200);
        assert.equal((await recarregar(pedido.id_pedido)).atualizado_em.getTime(), antes);
    });

    test('mudar o status sem abrir marca como visto; quem viu primeiro continua sendo o autor', async () => {
        const pedido = await novoPedido();
        await request(app).put(`/api/v1/pedidos/${pedido.id_pedido}/status`).set('Authorization', equipeB.auth)
            .send({ status: 'Em Separação' }).expect(200);
        const gravado = await recarregar(pedido.id_pedido);
        assert.equal(gravado.visto_por, equipeB.usuario.id_usuario);
        assert.notEqual(gravado.visto_em, null);

        await request(app).put(`/api/v1/pedidos/${pedido.id_pedido}/status`).set('Authorization', equipeA.auth)
            .send({ status: 'Saiu para Entrega' }).expect(200);
        assert.equal((await recarregar(pedido.id_pedido)).visto_por, equipeB.usuario.id_usuario);
    });

    test('a equipe cancelando marca como visto; o cliente cancelando não', async () => {
        const daEquipe = await novoPedido();
        await request(app).post(`/api/v1/pedidos/${daEquipe.id_pedido}/cancelar`).set('Authorization', equipeA.auth)
            .send({ motivo: 'Sem estoque' }).expect(200);
        assert.equal((await recarregar(daEquipe.id_pedido)).visto_por, equipeA.usuario.id_usuario);

        const doCliente = await novoPedido();
        await request(app).post(`/api/v1/pedidos/${doCliente.id_pedido}/cancelar`).set('Authorization', cliente.auth)
            .send({ motivo: 'Desisti' }).expect(200);
        assert.equal((await recarregar(doCliente.id_pedido)).visto_em, null);
    });

    test('filtro ?visto=false lista só os não vistos, ?visto=true só os vistos e valor inválido dá 400', async () => {
        const dono = await criarUsuario('cliente');
        const naoVisto = await novoPedido(dono.usuario.id_usuario);
        const visto = await novoPedido(dono.usuario.id_usuario);
        await abrir(equipeA.auth, visto.id_pedido).expect(200);
        const base = `?id_cliente=${dono.usuario.id_usuario}`;

        const novos = await listar(equipeA.auth, `${base}&visto=false`).expect(200);
        assert.deepEqual(novos.body.pedidos.map((p) => p.id_pedido), [naoVisto.id_pedido]);
        assert.equal(novos.body.paginacao.total, 1);
        const vistos = await listar(equipeA.auth, `${base}&visto=true`).expect(200);
        assert.deepEqual(vistos.body.pedidos.map((p) => p.id_pedido), [visto.id_pedido]);
        const todos = await listar(equipeA.auth, base).expect(200);
        assert.equal(todos.body.pedidos.length, 2);

        const invalido = await listar(equipeA.auth, `${base}&visto=talvez`).expect(400);
        assert.equal(invalido.body.codigo, 'FILTRO_INVALIDO');
    });

    test('pedidos_novos sobe com pedido novo e cai ao abrir; pedidos_pendentes segue independente', async () => {
        const antes = await contadores();
        const pedido = await novoPedido();
        const subiu = await contadores();
        assert.equal(subiu.pedidos_novos, antes.pedidos_novos + 1);
        assert.equal(subiu.pedidos_pendentes, antes.pedidos_pendentes + 1);

        await abrir(equipeA.auth, pedido.id_pedido).expect(200);
        const caiu = await contadores();
        assert.equal(caiu.pedidos_novos, antes.pedidos_novos);
        // Abrir não muda o status: continua pendente.
        assert.equal(caiu.pedidos_pendentes, antes.pedidos_pendentes + 1);
        assert.equal(typeof caiu.estoque_baixo, 'number');
    });
});
