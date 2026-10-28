// Limite de login mais alto neste arquivo para os testes não esbarrarem nele antes do teste específico.
process.env.LOGIN_LIMITE = '40';
process.env.CADASTRO_LIMITE = '100';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario, config } = require('./ajuda');
const { aplicarMigracoes, abrirConexao } = require('../db/migracoes');

let app;
let sequelize;
let admin;

const SENHA = 'Senha@Forte1';
const CNPJ_CLIENTE = '11.222.333/0001-81';
// Outros CNPJs válidos usados nos testes.
const CNPJ_2 = '11444777000161';
const CNPJ_3 = '45723174000110';
const CNPJ_4 = '33000167000101';

const cadastroValido = (extra = {}) => ({
    cnpj: CNPJ_CLIENTE,
    nome: 'Maria Responsável',
    email: 'compras@mercadinho.com',
    telefone: '(19) 99999-0000',
    senha: SENHA,
    endereco: {
        cep: '13870-000',
        logradouro: 'Rua das Flores',
        numero: '100',
        bairro: 'Centro',
        cidade: 'São João da Boa Vista',
        estado: 'sp'
    },
    ...extra
});

const login = (identificador, senha = SENHA) =>
    request(app).post('/api/v1/auth/login').send({ identificador, senha });

const CREDENCIAIS_INVALIDAS = { sucesso: false, mensagem: 'Credenciais inválidas.', codigo: 'CREDENCIAIS_INVALIDAS' };

before(async () => {
    ({ app, sequelize } = await prepararApp());
    admin = await criarUsuario('equipe', { pode_gerenciar_equipe: true });
});

after(async () => {
    await sequelize.close();
});

describe('cadastro público (cliente)', () => {
    test('exige todos os campos e lista cada problema', async () => {
        const resposta = await request(app).post('/api/v1/auth/register').send({}).expect(422);
        assert.equal(resposta.body.codigo, 'VALIDACAO');
        const campos = resposta.body.detalhes.map((d) => d.campo).sort();
        assert.deepEqual(campos, ['cnpj', 'email', 'endereco', 'nome', 'senha', 'telefone']);
    });

    test('endereço incompleto aponta os campos do endereço', async () => {
        const resposta = await request(app).post('/api/v1/auth/register')
            .send(cadastroValido({ endereco: { cep: '123', estado: 'XX' } })).expect(422);
        const campos = resposta.body.detalhes.map((d) => d.campo).sort();
        assert.deepEqual(campos, ['endereco.bairro', 'endereco.cep', 'endereco.cidade', 'endereco.estado', 'endereco.logradouro', 'endereco.numero']);
    });

    test('recusa CNPJ incompleto ou com dígito verificador errado', async () => {
        const incompleto = await request(app).post('/api/v1/auth/register').send(cadastroValido({ cnpj: '11.222.333/0001' })).expect(422);
        assert.equal(incompleto.body.mensagem, 'CNPJ inválido.');
        const invalido = await request(app).post('/api/v1/auth/register').send(cadastroValido({ cnpj: '11.222.333/0001-82' })).expect(422);
        assert.equal(invalido.body.mensagem, 'CNPJ inválido.');
    });

    test('não aceita tentar virar gerente pelo cadastro público', async () => {
        const resposta = await request(app).post('/api/v1/auth/register')
            .send(cadastroValido({ tipo: 'gerente', chave_gestor: 'qualquer', email: 'golpe@mantiqueira.com' })).expect(422);
        const campos = resposta.body.detalhes.map((d) => d.campo).sort();
        assert.deepEqual(campos, ['chave_gestor', 'tipo']);
        const [[{ total }]] = await sequelize.query("SELECT COUNT(*) AS total FROM usuarios WHERE email = 'golpe@mantiqueira.com'");
        assert.equal(total, 0);
    });

    test('cadastra cliente com CNPJ só em dígitos e endereço principal', async () => {
        const resposta = await request(app).post('/api/v1/auth/register').send(cadastroValido()).expect(201);
        const [[usuario]] = await sequelize.query(
            'SELECT tipo, cnpj, telefone, email, ativo FROM usuarios WHERE id_usuario = ?',
            { replacements: [resposta.body.id_usuario] }
        );
        assert.deepEqual({ ...usuario, ativo: Boolean(usuario.ativo) }, {
            tipo: 'cliente',
            cnpj: '11222333000181',
            telefone: '19999990000',
            email: 'compras@mercadinho.com',
            ativo: true
        });
        const [enderecos] = await sequelize.query(
            'SELECT cep, estado, principal FROM enderecos WHERE id_usuario = ?',
            { replacements: [resposta.body.id_usuario] }
        );
        assert.deepEqual(enderecos.map((e) => ({ ...e, principal: Boolean(e.principal) })), [{ cep: '13870-000', estado: 'SP', principal: true }]);
    });

    test('CNPJ repetido (mesmo com outra formatação) e e-mail repetido dão 409', async () => {
        const cnpj = await request(app).post('/api/v1/auth/register')
            .send(cadastroValido({ cnpj: '11222333000181', email: 'outro@x.com' })).expect(409);
        assert.equal(cnpj.body.codigo, 'CNPJ_JA_CADASTRADO');
        const email = await request(app).post('/api/v1/auth/register')
            .send(cadastroValido({ cnpj: CNPJ_2, email: 'COMPRAS@mercadinho.com' })).expect(409);
        assert.equal(email.body.codigo, 'EMAIL_JA_CADASTRADO');
    });
});

