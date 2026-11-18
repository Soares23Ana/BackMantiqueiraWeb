const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;

const MENSAGEM = 'Pedido recebido. Se o CNPJ estiver cadastrado, a equipe vai entrar em contato em breve.';

// CNPJs válidos e únicos (14 dígitos com os dígitos verificadores corretos).
let contadorCnpj = 0;
function cnpjNovo() {
    contadorCnpj += 1;
    const digitos = `7${String(contadorCnpj).padStart(7, '0')}0001`.split('').map(Number);
    const calcular = (d) => {
        const pesos = d.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const resto = d.reduce((soma, n, i) => soma + n * pesos[i], 0) % 11;
        return resto < 2 ? 0 : 11 - resto;
    };
    digitos.push(calcular(digitos));
    digitos.push(calcular(digitos));
    return digitos.join('');
}

const novoCliente = (dados = {}) => criarUsuario('cliente', { cnpj: cnpjNovo(), razao_social: 'Mercadinho Teste LTDA', telefone: '19999990000', ...dados });
const pendentes = () => request(app).get('/api/v1/clientes/redefinicoes-pendentes').set('Authorization', equipe.auth);
const contador = async () => (await request(app).get('/api/v1/painel/contadores').set('Authorization', equipe.auth).expect(200)).body.redefinicoes_pendentes;
const solicitar = (cnpj) => request(app).post('/api/v1/auth/solicitar-redefinicao').send({ cnpj });
const total = async (idUsuario) => {
    const { SolicitacaoRedefinicao } = require('../models');
    return SolicitacaoRedefinicao.count({ where: { id_usuario: idUsuario } });
};

before(async () => {
    ({ app, sequelize } = await prepararApp());
    equipe = await criarUsuario('equipe');
});

after(async () => {
    await sequelize.close();
});

