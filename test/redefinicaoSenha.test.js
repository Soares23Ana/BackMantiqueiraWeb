const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');
const { prepararApp, criarUsuario, semRequestId } = require('./ajuda');

let app;
let sequelize;
let equipe;
let admin;

const SENHA_NOVA = 'Nova@Senha123';
const SENHA_ANTIGA = 'Senha@Antiga1';
const MENSAGEM_INVALIDO = 'Link inválido ou expirado. Peça um novo link à equipe.';

before(async () => {
    ({ app, sequelize } = await prepararApp());
    equipe = await criarUsuario('equipe');
    admin = await criarUsuario('equipe', { pode_gerenciar_equipe: true });
    for (let i = 0; i < 8; i += 1) funcionarios.push(await criarUsuario('equipe'));
});

after(async () => {
    await sequelize.close();
});

// Cada cliente recebe um CNPJ válido e único (14 dígitos gerados com os dígitos verificadores corretos).
let contadorCnpj = 0;
function cnpjValido(base) {
    const calcular = (digitos) => {
        const pesos = digitos.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const resto = digitos.reduce((soma, d, i) => soma + d * pesos[i], 0) % 11;
        return resto < 2 ? 0 : 11 - resto;
    };
    const digitos = base.split('').map(Number);
    digitos.push(calcular(digitos));
    digitos.push(calcular(digitos));
    return digitos.join('');
}
async function novoCliente(dados = {}) {
    contadorCnpj += 1;
    const cnpj = cnpjValido(`${String(10000000 + contadorCnpj)}0001`);
    return criarUsuario('cliente', { cnpj, senha: await bcrypt.hash(SENHA_ANTIGA, 4), ...dados });
}

// O limite é de 20 gerações por minuto por usuário: as chamadas se revezam entre vários funcionários.
let rodizio = 0;
const funcionarios = [];
const proximoFuncionario = () => funcionarios[rodizio++ % funcionarios.length];
const gerarParaCliente = (alvo, quem = proximoFuncionario()) =>
    request(app).post(`/api/v1/clientes/${alvo.usuario.id_usuario}/redefinicao-senha`).set('Authorization', quem.auth);
const gerarParaEquipe = (alvo, quem = admin) =>
    request(app).post(`/api/v1/admin/usuarios/${alvo.usuario.id_usuario}/redefinicao-senha`).set('Authorization', quem.auth);
const validar = (token) => request(app).post('/api/v1/auth/redefinir-senha/validar').send({ token });
const redefinir = (token, nova_senha = SENHA_NOVA) => request(app).post('/api/v1/auth/redefinir-senha').send({ token, nova_senha });
const linhas = async (idUsuario) =>
    (await sequelize.query('SELECT * FROM redefinicoes_senha WHERE id_usuario = ? ORDER BY id_redefinicao', { replacements: [idUsuario] }))[0];
const loginCliente = (cliente, senha) =>
    request(app).post('/api/v1/auth/login').send({ identificador: cliente.usuario.cnpj, senha });

describe('migration 024', () => {
    test('cria redefinicoes_senha com token_hash único e índice por usuário', async () => {
        const [versao] = (await sequelize.query("SELECT versao FROM schema_migrations WHERE versao = '024'"))[0];
        assert.ok(versao, 'migration 024 aplicada');
        const colunas = (await sequelize.query("SELECT COLUMN_NAME c, COLUMN_TYPE t, IS_NULLABLE n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'redefinicoes_senha'"))[0];
        const por = Object.fromEntries(colunas.map((c) => [c.c, c]));
        assert.equal(por.token_hash.t, 'char(64)');
        assert.equal(por.usado_em.n, 'YES');
        for (const campo of ['id_redefinicao', 'id_usuario', 'criado_em', 'expira_em', 'criado_por']) assert.ok(por[campo], campo);
        const indices = (await sequelize.query("SELECT INDEX_NAME i, NON_UNIQUE nu, COLUMN_NAME c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'redefinicoes_senha'"))[0];
        assert.ok(indices.some((i) => i.c === 'token_hash' && Number(i.nu) === 0));
        assert.ok(indices.some((i) => i.c === 'id_usuario'));
    });
});