describe('login', () => {
    let equipeEmail;

    before(async () => {
        const criada = await request(app).post('/api/v1/admin/usuarios').set('Authorization', admin.auth)
            .send({ nome: 'Gerente Teste', email: 'gerente.login@mantiqueira.com', senha: SENHA, cargo: 'Gerente' })
            .expect(201);
        equipeEmail = criada.body.usuario.email;
    });

    test('cliente entra com CNPJ (com ou sem pontuação) e recebe { token, usuario }', async () => {
        const resposta = await login(CNPJ_CLIENTE).expect(200);
        assert.deepEqual(Object.keys(resposta.body).sort(), ['token', 'usuario']);
        assert.deepEqual(Object.keys(resposta.body.usuario).sort(), ['email', 'id', 'nome', 'pode_gerenciar_equipe', 'tipo']);
        assert.equal(resposta.body.usuario.tipo, 'cliente');
        await login('11222333000181').expect(200);
        await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${resposta.body.token}`).expect(200);
    });

    test('equipe entra com e-mail (sem diferenciar maiúsculas)', async () => {
        const resposta = await login('Gerente.Login@Mantiqueira.com').expect(200);
        assert.equal(resposta.body.usuario.tipo, 'equipe');
        assert.equal(resposta.body.usuario.pode_gerenciar_equipe, false);
    });

    test('cliente usando e-mail no lugar do CNPJ falha', async () => {
        const resposta = await login('compras@mercadinho.com').expect(401);
        assert.deepEqual(resposta.body, CREDENCIAIS_INVALIDAS);
    });

    test('equipe usando CNPJ no lugar do e-mail falha (mesmo que tenha CNPJ gravado)', async () => {
        // Equipe não deveria ter CNPJ; força um no banco para provar que o login por CNPJ só procura clientes.
        await sequelize.query('UPDATE usuarios SET cnpj = ? WHERE email = ?', { replacements: [CNPJ_3, equipeEmail] });
        const resposta = await login(CNPJ_3).expect(401);
        assert.deepEqual(resposta.body, CREDENCIAIS_INVALIDAS);
        await sequelize.query('UPDATE usuarios SET cnpj = NULL WHERE email = ?', { replacements: [equipeEmail] });
    });

    test('formato inválido, campos ausentes e tipos errados dão a mesma resposta 401', async () => {
        for (const corpo of [{}, { identificador: 'abc', senha: SENHA }, { identificador: 123, senha: SENHA },
            { identificador: '12345678901', senha: SENHA }, { identificador: CNPJ_CLIENTE }, { identificador: CNPJ_CLIENTE, senha: ['x'] }]) {
            const resposta = await request(app).post('/api/v1/auth/login').send(corpo).expect(401);
            assert.deepEqual(resposta.body, CREDENCIAIS_INVALIDAS);
        }
    });

    test('usuário inexistente e senha errada: mesma resposta e tempo parecido', async () => {
        const medir = async (identificador, senha) => {
            const inicio = process.hrtime.bigint();
            const resposta = await login(identificador, senha).expect(401);
            return { corpo: resposta.body, ms: Number(process.hrtime.bigint() - inicio) / 1e6 };
        };
        const inexistentes = [];
        const senhasErradas = [];
        for (let i = 0; i < 3; i += 1) {
            inexistentes.push(await medir(CNPJ_4, SENHA));
            senhasErradas.push(await medir(CNPJ_CLIENTE, 'senha-errada'));
        }
        for (const medida of [...inexistentes, ...senhasErradas]) {
            assert.deepEqual(medida.corpo, CREDENCIAIS_INVALIDAS);
        }
        const mediana = (lista) => lista.map((m) => m.ms).sort((a, b) => a - b)[1];
        const [rapido, lento] = [mediana(inexistentes), mediana(senhasErradas)].sort((a, b) => a - b);
        // Os dois casos passam pelo bcrypt; sem o hash falso, o inexistente responderia em poucos ms.
        assert.ok(rapido / lento > 0.5, `tempos muito diferentes: ${rapido.toFixed(0)} ms x ${lento.toFixed(0)} ms`);
    });

    test('usuário inativo não loga e o token que ele já tinha deixa de valer', async () => {
        const sessao = await login(CNPJ_CLIENTE).expect(200);
        const token = `Bearer ${sessao.body.token}`;
        await sequelize.query("UPDATE usuarios SET ativo = FALSE WHERE cnpj = '11222333000181'");

        const resposta = await login(CNPJ_CLIENTE).expect(401);
        assert.deepEqual(resposta.body, CREDENCIAIS_INVALIDAS);
        await request(app).get('/api/v1/auth/me').set('Authorization', token).expect(401);

        await sequelize.query("UPDATE usuarios SET ativo = TRUE WHERE cnpj = '11222333000181'");
        await login(CNPJ_CLIENTE).expect(200);
    });
});

describe('permissões', () => {
    let cliente;
    let funcionario;

    before(async () => {
        cliente = await criarUsuario('cliente');
        funcionario = await criarUsuario('equipe');
    });

    test('cliente em rotas administrativas recebe 403 genérico', async () => {
        const rotas = [
            ['get', '/api/v1/admin/usuarios'],
            ['post', '/api/v1/admin/usuarios'],
            ['get', '/api/v1/clientes'],
            ['get', '/api/v1/painel'],
            ['get', '/api/v1/pedidos'],
            ['post', '/api/v1/produtos'],
            ['patch', '/api/v1/produtos/1/estoque'],
            ['post', '/api/v1/categorias'],
            ['post', '/api/v1/cms'],
            ['get', '/api/v1/auth/users']
        ];
        for (const [metodo, rota] of rotas) {
            const resposta = await request(app)[metodo](rota).set('Authorization', cliente.auth).send({});
            assert.equal(resposta.status, 403, `${metodo.toUpperCase()} ${rota}`);
            assert.deepEqual(resposta.body, { sucesso: false, mensagem: 'Acesso negado.', codigo: 'ACESSO_NEGADO' });
        }
    });

    test('/admin exige pode_gerenciar_equipe; visitante recebe 401', async () => {
        await request(app).get('/api/v1/admin/usuarios').set('Authorization', funcionario.auth).expect(403);
        await request(app).get('/api/v1/auth/users').set('Authorization', funcionario.auth).expect(403);
        const gerente = await criarUsuario('equipe', { cargo: 'Gerente' });
        await request(app).post('/api/v1/admin/usuarios').set('Authorization', gerente.auth).send({}).expect(403);
        await request(app).get('/api/v1/admin/usuarios').expect(401);
        await request(app).get('/api/v1/admin/usuarios').set('Authorization', admin.auth).expect(200);
    });

    test('perfil alterado no banco vale na hora, sem esperar o token expirar', async () => {
        const promovido = await criarUsuario('cliente');
        await request(app).get('/api/v1/clientes').set('Authorization', promovido.auth).expect(403);
        await sequelize.query("UPDATE usuarios SET tipo = 'equipe' WHERE id_usuario = ?", { replacements: [promovido.usuario.id_usuario] });
        await request(app).get('/api/v1/clientes').set('Authorization', promovido.auth).expect(200);
    });
});

describe('equipe (POST/PATCH /admin/usuarios)', () => {
    test('cria usuário da equipe sem CNPJ; não aceita tipo nem campo cnpj', async () => {
        const criado = await request(app).post('/api/v1/admin/usuarios').set('Authorization', admin.auth)
            .send({ nome: 'Ana Separação', email: 'ana@mantiqueira.com', senha: SENHA, cargo: 'Separadora' })
            .expect(201);
        assert.equal(criado.body.usuario.cnpj, null);
        assert.equal(criado.body.usuario.tipo, 'equipe');
        assert.equal(criado.body.usuario.pode_gerenciar_equipe, false);
        assert.equal(criado.body.usuario.senha, undefined);
        await login('ana@mantiqueira.com').expect(200);

        const cliente = await request(app).post('/api/v1/admin/usuarios').set('Authorization', admin.auth)
            .send({ nome: 'Xavier', email: 'x@x.com', senha: SENHA, tipo: 'cliente', cnpj: CNPJ_2 }).expect(422);
        assert.deepEqual(cliente.body.detalhes.map((d) => d.campo).sort(), ['cnpj', 'tipo']);

        await request(app).post('/api/v1/admin/usuarios').set('Authorization', admin.auth)
            .send({ nome: 'Ana 2', email: 'ANA@mantiqueira.com', senha: SENHA }).expect(409);
    });

    test('desativa e reativa usuário; ninguém desativa a si mesmo', async () => {
        const { body } = await request(app).get('/api/v1/admin/usuarios?busca=ana@').set('Authorization', admin.auth);
        const ana = body.usuarios[0];
        await request(app).patch(`/api/v1/admin/usuarios/${ana.id_usuario}`).set('Authorization', admin.auth)
            .send({ ativo: false }).expect(200);
        await login('ana@mantiqueira.com').expect(401);
        await request(app).patch(`/api/v1/admin/usuarios/${ana.id_usuario}`).set('Authorization', admin.auth)
            .send({ ativo: true }).expect(200);
        await login('ana@mantiqueira.com').expect(200);

        const proprio = await request(app).patch(`/api/v1/admin/usuarios/${admin.usuario.id_usuario}`)
            .set('Authorization', admin.auth).send({ ativo: false }).expect(409);
        assert.equal(proprio.body.codigo, 'OPERACAO_NAO_PERMITIDA');
    });

    test('gerente bloqueia cliente por PUT /clientes/:id e corrige CNPJ pendente', async () => {
        const gerente = await criarUsuario('equipe');
        const semCnpj = await criarUsuario('cliente', { cnpj_original: '123.456' });
        const pendentes = await request(app).get('/api/v1/clientes?sem_cnpj=true').set('Authorization', gerente.auth).expect(200);
        assert.ok(pendentes.body.clientes.some((c) => c.id_usuario === semCnpj.usuario.id_usuario));

        await request(app).put(`/api/v1/clientes/${semCnpj.usuario.id_usuario}`).set('Authorization', gerente.auth)
            .send({ cnpj: '123' }).expect(422);
        const duplicado = await request(app).put(`/api/v1/clientes/${semCnpj.usuario.id_usuario}`).set('Authorization', gerente.auth)
            .send({ cnpj: CNPJ_CLIENTE }).expect(409);
        assert.equal(duplicado.body.codigo, 'CNPJ_JA_CADASTRADO');
        const corrigido = await request(app).put(`/api/v1/clientes/${semCnpj.usuario.id_usuario}`).set('Authorization', gerente.auth)
            .send({ cnpj: '11.444.777/0001-61', ativo: false }).expect(200);
        assert.equal(corrigido.body.cliente.cnpj, '11.444.777/0001-61');
        assert.equal(corrigido.body.cliente.ativo, false);
    });
});

describe('minha conta (cliente)', () => {
    let auth;

    before(async () => {
        const sessao = await login(CNPJ_CLIENTE).expect(200);
        auth = `Bearer ${sessao.body.token}`;
    });

    test('vê o próprio perfil com CNPJ formatado e endereços', async () => {
        const resposta = await request(app).get('/api/v1/minha-conta').set('Authorization', auth).expect(200);
        assert.equal(resposta.body.conta.cnpj, CNPJ_CLIENTE);
        assert.equal(resposta.body.conta.enderecos.length, 1);
        assert.equal(resposta.body.conta.senha, undefined);
    });

    test('altera contato, mas não CNPJ nem razão social', async () => {
        await request(app).patch('/api/v1/minha-conta').set('Authorization', auth)
            .send({ telefone: '19 3333-4444' }).expect(200);
        const proibido = await request(app).patch('/api/v1/minha-conta').set('Authorization', auth)
            .send({ cnpj: CNPJ_2, razao_social: 'Outra' }).expect(422);
        assert.deepEqual(proibido.body.detalhes.map((d) => d.campo).sort(), ['cnpj', 'razao_social']);
    });

    test('gerencia endereços: novo principal, edição e não remove o último', async () => {
        const base = '/api/v1/minha-conta/enderecos';
        const novo = await request(app).post(base).set('Authorization', auth).send({
            cep: '01001000', logradouro: 'Praça da Sé', numero: '1', bairro: 'Sé', cidade: 'São Paulo', estado: 'SP', principal: true
        }).expect(201);
        let lista = (await request(app).get(base).set('Authorization', auth)).body.enderecos;
        assert.equal(lista.length, 2);
        assert.equal(lista.filter((e) => e.principal).length, 1);
        assert.equal(lista[0].id_endereco, novo.body.endereco.id_endereco);

        await request(app).patch(`${base}/${novo.body.endereco.id_endereco}`).set('Authorization', auth)
            .send({ complemento: 'Sala 2' }).expect(200);

        // Remover o principal promove o outro.
        await request(app).delete(`${base}/${novo.body.endereco.id_endereco}`).set('Authorization', auth).expect(200);
        lista = (await request(app).get(base).set('Authorization', auth)).body.enderecos;
        assert.equal(lista.length, 1);
        assert.equal(lista[0].principal, true);
        const ultimo = await request(app).delete(`${base}/${lista[0].id_endereco}`).set('Authorization', auth).expect(409);
        assert.equal(ultimo.body.codigo, 'ULTIMO_ENDERECO');
    });

    test('não acessa endereço de outro cliente', async () => {
        const outro = await criarUsuario('cliente');
        const [resultado] = await sequelize.query(
            "INSERT INTO enderecos (id_usuario, cep, logradouro, numero, bairro, cidade, estado, principal) VALUES (?, '01001-000', 'R', '1', 'B', 'C', 'SP', TRUE)",
            { replacements: [outro.usuario.id_usuario] }
        );
        await request(app).patch(`/api/v1/minha-conta/enderecos/${resultado}`).set('Authorization', auth)
            .send({ numero: '2' }).expect(404);
    });

    test('troca de senha confere a senha atual', async () => {
        await request(app).patch('/api/v1/minha-conta/senha').set('Authorization', auth)
            .send({ senha_atual: 'errada', nova_senha: 'NovaSenha@2' }).expect(422);
        await request(app).patch('/api/v1/minha-conta/senha').set('Authorization', auth)
            .send({ senha_atual: SENHA, nova_senha: 'NovaSenha@2' }).expect(200);
        await login(CNPJ_CLIENTE, 'NovaSenha@2').expect(200);
        await login(CNPJ_CLIENTE).expect(401);
    });
});

describe('sessão: duração do token e troca de senha', () => {
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcrypt');
    const CNPJ_SESSAO = '06990590000123';
    const CNPJ_TEMPORARIA = '00000000000191';
    let cliente;
    let clienteTemporaria;

    // Token com "iat" no passado: simula uma sessão aberta antes da troca de senha.
    const tokenAntigo = (usuario) => `Bearer ${jwt.sign(
        { id: usuario.id_usuario, tipo: usuario.tipo, iat: Math.floor(Date.now() / 1000) - 60 },
        config.jwtSecret, { expiresIn: '1h' }
    )}`;
    const me = (auth) => request(app).get('/api/v1/auth/me').set('Authorization', auth);
    const duracao = (token) => { const { iat, exp } = jwt.decode(token); return exp - iat; };

    before(async () => {
        ({ usuario: cliente } = await criarUsuario('cliente', { cnpj: CNPJ_SESSAO, senha: await bcrypt.hash(SENHA, 4) }));
        ({ usuario: clienteTemporaria } = await criarUsuario('cliente', { cnpj: CNPJ_TEMPORARIA, senha: await bcrypt.hash(SENHA, 4) }));
    });

    test('JWT_EXPIRES_IN: padrão 8h, aceita outro valor e recusa formato inválido', () => {
        const base = { JWT_SECRET: 'x'.repeat(40) };
        const { validarAmbiente } = require('../config/ambiente');
        assert.equal(validarAmbiente(base).config.jwtExpiraEm, '8h');
        assert.equal(validarAmbiente({ ...base, JWT_EXPIRES_IN: '30m' }).config.jwtExpiraEm, '30m');
        for (const invalido of ['120', '8 horas', '0h', '2w']) {
            assert.deepEqual(validarAmbiente({ ...base, JWT_EXPIRES_IN: invalido }).erros,
                ['JWT_EXPIRES_IN deve ser um número seguido de s, m, h ou d (ex.: 8h).']);
        }
    });

    test('o token do login dura o configurado (padrão 8h)', async () => {
        const padrao = await login(CNPJ_SESSAO).expect(200);
        assert.equal(duracao(padrao.body.token), 8 * 3600);

        const original = config.jwtExpiraEm;
        config.jwtExpiraEm = '30m';
        try {
            const curto = await login(CNPJ_SESSAO).expect(200);
            assert.equal(duracao(curto.body.token), 30 * 60);
        } finally {
            config.jwtExpiraEm = original;
        }
    });

    test('trocar a senha em /minha-conta/senha invalida os tokens emitidos antes', async () => {
        const antigo = tokenAntigo(cliente);
        await me(antigo).expect(200);
        await request(app).patch('/api/v1/minha-conta/senha').set('Authorization', antigo)
            .send({ senha_atual: SENHA, nova_senha: 'TrocaSessao@1' }).expect(200);

        const recusado = await me(antigo).expect(401);
        assert.equal(recusado.body.codigo, 'NAO_AUTENTICADO');
        const [[{ senha_alterada_em: alteradaEm }]] = await sequelize.query(
            'SELECT senha_alterada_em FROM usuarios WHERE id_usuario = ?', { replacements: [cliente.id_usuario] });
        assert.ok(alteradaEm);

        // O login feito depois da troca vale normalmente.
        const novo = await login(CNPJ_SESSAO, 'TrocaSessao@1').expect(200);
        await me(`Bearer ${novo.body.token}`).expect(200);
    });

    test('senha temporária definida pela equipe (PUT /clientes/:id/senha) invalida os tokens anteriores do cliente', async () => {
        const antigo = tokenAntigo(clienteTemporaria);
        await me(antigo).expect(200);
        await request(app).put(`/api/v1/clientes/${clienteTemporaria.id_usuario}/senha`).set('Authorization', admin.auth)
            .send({ senha: 'Temporaria@9' }).expect(200);

        await me(antigo).expect(401);
        // O token da equipe que fez a troca continua valendo.
        await me(admin.auth).expect(200);
        const novo = await login(CNPJ_TEMPORARIA, 'Temporaria@9').expect(200);
        await me(`Bearer ${novo.body.token}`).expect(200);
    });

    test('a data da troca não aparece nas respostas', async () => {
        const resposta = await request(app).get('/api/v1/auth/users').set('Authorization', admin.auth).expect(200);
        assert.ok(resposta.body.usuarios.every((u) => !('senha_alterada_em' in u)));
    });
});

describe('migration 004 com dados antigos', () => {
    test('CNPJs inválidos, duplicados e de equipe vão para cnpj_original sem apagar nada', async () => {
        const nome = 'mantiqueira_cnpj_test';
        const conexao = await abrirConexao();
        try {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await aplicarMigracoes({ nomeBanco: nome, ateVersao: '003' });
            await conexao.query(`USE \`${nome}\``);
            await conexao.query(`
                INSERT INTO usuarios (id_usuario, nome, email, senha, tipo, cnpj_cpf) VALUES
                (1, 'Formatado', 'a@x.com', 'h', 'cliente', '11.222.333/0001-81'),
                (2, 'Duplicado', 'b@x.com', 'h', 'cliente', '11222333000181'),
                (3, 'Invalido', 'c@x.com', 'h', 'cliente', '123'),
                (4, 'Incompleto', 'd@x.com', 'h', 'cliente', '11.222.333/0001'),
                (5, 'Sem CNPJ', 'e@x.com', 'h', 'cliente', NULL),
                (6, 'Gerente', 'f@x.com', 'h', 'gerente', '11.444.777/0001-61')
            `);
            const mensagens = [];
            await aplicarMigracoes({ nomeBanco: nome, log: (m) => mensagens.push(m) });

            const [linhas] = await conexao.query('SELECT id_usuario, cnpj, cnpj_original FROM usuarios ORDER BY id_usuario');
            assert.deepEqual(linhas, [
                { id_usuario: 1, cnpj: '11222333000181', cnpj_original: null },
                { id_usuario: 2, cnpj: null, cnpj_original: '11222333000181' },
                { id_usuario: 3, cnpj: null, cnpj_original: '123' },
                { id_usuario: 4, cnpj: null, cnpj_original: '11.222.333/0001' },
                { id_usuario: 5, cnpj: null, cnpj_original: null },
                { id_usuario: 6, cnpj: null, cnpj_original: '11.444.777/0001-61' }
            ]);
            const texto = mensagens.join('\n');
            assert.match(texto, /#2 .*CNPJ repetido \(já usado pelo usuário #1\)/);
            assert.match(texto, /#4 .*CNPJ inválido/);
            assert.match(texto, /4 cliente\(s\) sem CNPJ válido/);

            await assert.rejects(
                conexao.query("UPDATE usuarios SET cnpj = '11222333000181' WHERE id_usuario = 2"),
                /Duplicate entry/
            );
            await assert.rejects(conexao.query("UPDATE usuarios SET cnpj = '11.222' WHERE id_usuario = 3"));
        } finally {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await conexao.end();
        }
    });
});