describe('POST /auth/solicitar-redefinicao (público)', () => {
    test('CNPJ de cliente ativo: responde a mensagem padrão e cria um pedido pendente', async () => {
        const cliente = await novoCliente();
        const resposta = await solicitar(cliente.usuario.cnpj).expect(200);
        assert.equal(resposta.body.mensagem, MENSAGEM);
        assert.equal(await total(cliente.usuario.id_usuario), 1);
    });

    test('aceita o CNPJ com pontuação', async () => {
        const cliente = await novoCliente();
        const c = cliente.usuario.cnpj;
        const formatado = `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
        await solicitar(formatado).expect(200);
        assert.equal(await total(cliente.usuario.id_usuario), 1);
    });

    test('responde igual para CNPJ inexistente, inválido, de cliente inativo e de equipe (não revela quem existe)', async () => {
        const { SolicitacaoRedefinicao } = require('../models');
        const antes = await SolicitacaoRedefinicao.count();
        const inativo = await novoCliente({ ativo: false });
        const respostas = [];
        for (const cnpj of [cnpjNovo(), '123', 'abc', inativo.usuario.cnpj]) {
            respostas.push((await solicitar(cnpj).expect(200)).body);
        }
        assert.ok(respostas.every((corpo) => corpo.mensagem === MENSAGEM));
        assert.equal(await SolicitacaoRedefinicao.count(), antes);
    });

    test('pedidos repetidos não criam linhas novas enquanto houver um pendente', async () => {
        const cliente = await novoCliente();
        for (let i = 0; i < 3; i += 1) await solicitar(cliente.usuario.cnpj).expect(200);
        assert.equal(await total(cliente.usuario.id_usuario), 1);
    });

    test('valida o corpo: CNPJ ausente, vazio ou campo extra dão 422', async () => {
        await request(app).post('/api/v1/auth/solicitar-redefinicao').send({}).expect(422);
        await request(app).post('/api/v1/auth/solicitar-redefinicao').send({ cnpj: '   ' }).expect(422);
        const extra = await request(app).post('/api/v1/auth/solicitar-redefinicao').send({ cnpj: cnpjNovo(), senha: 'x' }).expect(422);
        assert.equal(extra.body.codigo, 'VALIDACAO');
    });
});

describe('GET /clientes/redefinicoes-pendentes e contador do menu', () => {
    test('só a equipe vê; o cliente e quem não entrou são recusados', async () => {
        const cliente = await novoCliente();
        await request(app).get('/api/v1/clientes/redefinicoes-pendentes').set('Authorization', cliente.auth).expect(403);
        await request(app).get('/api/v1/clientes/redefinicoes-pendentes').expect(401);
    });

    test('lista o pedido com os dados do cliente, do mais antigo para o mais novo, e o contador acompanha', async () => {
        await sequelize.query('DELETE FROM solicitacoes_redefinicao');
        const primeiro = await novoCliente({ razao_social: 'Primeiro LTDA' });
        const segundo = await novoCliente({ razao_social: 'Segundo LTDA' });
        await solicitar(primeiro.usuario.cnpj).expect(200);
        await solicitar(segundo.usuario.cnpj).expect(200);

        const { body } = await pendentes().expect(200);
        assert.equal(body.total, 2);
        assert.deepEqual(body.solicitacoes.map((s) => s.cliente.nome_exibicao), ['Primeiro LTDA', 'Segundo LTDA']);
        const item = body.solicitacoes[0];
        assert.equal(item.cliente.id_usuario, primeiro.usuario.id_usuario);
        assert.match(item.cliente.cnpj, /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
        assert.equal(item.cliente.telefone, '19999990000');
        assert.ok(item.solicitado_em);
        assert.equal(await contador(), 2);
    });
});

describe('o pedido é dado como atendido', () => {
    test('quando a equipe gera o link de redefinição', async () => {
        await sequelize.query('DELETE FROM solicitacoes_redefinicao');
        const cliente = await novoCliente();
        await solicitar(cliente.usuario.cnpj).expect(200);
        assert.equal(await contador(), 1);

        await request(app).post(`/api/v1/clientes/${cliente.usuario.id_usuario}/redefinicao-senha`).set('Authorization', equipe.auth).expect(201);
        assert.equal(await contador(), 0);
        assert.equal((await pendentes().expect(200)).body.total, 0);
        const { SolicitacaoRedefinicao } = require('../models');
        const pedido = await SolicitacaoRedefinicao.findOne({ where: { id_usuario: cliente.usuario.id_usuario } });
        assert.ok(pedido.atendido_em);
        assert.equal(pedido.atendido_por, equipe.usuario.id_usuario);
    });

    test('quando a equipe define uma senha temporária', async () => {
        await sequelize.query('DELETE FROM solicitacoes_redefinicao');
        const cliente = await novoCliente();
        await solicitar(cliente.usuario.cnpj).expect(200);
        await request(app).put(`/api/v1/clientes/${cliente.usuario.id_usuario}/senha`).set('Authorization', equipe.auth)
            .send({ senha: 'Temporaria@123' }).expect(200);
        assert.equal(await contador(), 0);
    });

    test('quando o cliente troca a senha com o link', async () => {
        await sequelize.query('DELETE FROM solicitacoes_redefinicao');
        const cliente = await novoCliente({ senha: await bcrypt.hash('Antiga@12345', 4) });
        await solicitar(cliente.usuario.cnpj).expect(200);
        const { body } = await request(app).post(`/api/v1/clientes/${cliente.usuario.id_usuario}/redefinicao-senha`).set('Authorization', equipe.auth).expect(201);
        // um novo pedido depois de atendido volta a aparecer
        await solicitar(cliente.usuario.cnpj).expect(200);
        assert.equal(await contador(), 1);
        await request(app).post('/api/v1/auth/redefinir-senha').send({ token: body.token, nova_senha: 'Nova@Senha123' }).expect(200);
        assert.equal(await contador(), 0);
    });

    test('depois de atendido, um novo pedido do mesmo cliente cria outro pendente', async () => {
        await sequelize.query('DELETE FROM solicitacoes_redefinicao');
        const cliente = await novoCliente();
        await solicitar(cliente.usuario.cnpj).expect(200);
        await request(app).post(`/api/v1/clientes/${cliente.usuario.id_usuario}/redefinicao-senha`).set('Authorization', equipe.auth).expect(201);
        await solicitar(cliente.usuario.cnpj).expect(200);
        assert.equal(await contador(), 1);
        assert.equal(await total(cliente.usuario.id_usuario), 2);
    });
});

describe('limitador do pedido de nova senha', () => {
    test('conta todos os pedidos por IP e responde 429 acima do limite', async () => {
        const { criarLimitadorSolicitacaoRedefinicao } = require('../middlewares/seguranca');
        const mini = express();
        mini.use(express.json());
        mini.post('/x', criarLimitadorSolicitacaoRedefinicao(3), (req, res) => res.status(200).json({ ok: true }));
        for (let i = 0; i < 3; i += 1) await request(mini).post('/x').send({}).expect(200);
        const barrado = await request(mini).post('/x').send({}).expect(429);
        assert.equal(barrado.body.codigo, 'MUITAS_TENTATIVAS');
    });
});
