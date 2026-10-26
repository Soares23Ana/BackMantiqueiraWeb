const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { config, prepararApp, criarUsuario } = require('./ajuda');
const { aplicarMigracoes, abrirConexao } = require('../db/migracoes');
const { validarAmbiente } = require('../config/ambiente');

let app;
let sequelize;

before(async () => {
    ({ app, sequelize } = await prepararApp());
});

after(async () => {
    await sequelize.close();
});

describe('variáveis de ambiente', () => {
    const base = { JWT_SECRET: 'x'.repeat(40) };

    test('aceita a configuração mínima de desenvolvimento', () => {
        assert.deepEqual(validarAmbiente(base).erros, []);
    });

    test('recusa JWT_SECRET curto ou de exemplo', () => {
        assert.match(validarAmbiente({ JWT_SECRET: 'curto' }).erros[0], /32 caracteres/);
        const exemplo = validarAmbiente({ JWT_SECRET: 'troque_por_uma_chave_longa_e_aleatoria' });
        assert.match(exemplo.erros[0], /valor de exemplo/);
    });

    test('exige credenciais do banco em produção', () => {
        const { erros } = validarAmbiente({ ...base, NODE_ENV: 'production' });
        assert.equal(erros.length, 4);
    });

    test('recusa origem de CORS inválida', () => {
        const { erros } = validarAmbiente({ ...base, CORS_ORIGINS: 'http://ok.com,nao-e-url' });
        assert.deepEqual(erros, ['CORS_ORIGINS contém uma origem inválida: nao-e-url']);
    });

    test('nos testes só aceita banco com sufixo _test', () => {
        const { erros } = validarAmbiente({ ...base, NODE_ENV: 'test', DB_NAME_TEST: 'mantiqueira_db' });
        assert.match(erros[0], /_test/);
    });
});

describe('migrations', () => {
    test('rodar de novo não aplica nada (idempotente)', async () => {
        const { aplicadas } = await aplicarMigracoes({ nomeBanco: config.db.nome });
        assert.deepEqual(aplicadas, []);
    });

    test('registra todas as migrations em schema_migrations', async () => {
        const [linhas] = await sequelize.query('SELECT versao FROM schema_migrations ORDER BY versao');
        assert.deepEqual(linhas.map((l) => l.versao).slice(0, 2), ['001', '002']);
    });

    test('a 002 converte um banco legado (status antigos, índices duplicados, FK em cascata)', async () => {
        const nome = 'mantiqueira_legado_test';
        const conexao = await abrirConexao();
        try {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await conexao.query(`CREATE DATABASE \`${nome}\``);
            await conexao.query(`USE \`${nome}\``);
            // Estrutura parecida com a criada pelo sequelize.sync antigo.
            await conexao.query(`
                CREATE TABLE usuarios (
                    id_usuario INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(100) NOT NULL,
                    email VARCHAR(100) NOT NULL, senha VARCHAR(255) NOT NULL, cnpj_cpf VARCHAR(18),
                    telefone VARCHAR(20), tipo ENUM('cliente','funcionario','gerente','admin') DEFAULT 'cliente',
                    cargo VARCHAR(50), criado_em DATETIME NOT NULL,
                    UNIQUE KEY email (email), UNIQUE KEY email_2 (email), UNIQUE KEY email_3 (email));
                CREATE TABLE fornecedores (id_fornecedor INT AUTO_INCREMENT PRIMARY KEY,
                    nome_fantasia VARCHAR(100) NOT NULL, cnpj VARCHAR(18) NOT NULL, email VARCHAR(100),
                    UNIQUE KEY cnpj (cnpj), UNIQUE KEY cnpj_2 (cnpj));
                CREATE TABLE produtos (id_produto INT AUTO_INCREMENT PRIMARY KEY, id_fornecedor INT,
                    nome VARCHAR(100) NOT NULL, descricao TEXT, preco DECIMAL(10,2) NOT NULL,
                    quantidade_estoque INT DEFAULT 0, criado_em DATETIME NOT NULL);
                CREATE TABLE pedidos (id_pedido INT AUTO_INCREMENT PRIMARY KEY, id_cliente INT NOT NULL,
                    id_funcionario INT, data_pedido DATETIME NOT NULL,
                    status ENUM('Pendente','Separacao_Estoque','Em_Rota_Mantiqueira','Entregue','Cancelado') DEFAULT 'Pendente',
                    CONSTRAINT pedidos_ibfk_1 FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario) ON DELETE CASCADE);
                CREATE TABLE itens_pedido (id_pedido INT NOT NULL, id_produto INT NOT NULL, quantidade INT NOT NULL,
                    preco_unitario DECIMAL(10,2) NOT NULL, PRIMARY KEY (id_pedido, id_produto));
                INSERT INTO usuarios (nome, email, senha, criado_em) VALUES ('Cliente', 'c@x.com', 'h', NOW());
                INSERT INTO pedidos (id_cliente, data_pedido, status) VALUES (1, NOW(), 'Pendente'), (1, NOW(), 'Em_Rota_Mantiqueira');
            `);

            await aplicarMigracoes({ nomeBanco: nome });

            const [status] = await conexao.query('SELECT status FROM pedidos ORDER BY id_pedido');
            assert.deepEqual(status.map((s) => s.status), ['Aguardando Separação', 'Saiu para Entrega']);

            const [indices] = await conexao.query(
                "SELECT DISTINCT INDEX_NAME AS nome FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'email'",
                [nome]
            );
            assert.deepEqual(indices.map((i) => i.nome), ['email']);

            const [colunas] = await conexao.query(
                "SELECT COLUMN_NAME AS nome FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios' AND COLUMN_NAME IN ('cnpj', 'cnpj_cpf', 'razao_social') ORDER BY COLUMN_NAME",
                [nome]
            );
            assert.deepEqual(colunas.map((c) => c.nome), ['cnpj', 'razao_social']);

            const [[fk]] = await conexao.query(
                "SELECT DELETE_RULE AS regra FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'pedidos'",
                [nome]
            );
            assert.notEqual(fk.regra, 'CASCADE');

            // Os valores padrão permitem INSERT sem informar datas.
            await conexao.query("INSERT INTO usuarios (nome, email, senha) VALUES ('Outro', 'o@x.com', 'h')");
        } finally {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await conexao.end();
        }
    });
});