describe('gerar o link (equipe)', () => {
    test('equipe gera para cliente: 201 com token e validade; o banco guarda só o hash', async () => {
        const cliente = await novoCliente();
        const { body } = await gerarParaCliente(cliente).expect(201);
        assert.match(body.token, /^[A-Za-z0-9_-]{43}$/);
        const minutos = (new Date(body.expira_em) - Date.now()) / 60000;
        assert.ok(minutos > 59 && minutos <= 60, `validade de 60 minutos (${minutos})`);

        const [linha] = await linhas(cliente.usuario.id_usuario);
        assert.match(linha.token_hash, /^[0-9a-f]{64}$/);
        assert.notEqual(linha.token_hash, body.token);
        assert.equal(linha.token_hash, createHash('sha256').update(body.token).digest('hex'));
        assert.equal(linha.usado_em, null);
        assert.ok(funcionarios.some((f) => f.usuario.id_usuario === linha.criado_por));
        const [todas] = await sequelize.query('SELECT * FROM redefinicoes_senha');
        assert.ok(!JSON.stringify(todas).includes(body.token));
    });

    test('cliente comum não gera (403) e sem login é 401', async () => {
        const alvo = await novoCliente();
        const comum = await novoCliente();
        await gerarParaCliente(alvo, comum).expect(403);
        await request(app).post(`/api/v1/clientes/${alvo.usuario.id_usuario}/redefinicao-senha`).expect(401);
        assert.equal((await linhas(alvo.usuario.id_usuario)).length, 0);
    });

    test('rota de clientes só serve para cliente; rota de equipe só para equipe; id inválido é 404', async () => {
        const outro = await criarUsuario('equipe');
        const cliente = await novoCliente();
        await request(app).post(`/api/v1/clientes/${outro.usuario.id_usuario}/redefinicao-senha`).set('Authorization', equipe.auth).expect(404);
        await gerarParaEquipe(cliente).expect(404);
        await request(app).post('/api/v1/clientes/999999/redefinicao-senha').set('Authorization', equipe.auth).expect(404);
        await request(app).post('/api/v1/clientes/abc/redefinicao-senha').set('Authorization', equipe.auth).expect(404);
    });

    test('funcionário sem pode_gerenciar_equipe não gera para equipe; admin gera para funcionário e não para si mesmo', async () => {
        const funcionario = await criarUsuario('equipe');
        await gerarParaEquipe(funcionario, equipe).expect(403);
        assert.equal((await linhas(funcionario.usuario.id_usuario)).length, 0);

        const { body } = await gerarParaEquipe(funcionario).expect(201);
        assert.ok(body.token);
        const proprio = await gerarParaEquipe(admin).expect(409);
        assert.equal(proprio.body.codigo, 'OPERACAO_NAO_PERMITIDA');
        assert.equal((await linhas(admin.usuario.id_usuario)).length, 0);
    });

    test('usuário inativo: 409 USUARIO_INATIVO', async () => {
        const cliente = await novoCliente({ ativo: false });
        const resposta = await gerarParaCliente(cliente).expect(409);
        assert.equal(resposta.body.codigo, 'USUARIO_INATIVO');
        assert.equal((await linhas(cliente.usuario.id_usuario)).length, 0);
        const inativoEquipe = await criarUsuario('equipe', { ativo: false });
        assert.equal((await gerarParaEquipe(inativoEquipe).expect(409)).body.codigo, 'USUARIO_INATIVO');
    });

    test('novo link invalida o anterior', async () => {
        const cliente = await novoCliente();
        const primeiro = (await gerarParaCliente(cliente).expect(201)).body.token;
        const segundo = (await gerarParaCliente(cliente).expect(201)).body.token;
        assert.deepEqual((await validar(primeiro).expect(200)).body, { valido: false });
        assert.deepEqual((await validar(segundo).expect(200)).body, { valido: true });
        const registros = await linhas(cliente.usuario.id_usuario);
        assert.equal(registros.length, 2);
        assert.ok(registros[0].usado_em);
        assert.equal(registros[1].usado_em, null);
        assert.equal((await redefinir(primeiro).expect(422)).body.codigo, 'TOKEN_INVALIDO');
        await redefinir(segundo).expect(200);
    });

    test('limite de 20 por minuto por usuário', async () => {
        const solo = await criarUsuario('equipe');
        const cliente = await novoCliente();
        for (let i = 0; i < 20; i += 1) await gerarParaCliente(cliente, solo).expect(201);
        const barrado = await gerarParaCliente(cliente, solo).expect(429);
        assert.equal(barrado.body.codigo, 'LIMITE_REQUISICOES');
        // Outro usuário não é afetado.
        await gerarParaCliente(cliente, equipe).expect(201);
    });
});

