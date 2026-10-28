const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;

before(async () => {
    ({ app, sequelize } = await prepararApp());
});

after(async () => {
    await sequelize.close();
});

describe('npm run criar-admin', () => {
    const { lerArgumentos, validarDados, criarAdmin, perguntarOculto, confirmado, Recusa } = require('../scripts/criar-admin');
    const SENHA = 'Primeira@Senha1';
    const valido = { nome: 'Maria Administradora', email: 'Maria@Mantiqueira.com.br', senha: SENHA, confirmacao: SENHA };
    const usuarios = async () => (await sequelize.query('SELECT email, senha, tipo, ativo, pode_gerenciar_equipe, cnpj FROM usuarios'))[0];

    test('recusa e-mail inválido, senha curta ou longa e senhas que não conferem', () => {
        assert.throws(() => validarDados({ ...valido, email: 'maria.sem.arroba' }), (e) => e instanceof Recusa && /e-mail válido/.test(e.message));
        assert.throws(() => validarDados({ ...valido, senha: 'curta', confirmacao: 'curta' }), /entre 8 e 72 caracteres/);
        assert.throws(() => validarDados({ ...valido, senha: 'x'.repeat(73), confirmacao: 'x'.repeat(73) }), /entre 8 e 72 caracteres/);
        assert.throws(() => validarDados({ ...valido, confirmacao: 'Outra@Senha1' }), /não conferem/);
        // Normaliza como o cadastro: e-mail em minúsculas.
        assert.equal(validarDados(valido).email, 'maria@mantiqueira.com.br');
    });

    test('recusa e-mail já em uso', async () => {
        await criarUsuario('equipe', { email: 'ocupado@mantiqueira.com.br' });
        await assert.rejects(criarAdmin(validarDados({ ...valido, email: 'OCUPADO@mantiqueira.com.br' })), /já está em uso/);
        assert.equal((await usuarios()).filter((u) => u.pode_gerenciar_equipe).length, 0);
    });

    test('cria o administrador com só o hash da senha e ele entra por /auth/login', async () => {
        const usuario = await criarAdmin(validarDados(valido));
        assert.equal(usuario.email, 'maria@mantiqueira.com.br');

        const [gravado] = (await usuarios()).filter((u) => u.email === 'maria@mantiqueira.com.br');
        assert.deepEqual({ tipo: gravado.tipo, ativo: gravado.ativo, gerencia: gravado.pode_gerenciar_equipe, cnpj: gravado.cnpj },
            { tipo: 'equipe', ativo: 1, gerencia: 1, cnpj: null });
        // bcrypt com o mesmo custo da API (12); a senha em texto não está em nenhuma coluna.
        assert.match(gravado.senha, /^\$2b\$12\$/);
        const [linhas] = await sequelize.query('SELECT * FROM usuarios');
        assert.ok(!JSON.stringify(linhas).includes(SENHA));

        const login = await request(app).post('/api/v1/auth/login')
            .send({ identificador: 'maria@mantiqueira.com.br', senha: SENHA }).expect(200);
        assert.equal(login.body.usuario.tipo, 'equipe');
        assert.equal(login.body.usuario.pode_gerenciar_equipe, true);
    });

    test('recusa um segundo administrador enquanto o primeiro estiver ativo', async () => {
        const segundo = { ...valido, email: 'segundo@mantiqueira.com.br' };
        await assert.rejects(criarAdmin(validarDados(segundo)), (e) => e instanceof Recusa && /POST \/api\/v1\/admin\/usuarios/.test(e.message));

        // Com o primeiro desativado, o comando volta a servir (ex.: recuperar o acesso).
        await sequelize.query("UPDATE usuarios SET ativo = FALSE WHERE email = 'maria@mantiqueira.com.br'");
        try {
            await criarAdmin(validarDados(segundo));
            assert.equal((await usuarios()).filter((u) => u.ativo && u.pode_gerenciar_equipe).length, 1);
        } finally {
            await sequelize.query("DELETE FROM usuarios WHERE email = 'segundo@mantiqueira.com.br'");
            await sequelize.query("UPDATE usuarios SET ativo = TRUE WHERE email = 'maria@mantiqueira.com.br'");
        }
    });

    test('argumentos: aceita --nome e --email; recusa senha por argumento e argumentos desconhecidos', () => {
        assert.deepEqual(lerArgumentos(['--nome', 'Maria Silva', '--email=maria@x.com']), { nome: 'Maria Silva', email: 'maria@x.com' });
        assert.deepEqual(lerArgumentos([]), {});
        for (const argv of [['--senha', 'Segredo@123'], ['--senha=Segredo@123'], ['--SENHA', 'x']]) {
            assert.throws(() => lerArgumentos(argv), (e) => e instanceof Recusa && /não pode ser passada por argumento/.test(e.message) && !e.message.includes('Segredo'));
        }
        assert.throws(() => lerArgumentos(['--cargo', 'Chefe']), /Argumento desconhecido/);
        assert.throws(() => lerArgumentos(['--email']), /Informe um valor/);
    });

    test('a senha digitada não aparece na tela (terminal em modo raw)', async () => {
        const entrada = new PassThrough();
        const modos = [];
        Object.assign(entrada, { isTTY: true, setRawMode: (ligado) => modos.push(ligado) });
        const saida = new PassThrough();
        let tela = '';
        saida.on('data', (pedaco) => { tela += pedaco; });

        const lida = perguntarOculto('Senha: ', { entrada, saida });
        entrada.write('Segredo@12');
        entrada.write('\u007f3\r'); // apaga o "2" e digita "3"
        assert.equal(await lida, 'Segredo@13');
        assert.equal(tela, 'Senha: \n');
        assert.deepEqual(modos, [true, false]);
    });

    test('senha fora de um terminal interativo é recusada (não lê de pipe)', async () => {
        const entrada = new PassThrough();
        await assert.rejects(perguntarOculto('Senha: ', { entrada, saida: new PassThrough() }), /terminal interativo/);
    });

    test('só cria depois de digitar "sim"', () => {
        assert.equal(confirmado('sim'), true);
        assert.equal(confirmado(' SIM '), true);
        for (const resposta of ['', 's', 'yes', 'não', 'sim!']) assert.equal(confirmado(resposta), false);
    });
});
