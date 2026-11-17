const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const bcrypt = require('bcrypt');
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

describe('npm run redefinir-senha-admin (gera token, não pede senha)', () => {
    const { lerArgumentos, gerarTokenAdmin, Recusa } = require('../scripts/redefinir-senha-admin');
    const ANTIGA = 'Antiga@Senha1';
    const NOVA = 'Nova@Senha456';
    let administrador;

    before(async () => {
        administrador = await criarUsuario('equipe', {
            email: 'chefe@mantiqueira.com.br', senha: await bcrypt.hash(ANTIGA, 4), pode_gerenciar_equipe: true
        });
    });

    test('argumentos: aceita só --email; qualquer --senha é recusado', () => {
        assert.deepEqual(lerArgumentos(['--email', 'a@b.com']), { email: 'a@b.com' });
        assert.deepEqual(lerArgumentos(['--email=a@b.com']), { email: 'a@b.com' });
        assert.deepEqual(lerArgumentos([]), {});
        for (const argv of [['--senha', 'Segredo@123'], ['--senha=Segredo@123'], ['--SENHA', 'x']]) {
            assert.throws(() => lerArgumentos(argv), (e) => e instanceof Recusa && /não usa senha/.test(e.message) && !e.message.includes('Segredo'));
        }
        assert.throws(() => lerArgumentos(['--nome', 'x']), /Argumento desconhecido/);
        assert.throws(() => lerArgumentos(['--email']), /Informe um valor/);
    });

    test('recusa quem não é administrador ativo da equipe e não grava nada', async () => {
        const semPermissao = await criarUsuario('equipe', { email: 'func@mantiqueira.com.br' });
        await criarUsuario('equipe', { email: 'inativo@mantiqueira.com.br', pode_gerenciar_equipe: true, ativo: false });
        await criarUsuario('cliente', { email: 'cli@mantiqueira.com.br' });
        for (const email of ['ninguem@mantiqueira.com.br', semPermissao.usuario.email, 'inativo@mantiqueira.com.br', 'cli@mantiqueira.com.br']) {
            await assert.rejects(gerarTokenAdmin({ email }), (e) => e instanceof Recusa && /administrador ativo/.test(e.message));
        }
        const [linhas] = await sequelize.query('SELECT 1 FROM redefinicoes_senha');
        assert.equal(linhas.length, 0);
    });

    test('gera o token (só o hash no banco, 60 min), invalida o anterior, audita sem o token e não mexe na senha', async () => {
        const anterior = await gerarTokenAdmin({ email: 'chefe@mantiqueira.com.br' });
        const { token, expira_em: expiraEm, usuario } = await gerarTokenAdmin({ email: 'CHEFE@mantiqueira.com.br' });
        assert.equal(usuario.id_usuario, administrador.usuario.id_usuario);
        assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        const minutos = (expiraEm - Date.now()) / 60000;
        assert.ok(minutos > 59 && minutos <= 60);

        const [linhas] = await sequelize.query('SELECT * FROM redefinicoes_senha WHERE id_usuario = ? ORDER BY id_redefinicao', { replacements: [usuario.id_usuario] });
        assert.equal(linhas.length, 2);
        assert.ok(linhas[0].usado_em, 'o token anterior foi invalidado');
        assert.equal(linhas[1].usado_em, null);
        assert.equal(linhas[1].criado_por, null);
        assert.equal(linhas[1].token_hash, createHash('sha256').update(token).digest('hex'));
        assert.ok(!JSON.stringify(linhas).includes(token));

        // A senha não muda: o administrador ainda entra com a antiga até usar o token.
        await request(app).post('/api/v1/auth/login').send({ identificador: 'chefe@mantiqueira.com.br', senha: ANTIGA }).expect(200);
        assert.deepEqual((await request(app).post('/api/v1/auth/redefinir-senha/validar').send({ token: anterior.token })).body, { valido: false });

        const [auditoria] = await sequelize.query("SELECT * FROM auditoria WHERE acao = 'usuario.redefinicao_senha_gerada_por_terminal'");
        assert.equal(auditoria.length, 2);
        assert.equal(auditoria[0].id_usuario, null);
        assert.equal(auditoria[0].id_entidade, String(usuario.id_usuario));
        assert.ok(!JSON.stringify(auditoria).includes(token));
    });

    test('o administrador escolhe a própria senha com o token e entra com ela', async () => {
        const { token } = await gerarTokenAdmin({ email: 'chefe@mantiqueira.com.br' });
        await request(app).post('/api/v1/auth/redefinir-senha').send({ token, nova_senha: NOVA }).expect(200);
        await request(app).post('/api/v1/auth/login').send({ identificador: 'chefe@mantiqueira.com.br', senha: ANTIGA }).expect(401);
        const login = await request(app).post('/api/v1/auth/login').send({ identificador: 'chefe@mantiqueira.com.br', senha: NOVA }).expect(200);
        assert.equal(login.body.usuario.pode_gerenciar_equipe, true);
        assert.equal((await request(app).post('/api/v1/auth/redefinir-senha').send({ token, nova_senha: NOVA }).expect(422)).body.codigo, 'TOKEN_INVALIDO');
    });
});