describe('usar o link (público)', () => {
    test('validar: token bom e ruim, sem dados do usuário', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        assert.deepEqual((await validar(token).expect(200)).body, { valido: true });
        assert.deepEqual((await validar('x'.repeat(43)).expect(200)).body, { valido: false });
        assert.deepEqual((await validar('curto').expect(200)).body, { valido: false });
        await request(app).post('/api/v1/auth/redefinir-senha/validar').send({}).expect(422);
    });

    test('redefinir: troca a senha, a antiga deixa de funcionar e não há login automático', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        const resposta = await redefinir(token).expect(200);
        assert.deepEqual(resposta.body, { mensagem: 'Senha alterada. Entre com a nova senha.' });

        await loginCliente(cliente, SENHA_ANTIGA).expect(401);
        const entrou = await loginCliente(cliente, SENHA_NOVA).expect(200);
        assert.ok(entrou.body.token);
        const [registro] = await linhas(cliente.usuario.id_usuario);
        assert.ok(registro.usado_em);
        const [[usuario]] = await sequelize.query('SELECT senha FROM usuarios WHERE id_usuario = ?', { replacements: [cliente.usuario.id_usuario] });
        assert.match(usuario.senha, /^\$2b\$12\$/);
    });

    test('JWT emitido antes da redefinição é recusado', async () => {
        const cliente = await novoCliente();
        await request(app).get('/api/v1/auth/me').set('Authorization', cliente.auth).expect(200);
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        // O iat do JWT é em segundos: espera virar o segundo para o token ficar claramente anterior à troca.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await redefinir(token).expect(200);
        await request(app).get('/api/v1/auth/me').set('Authorization', cliente.auth).expect(401);
    });

    test('equipe também redefine pelo link', async () => {
        const funcionario = await criarUsuario('equipe', { senha: await bcrypt.hash(SENHA_ANTIGA, 4) });
        const { token } = (await gerarParaEquipe(funcionario).expect(201)).body;
        await redefinir(token).expect(200);
        await request(app).post('/api/v1/auth/login').send({ identificador: funcionario.usuario.email, senha: SENHA_NOVA }).expect(200);
    });

    test('uso duplo do mesmo token: a segunda tentativa é TOKEN_INVALIDO', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        await redefinir(token).expect(200);
        assert.equal((await redefinir(token, 'Outra@Senha456').expect(422)).body.codigo, 'TOKEN_INVALIDO');
        assert.deepEqual((await validar(token).expect(200)).body, { valido: false });
        await loginCliente(cliente, SENHA_NOVA).expect(200);
    });

    test('três requisições simultâneas com o mesmo token: só uma vence', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        const respostas = await Promise.all([
            redefinir(token, 'Primeira@Senha1'), redefinir(token, 'Segunda@Senha2'), redefinir(token, 'Terceira@Senha3')
        ]);
        assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 422, 422]);
    });

    test('token expirado (ajustado direto no banco)', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        await sequelize.query('UPDATE redefinicoes_senha SET expira_em = NOW() - INTERVAL 1 MINUTE WHERE id_usuario = ?', { replacements: [cliente.usuario.id_usuario] });
        assert.deepEqual((await validar(token).expect(200)).body, { valido: false });
        assert.equal((await redefinir(token).expect(422)).body.codigo, 'TOKEN_INVALIDO');
        await loginCliente(cliente, SENHA_NOVA).expect(401);
    });

    test('senha curta ou longa: 422 VALIDACAO com detalhe por campo, e o token continua valendo', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        for (const senha of ['curta', 'x'.repeat(73), null, 12345678]) {
            const resposta = await redefinir(token, senha).expect(422);
            assert.equal(resposta.body.codigo, 'VALIDACAO');
            assert.ok(resposta.body.detalhes.some((d) => d.campo === 'nova_senha'));
        }
        const semToken = await request(app).post('/api/v1/auth/redefinir-senha').send({ nova_senha: SENHA_NOVA }).expect(422);
        assert.ok(semToken.body.detalhes.some((d) => d.campo === 'token'));
        assert.deepEqual((await validar(token).expect(200)).body, { valido: true });
        await redefinir(token).expect(200);
    });

    test('usuário inativo depois de gerar o link: token recusado', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        await sequelize.query('UPDATE usuarios SET ativo = FALSE WHERE id_usuario = ?', { replacements: [cliente.usuario.id_usuario] });
        assert.deepEqual((await validar(token).expect(200)).body, { valido: false });
        assert.equal((await redefinir(token).expect(422)).body.codigo, 'TOKEN_INVALIDO');
    });

    test('inexistente, usado, expirado e de usuário inativo: resposta idêntica', async () => {
        const usado = await novoCliente();
        const tokenUsado = (await gerarParaCliente(usado).expect(201)).body.token;
        await redefinir(tokenUsado).expect(200);
        const expirado = await novoCliente();
        const tokenExpirado = (await gerarParaCliente(expirado).expect(201)).body.token;
        await sequelize.query('UPDATE redefinicoes_senha SET expira_em = NOW() - INTERVAL 1 MINUTE WHERE id_usuario = ?', { replacements: [expirado.usuario.id_usuario] });
        const inativo = await novoCliente();
        const tokenInativo = (await gerarParaCliente(inativo).expect(201)).body.token;
        await sequelize.query('UPDATE usuarios SET ativo = FALSE WHERE id_usuario = ?', { replacements: [inativo.usuario.id_usuario] });

        for (const token of ['A'.repeat(43), tokenUsado, tokenExpirado, tokenInativo]) {
            const resposta = await redefinir(token, 'Qualquer@Senha1').expect(422);
            assert.deepEqual(semRequestId(resposta.body), { sucesso: false, mensagem: MENSAGEM_INVALIDO, codigo: 'TOKEN_INVALIDO' });
        }
    });
});