describe('HTTP', () => {
    test('GET /saude informa banco, uptime e versão', async () => {
        const resposta = await request(app).get('/saude').expect(200);
        assert.equal(resposta.body.status, 'ok');
        assert.equal(resposta.body.banco, 'conectado');
        assert.equal(typeof resposta.body.uptime_segundos, 'number');
        assert.ok(resposta.body.versao);
        assert.ok('ultima_sincronizacao' in resposta.body);
    });

    test('a API fica em /api/v1 e rotas sem versão respondem 404 padronizado', async () => {
        await request(app).get('/api/v1/cms').expect(200);
        const resposta = await request(app).get('/cms').expect(404);
        assert.deepEqual(resposta.body, {
            sucesso: false,
            mensagem: 'Rota não encontrada.',
            codigo: 'ROTA_NAO_ENCONTRADA'
        });
    });

    test('erros dos controladores ganham sucesso:false e codigo', async () => {
        // O controlador de pedidos ainda responde só { mensagem } em erros de parâmetro.
        const { auth } = await criarUsuario('gerente');
        const resposta = await request(app)
            .get('/api/v1/pedidos/abc')
            .set('Authorization', auth)
            .expect(400);
        assert.deepEqual(resposta.body, {
            sucesso: false,
            mensagem: 'Identificador de pedido inválido.',
            codigo: 'REQUISICAO_INVALIDA'
        });
    });

    test('token ausente devolve 401 padronizado', async () => {
        const resposta = await request(app).get('/api/v1/auth/me').expect(401);
        assert.equal(resposta.body.codigo, 'NAO_AUTENTICADO');
        assert.equal(resposta.body.sucesso, false);
    });

    test('JSON malformado devolve 400 JSON_INVALIDO', async () => {
        const resposta = await request(app)
            .post('/api/v1/auth/login')
            .set('Content-Type', 'application/json')
            .send('{"email":')
            .expect(400);
        assert.equal(resposta.body.codigo, 'JSON_INVALIDO');
    });

    test('corpo acima do limite devolve 413', async () => {
        const resposta = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'a'.repeat(300 * 1024) })
            .expect(413);
        assert.equal(resposta.body.codigo, 'CORPO_MUITO_GRANDE');
    });

    test('gera X-Request-Id ou reaproveita o recebido', async () => {
        const gerado = await request(app).get('/saude');
        assert.match(gerado.headers['x-request-id'], /^[0-9a-f-]{36}$/);
        const recebido = await request(app).get('/saude').set('X-Request-Id', 'meu-id-123456');
        assert.equal(recebido.headers['x-request-id'], 'meu-id-123456');
        const invalido = await request(app).get('/saude').set('X-Request-Id', 'x y<script>');
        assert.notEqual(invalido.headers['x-request-id'], 'x y<script>');
    });

    test('helmet ativo e imagens liberadas para o front em outra origem', async () => {
        const resposta = await request(app).get('/saude');
        assert.equal(resposta.headers['x-content-type-options'], 'nosniff');
        assert.equal(resposta.headers['cross-origin-resource-policy'], 'cross-origin');
        assert.equal(resposta.headers['x-powered-by'], undefined);
    });

    test('erro 500 não expõe a mensagem interna', async () => {
        const { tratarErros } = require('../middlewares/seguranca');
        const { padronizarErros } = require('../middlewares/requisicao');
        const express = require('express');
        const appErro = express();
        appErro.use(padronizarErros);
        appErro.get('/falha', () => {
            throw new Error("ER_BAD_FIELD_ERROR: Unknown column 'x' in 'field list'");
        });
        appErro.use(tratarErros);
        const resposta = await request(appErro).get('/falha').expect(500);
        assert.deepEqual(resposta.body, {
            sucesso: false,
            mensagem: 'Erro interno no servidor.',
            codigo: 'ERRO_INTERNO'
        });
    });
});