describe('perfis cliente/equipe e pode_gerenciar_equipe', () => {
    test('cargo é texto livre: um "Estoquista" tem as mesmas permissões da área do gestor', async () => {
        const estoquista = await criarUsuario('equipe', { cargo: 'Estoquista' });
        await request(app).get('/api/v1/clientes').set('Authorization', estoquista.auth).expect(200);
        await request(app).get('/api/v1/painel/alertas-reposicao').set('Authorization', estoquista.auth).expect(200);
        await request(app).post('/api/v1/categorias').set('Authorization', estoquista.auth)
            .send({ nome: 'Criada pelo estoquista' }).expect(201);
        // Mas não gerencia usuários sem a marca.
        await request(app).post('/api/v1/admin/usuarios').set('Authorization', estoquista.auth).send({}).expect(403);
    });

    test('a marca pode ser concedida; quem a recebe passa a gerenciar a equipe na hora', async () => {
        const novo = await criarUsuario('equipe');
        await request(app).get('/api/v1/admin/usuarios').set('Authorization', novo.auth).expect(403);
        await request(app).patch(`/api/v1/admin/usuarios/${novo.usuario.id_usuario}`).set('Authorization', admin.auth)
            .send({ pode_gerenciar_equipe: true }).expect(200);
        await request(app).get('/api/v1/admin/usuarios').set('Authorization', novo.auth).expect(200);
        // Com duas pessoas com a marca, uma pode tirá-la da outra.
        await request(app).patch(`/api/v1/admin/usuarios/${novo.usuario.id_usuario}`).set('Authorization', admin.auth)
            .send({ pode_gerenciar_equipe: false }).expect(200);
        await request(app).get('/api/v1/admin/usuarios').set('Authorization', novo.auth).expect(403);
    });

    test('não remove a marca nem desativa o último usuário ativo que a tem', async () => {
        // Deixa só o "admin" deste arquivo com a marca.
        await sequelize.query('UPDATE usuarios SET pode_gerenciar_equipe = FALSE WHERE id_usuario <> ?',
            { replacements: [admin.usuario.id_usuario] });
        const propria = await request(app).patch(`/api/v1/admin/usuarios/${admin.usuario.id_usuario}`)
            .set('Authorization', admin.auth).send({ pode_gerenciar_equipe: false }).expect(409);
        assert.equal(propria.body.codigo, 'OPERACAO_NAO_PERMITIDA');

        // Com outro gestor, o próprio pode abrir mão da marca.
        const outro = await criarUsuario('equipe', { pode_gerenciar_equipe: true });
        await request(app).patch(`/api/v1/admin/usuarios/${admin.usuario.id_usuario}`)
            .set('Authorization', outro.auth).send({ pode_gerenciar_equipe: false }).expect(200);
        // Agora "outro" é o último: o ex-gestor não consegue mais nada em /admin, e "outro" não pode ser desativado por ninguém.
        await request(app).get('/api/v1/admin/usuarios').set('Authorization', admin.auth).expect(403);
        await request(app).patch(`/api/v1/admin/usuarios/${outro.usuario.id_usuario}`)
            .set('Authorization', outro.auth).send({ ativo: false }).expect(409);
        // Devolve a marca ao "admin" para os testes seguintes.
        await request(app).patch(`/api/v1/admin/usuarios/${admin.usuario.id_usuario}`)
            .set('Authorization', outro.auth).send({ pode_gerenciar_equipe: true }).expect(200);
    });

    test('cliente não recebe a marca e usuário de cliente só tem "ativo" editável', async () => {
        const clienteX = await criarUsuario('cliente');
        const resposta = await request(app).patch(`/api/v1/admin/usuarios/${clienteX.usuario.id_usuario}`)
            .set('Authorization', admin.auth).send({ pode_gerenciar_equipe: true }).expect(422);
        assert.match(resposta.body.mensagem, /clientes/);
        await assert.rejects(sequelize.query('UPDATE usuarios SET pode_gerenciar_equipe = TRUE WHERE id_usuario = ?',
            { replacements: [clienteX.usuario.id_usuario] }));
    });

    test('migration 007 converte admin/gerente/funcionario em equipe e marca quem era admin', async () => {
        const nome = 'mantiqueira_perfis_test';
        const conexao = await abrirConexao();
        try {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await aplicarMigracoes({ nomeBanco: nome, ateVersao: '006' });
            await conexao.query(`USE \`${nome}\``);
            await conexao.query(`
                INSERT INTO usuarios (id_usuario, nome, email, senha, tipo, cargo) VALUES
                (1, 'Admin', 'a@x.com', 'h', 'admin', NULL),
                (2, 'Gerente', 'b@x.com', 'h', 'gerente', 'Gerente de Compras'),
                (3, 'Func', 'c@x.com', 'h', 'funcionario', NULL),
                (4, 'Cliente', 'd@x.com', 'h', 'cliente', NULL)
            `);
            await aplicarMigracoes({ nomeBanco: nome });
            const [linhas] = await conexao.query('SELECT id_usuario, tipo, pode_gerenciar_equipe AS marca, cargo FROM usuarios ORDER BY id_usuario');
            assert.deepEqual(linhas, [
                { id_usuario: 1, tipo: 'equipe', marca: 1, cargo: 'Administrador' },
                { id_usuario: 2, tipo: 'equipe', marca: 0, cargo: 'Gerente de Compras' },
                { id_usuario: 3, tipo: 'equipe', marca: 0, cargo: 'Funcionário' },
                { id_usuario: 4, tipo: 'cliente', marca: 0, cargo: null }
            ]);
            await assert.rejects(conexao.query("UPDATE usuarios SET tipo = 'gerente' WHERE id_usuario = 2"));
        } finally {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await conexao.end();
        }
    });

    test('migration 007 sem nenhum admin: o usuário ativo mais antigo da equipe recebe a marca', async () => {
        const nome = 'mantiqueira_perfis2_test';
        const conexao = await abrirConexao();
        try {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await aplicarMigracoes({ nomeBanco: nome, ateVersao: '006' });
            await conexao.query(`USE \`${nome}\``);
            await conexao.query(`
                INSERT INTO usuarios (id_usuario, nome, email, senha, tipo, ativo) VALUES
                (1, 'Inativo', 'a@x.com', 'h', 'gerente', FALSE),
                (2, 'Gerente', 'b@x.com', 'h', 'gerente', TRUE),
                (3, 'Func', 'c@x.com', 'h', 'funcionario', TRUE)
            `);
            await aplicarMigracoes({ nomeBanco: nome });
            const [linhas] = await conexao.query('SELECT id_usuario FROM usuarios WHERE pode_gerenciar_equipe = TRUE');
            assert.deepEqual(linhas, [{ id_usuario: 2 }]);
        } finally {
            await conexao.query(`DROP DATABASE IF EXISTS \`${nome}\``);
            await conexao.end();
        }
    });
});

describe('limite de tentativas de login', () => {
    test('bloqueia o IP depois de muitas falhas, inclusive tentativas corretas', async () => {
        let status;
        let tentativas = 0;
        do {
            tentativas += 1;
            ({ status } = await login(CNPJ_4, 'errada'));
        } while (status === 401 && tentativas <= config.limites.login + 1);
        assert.equal(status, 429);
        const bloqueado = await login('ana@mantiqueira.com').expect(429);
        assert.equal(bloqueado.body.codigo, 'MUITAS_TENTATIVAS');
    });
});