describe('auditoria e log', () => {
    test('a trilha registra a geração e o uso sem token, hash nem senha', async () => {
        const cliente = await novoCliente();
        const { token } = (await gerarParaCliente(cliente).expect(201)).body;
        await redefinir(token).expect(200);
        const funcionario = await criarUsuario('equipe');
        const tokenEquipe = (await gerarParaEquipe(funcionario).expect(201)).body.token;

        const [auditoria] = await sequelize.query("SELECT * FROM auditoria WHERE acao LIKE '%redefinicao_senha%' OR acao LIKE '%senha_redefinida%' ORDER BY id_auditoria");
        const acoes = auditoria.map((a) => a.acao);
        for (const esperada of ['cliente.redefinicao_senha_gerada', 'usuario.redefinicao_senha_gerada', 'usuario.senha_redefinida_por_link']) {
            assert.ok(acoes.includes(esperada), esperada);
        }
        const gerada = auditoria.find((a) => a.acao === 'cliente.redefinicao_senha_gerada' && a.id_entidade === String(cliente.usuario.id_usuario));
        const resumo = typeof gerada.resumo === 'string' ? JSON.parse(gerada.resumo) : gerada.resumo;
        assert.ok(resumo.detalhe.expira_em);
        const [hashes] = await sequelize.query('SELECT token_hash FROM redefinicoes_senha');
        const tudo = JSON.stringify(auditoria);
        for (const segredo of [token, tokenEquipe, SENHA_NOVA, ...hashes.map((h) => h.token_hash)]) {
            assert.ok(!tudo.includes(segredo), 'a trilha não pode conter token, hash nem senha');
        }
    });

    test('o registro de requisições e o tratador de erros não leem o corpo (o token viaja no corpo do POST)', () => {
        for (const arquivo of ['../middlewares/requisicao', '../middlewares/seguranca', '../lib/logger']) {
            assert.ok(!/req\.body/.test(fs.readFileSync(require.resolve(arquivo), 'utf8')), `${arquivo} não deve ler req.body`);
        }
    });
});

describe('limitador das rotas públicas', () => {
    const { criarLimitadorRedefinicaoPublica } = require('../middlewares/seguranca');

    test('conta só as falhas (inclusive valido:false); quem acerta não é bloqueado', async () => {
        const mini = express();
        mini.use(express.json());
        mini.post('/x', criarLimitadorRedefinicaoPublica(3), (req, res) => {
            if (req.body.ruim) res.locals.tokenInvalido = true;
            return res.status(200).json({ valido: !req.body.ruim });
        });
        for (let i = 0; i < 5; i += 1) await request(mini).post('/x').send({ ruim: false }).expect(200);
        for (let i = 0; i < 3; i += 1) await request(mini).post('/x').send({ ruim: true }).expect(200);
        const barrado = await request(mini).post('/x').send({ ruim: false }).expect(429);
        assert.equal(barrado.body.codigo, 'MUITAS_TENTATIVAS');
    });
});

describe('limpeza', () => {
    test('apaga links expirados ou usados há mais de 7 dias, em lotes, e preserva os recentes', async () => {
        const { limparRedefinicoesAntigas } = require('../servicos/redefinicaoSenha');
        const cliente = await novoCliente();
        const id = cliente.usuario.id_usuario;
        await sequelize.query('DELETE FROM redefinicoes_senha');
        const inserir = (letra, expira, usado) => sequelize.query(
            `INSERT INTO redefinicoes_senha (id_usuario, token_hash, expira_em, usado_em) VALUES (?, ?, ${expira}, ${usado})`,
            { replacements: [id, letra.repeat(64)] }
        );
        await inserir('a', 'NOW() - INTERVAL 8 DAY', 'NULL'); // expirado há 8 dias: apaga
        await inserir('b', 'NOW() - INTERVAL 8 DAY', 'NOW() - INTERVAL 8 DAY'); // usado há 8 dias: apaga
        await inserir('c', 'NOW() + INTERVAL 1 DAY', 'NOW() - INTERVAL 9 DAY'); // usado há 9 dias: apaga
        await inserir('d', 'NOW() - INTERVAL 1 DAY', 'NULL'); // expirou ontem: fica
        await inserir('e', 'NOW() + INTERVAL 1 HOUR', 'NOW() - INTERVAL 1 DAY'); // usado ontem: fica
        await inserir('f', 'NOW() + INTERVAL 1 HOUR', 'NULL'); // pendente: fica
        const resultado = await limparRedefinicoesAntigas({ tamanhoLote: 1 });
        assert.equal(resultado.removidos, 3);
        const restantes = (await sequelize.query('SELECT LEFT(token_hash, 1) h FROM redefinicoes_senha ORDER BY h'))[0].map((r) => r.h);
        assert.deepEqual(restantes, ['d', 'e', 'f']);
    });

    test('o job limpeza-eventos chama a limpeza e devolve os dois relatórios', async () => {
        const jobs = require('../jobs');
        const resultado = await jobs.buscarDefinicao('limpeza-eventos').executar();
        assert.equal(typeof resultado.removidos, 'number');
        assert.equal(typeof resultado.redefinicoes_senha.removidos, 'number');
    });
});

describe('usuário apagado', () => {
    test('os links caem junto com o usuário (ON DELETE CASCADE)', async () => {
        const cliente = await novoCliente();
        await gerarParaCliente(cliente).expect(201);
        await sequelize.query('DELETE FROM usuarios WHERE id_usuario = ?', { replacements: [cliente.usuario.id_usuario] });
        assert.equal((await linhas(cliente.usuario.id_usuario)).length, 0);
    });
});
