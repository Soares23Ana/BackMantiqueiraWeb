const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;

const MENSAGEM = 'Se o CNPJ estiver cadastrado, a equipe da Mantiqueira vai entrar em contato pelo WhatsApp para enviar o link.';
const SENHA_NOVA = 'Nova@Senha123';

// CNPJs válidos e únicos (14 dígitos com os dígitos verificadores corretos).
let contadorCnpj = 0;
function cnpjNovo() {
    contadorCnpj += 1;
    const digitos = `8${String(contadorCnpj).padStart(7, '0')}0001`.split('').map(Number);
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
const solicitar = (documento) => request(app).post('/api/v1/auth/redefinicao-senha/solicitar').send({ documento });
const doEquipe = (req) => req.set('Authorization', equipe.auth);
const listar = (query = '') => doEquipe(request(app).get(`/api/v1/redefinicoes-senha/pedidos${query}`));
const contador = async () => (await doEquipe(request(app).get('/api/v1/painel/contadores')).expect(200)).body.redefinicoes_pendentes;
const limpar = () => sequelize.query('DELETE FROM pedidos_redefinicao_senha');
const pedidosDe = async (idUsuario) => {
    const { PedidoRedefinicaoSenha } = require('../models');
    return PedidoRedefinicaoSenha.findAll({ where: { id_usuario: idUsuario }, order: [['id_pedido', 'ASC']] });
};
const pedidoPendente = async (cliente) => {
    await solicitar(cliente.usuario.cnpj).expect(200);
    return (await pedidosDe(cliente.usuario.id_usuario)).find((p) => p.status === 'pendente');
};
const tokenDoLink = (link) => new URL(link).searchParams.get('token');

before(async () => {
    ({ app, sequelize } = await prepararApp());
    equipe = await criarUsuario('equipe');
});

after(async () => {
    await sequelize.close();
});

describe('POST /auth/redefinicao-senha/solicitar (público): resposta sempre igual', () => {
    test('CNPJ de cliente ativo, inexistente, de cliente inativo e de conta da equipe: mesmo status e mesmo corpo', async () => {
        const ativo = await novoCliente();
        const inativo = await novoCliente({ ativo: false });
        const conta = await criarUsuario('equipe', { cnpj: cnpjNovo() });
        const respostas = [];
        for (const cnpj of [ativo.usuario.cnpj, cnpjNovo(), inativo.usuario.cnpj, conta.usuario.cnpj]) {
            const r = await solicitar(cnpj);
            respostas.push({ status: r.status, corpo: r.body });
        }
        assert.ok(respostas.every((r) => r.status === 200));
        assert.deepEqual(respostas[0].corpo, { mensagem: MENSAGEM });
        for (const r of respostas) assert.deepEqual(r, respostas[0]);

        assert.equal((await pedidosDe(ativo.usuario.id_usuario)).length, 1);
        assert.equal((await pedidosDe(inativo.usuario.id_usuario)).length, 0);
        assert.equal((await pedidosDe(conta.usuario.id_usuario)).length, 0);
    });

    test('aceita o CNPJ com pontuação', async () => {
        const cliente = await novoCliente();
        const c = cliente.usuario.cnpj;
        await solicitar(`${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`).expect(200);
        assert.equal((await pedidosDe(cliente.usuario.id_usuario)).length, 1);
    });

    test('pedido repetido não duplica: só renova o criado_em do pendente', async () => {
        const cliente = await novoCliente();
        await solicitar(cliente.usuario.cnpj).expect(200);
        const [antes] = await pedidosDe(cliente.usuario.id_usuario);
        await sequelize.query('UPDATE pedidos_redefinicao_senha SET criado_em = NOW() - INTERVAL 2 DAY WHERE id_pedido = ?', { replacements: [antes.id_pedido] });
        await solicitar(cliente.usuario.cnpj).expect(200);
        await solicitar(cliente.usuario.cnpj).expect(200);
        const depois = await pedidosDe(cliente.usuario.id_usuario);
        assert.equal(depois.length, 1);
        assert.equal(depois[0].id_pedido, antes.id_pedido);
        assert.ok(Date.now() - depois[0].criado_em.getTime() < 60 * 1000, 'o criado_em foi renovado');
    });

    test('formato inválido, corpo errado ou campo extra: 422 de validação (isso não revela se o CNPJ existe)', async () => {
        for (const corpo of [{}, { documento: '' }, { documento: '123' }, { documento: 'abc' }, { documento: 42 }, { documento: cnpjNovo(), senha: 'x' }]) {
            const r = await request(app).post('/api/v1/auth/redefinicao-senha/solicitar').send(corpo).expect(422);
            assert.equal(r.body.codigo, 'VALIDACAO');
        }
        const dv = cnpjNovo().slice(0, 13) + '0';
        await solicitar(dv.slice(0, 13) + (dv.endsWith('0') && cnpjNovo().endsWith('0') ? '1' : '9')).expect(422);
    });

    test('a rota antiga não existe mais', async () => {
        await request(app).post('/api/v1/auth/solicitar-redefinicao').send({ cnpj: cnpjNovo() }).expect(404);
    });
});

describe('limites de taxa do pedido público', () => {
    const { criarLimitadorPedidoSenhaIp, criarLimitadorPedidoSenhaCnpj } = require('../middlewares/seguranca');

    const miniApp = (...limitadores) => {
        const mini = express();
        mini.use(express.json());
        mini.post('/x', ...limitadores, (req, res) => res.status(200).json({ ok: true }));
        return mini;
    };

    test('por IP: conta todos os pedidos e responde 429 MUITAS_TENTATIVAS acima do limite', async () => {
        const mini = miniApp(criarLimitadorPedidoSenhaIp(3));
        for (let i = 0; i < 3; i += 1) await request(mini).post('/x').send({ documento: cnpjNovo() }).expect(200);
        const barrado = await request(mini).post('/x').send({ documento: cnpjNovo() }).expect(429);
        assert.equal(barrado.body.codigo, 'MUITAS_TENTATIVAS');
    });

    test('por CNPJ: o limite vale para o mesmo documento (com ou sem pontuação), não para os outros', async () => {
        const mini = miniApp(criarLimitadorPedidoSenhaCnpj(2));
        const c = cnpjNovo();
        const formatado = `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
        await request(mini).post('/x').send({ documento: c }).expect(200);
        await request(mini).post('/x').send({ documento: formatado }).expect(200);
        const barrado = await request(mini).post('/x').send({ documento: c }).expect(429);
        assert.equal(barrado.body.codigo, 'MUITAS_TENTATIVAS');
        await request(mini).post('/x').send({ documento: cnpjNovo() }).expect(200);
    });

    test('o limite por CNPJ vale também para um CNPJ que não existe (não revela nada)', async () => {
        const mini = miniApp(criarLimitadorPedidoSenhaCnpj(1));
        const inexistente = cnpjNovo();
        await request(mini).post('/x').send({ documento: inexistente }).expect(200);
        await request(mini).post('/x').send({ documento: inexistente }).expect(429);
    });

    test('os limites padrão e a configuração: 5 por IP a cada 15 min e 3 por CNPJ por hora', () => {
        const { validarAmbiente } = require('../config/ambiente');
        const base = { JWT_SECRET: 'x'.repeat(40), NODE_ENV: 'development' };
        const { config, erros } = validarAmbiente(base);
        assert.deepEqual(erros, []);
        assert.equal(config.pedidoSenha.limiteIp, 5);
        assert.equal(config.pedidoSenha.limiteCnpj, 3);
        const ajustado = validarAmbiente({ ...base, PEDIDO_SENHA_LIMITE_IP: '8', PEDIDO_SENHA_LIMITE_CNPJ: '2' });
        assert.equal(ajustado.config.pedidoSenha.limiteIp, 8);
        assert.equal(ajustado.config.pedidoSenha.limiteCnpj, 2);
        assert.ok(validarAmbiente({ ...base, PEDIDO_SENHA_LIMITE_IP: '0' }).erros.length > 0);
        assert.ok(validarAmbiente({ ...base, SITE_URL: 'https://site.com.br/caminho' }).erros.length > 0);
        assert.equal(validarAmbiente({ ...base, SITE_URL: 'https://www.site.com.br/' }).config.siteUrl, 'https://www.site.com.br');
    });
});

describe('autorização das rotas da equipe', () => {
    test('cliente comum recebe 403 e quem não entrou recebe 401, nas três rotas', async () => {
        const cliente = await novoCliente();
        const pedido = await pedidoPendente(await novoCliente());
        const rotas = [
            ['get', '/api/v1/redefinicoes-senha/pedidos'],
            ['post', `/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`],
            ['post', `/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/dispensar`]
        ];
        for (const [metodo, rota] of rotas) {
            await request(app)[metodo](rota).set('Authorization', cliente.auth).expect(403);
            await request(app)[metodo](rota).expect(401);
        }
        assert.equal((await pedidosDe(pedido.id_usuario))[0].status, 'pendente');
    });
});

describe('GET /redefinicoes-senha/pedidos', () => {
    test('lista só os pendentes por padrão, com os dados do cliente e sem token nem link', async () => {
        await limpar();
        const a = await novoCliente({ razao_social: 'Primeiro LTDA' });
        const b = await novoCliente({ razao_social: 'Segundo LTDA' });
        const c = await novoCliente({ razao_social: 'Terceiro LTDA' });
        await pedidoPendente(a);
        await pedidoPendente(b);
        const pedidoC = await pedidoPendente(c);
        await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedidoC.id_pedido}/dispensar`)).expect(200);

        const { body } = await listar().expect(200);
        assert.deepEqual(body.pedidos.map((p) => p.cliente.nome_exibicao), ['Primeiro LTDA', 'Segundo LTDA']);
        assert.deepEqual(body.paginacao, { total: 2, pagina: 1, limite: 20, total_paginas: 1 });
        const item = body.pedidos[0];
        assert.equal(item.status, 'pendente');
        assert.ok(item.criado_em);
        assert.equal(item.cliente.id_usuario, a.usuario.id_usuario);
        assert.match(item.cliente.cnpj, /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
        assert.equal(item.cliente.telefone, '19999990000');
        const texto = JSON.stringify(body);
        assert.doesNotMatch(texto, /token|link|redefinir-senha\?/i);
    });

    test('filtra por status, valida o status e pagina', async () => {
        const dispensados = (await listar('?status=dispensado').expect(200)).body;
        assert.equal(dispensados.paginacao.total, 1);
        assert.equal(dispensados.pedidos[0].cliente.nome_exibicao, 'Terceiro LTDA');
        assert.equal((await listar('?status=pendente&limite=1').expect(200)).body.pedidos.length, 1);
        assert.equal((await listar('?status=pendente&limite=1').expect(200)).body.paginacao.total_paginas, 2);
        await listar('?status=qualquer').expect(400);
    });

    test('o contador do menu (/painel/contadores) traz redefinicoes_pendentes', async () => {
        assert.equal(await contador(), 2);
    });
});

describe('POST /redefinicoes-senha/pedidos/:id/enviar-link', () => {
    test('gera o link, devolve telefone com DDI 55 e a mensagem pronta, e marca o pedido como atendido', async () => {
        await limpar();
        const cliente = await novoCliente({ razao_social: 'Mercado Bom Preço LTDA', telefone: '(19) 99999-0000' });
        const pedido = await pedidoPendente(cliente);
        const r = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`)).expect(201);

        assert.match(r.body.link, /^http:\/\/127\.0\.0\.1:\d+\/redefinir-senha\?token=[A-Za-z0-9_-]{43}$|^http:\/\/[^/]+\/redefinir-senha\?token=[A-Za-z0-9_-]{43}$/);
        assert.ok(new Date(r.body.expira_em).getTime() > Date.now());
        assert.equal(r.body.telefone_whatsapp, '5519999990000');
        assert.equal(r.body.aviso, undefined);
        assert.ok(r.body.mensagem.includes(r.body.link));
        assert.match(r.body.mensagem, /60 minutos/);
        assert.match(r.body.mensagem, /^Olá, Mercado!/);

        const atualizado = (await pedidosDe(cliente.usuario.id_usuario))[0];
        assert.equal(atualizado.status, 'atendido');
        assert.ok(atualizado.atendido_em);
        assert.equal(atualizado.atendido_por, equipe.usuario.id_usuario);
        assert.equal(await contador(), 0);
    });

    test('o link funciona de ponta a ponta: POST /auth/redefinir-senha com o token do link', async () => {
        await limpar();
        const cliente = await novoCliente();
        const pedido = await pedidoPendente(cliente);
        const { body } = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`)).expect(201);
        const token = tokenDoLink(body.link);
        assert.equal((await request(app).post('/api/v1/auth/redefinir-senha/validar').send({ token }).expect(200)).body.valido, true);
        await request(app).post('/api/v1/auth/redefinir-senha').send({ token, nova_senha: SENHA_NOVA }).expect(200);
        const login = await request(app).post('/api/v1/auth/login').send({ identificador: cliente.usuario.cnpj, senha: SENHA_NOVA }).expect(200);
        assert.ok(login.body.token);
        // o link é de uso único
        await request(app).post('/api/v1/auth/redefinir-senha').send({ token, nova_senha: 'Outra@Senha123' }).expect(422);
    });

    test('segunda chamada para o mesmo pedido: 409 PEDIDO_NAO_PENDENTE; pedido inexistente: 404', async () => {
        await limpar();
        const pedido = await pedidoPendente(await novoCliente());
        const rota = `/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`;
        await doEquipe(request(app).post(rota)).expect(201);
        const repetido = await doEquipe(request(app).post(rota)).expect(409);
        assert.equal(repetido.body.codigo, 'PEDIDO_NAO_PENDENTE');
        await doEquipe(request(app).post('/api/v1/redefinicoes-senha/pedidos/999999/enviar-link')).expect(404);
        await doEquipe(request(app).post('/api/v1/redefinicoes-senha/pedidos/abc/enviar-link')).expect(404);
    });

    test('invalida o link anterior do cliente (gerarLink) e usa a origem do front quando não há SITE_URL', async () => {
        await limpar();
        const cliente = await novoCliente();
        const primeiro = await doEquipe(request(app).post(`/api/v1/clientes/${cliente.usuario.id_usuario}/redefinicao-senha`)).expect(201);
        const pedido = await pedidoPendente(cliente);
        // a rota antiga marcou "nada" (ainda não havia pedido); agora o pedido está pendente
        const { body } = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`)
            .set('Origin', 'https://www.mantiqueira.exemplo')).expect(201);
        assert.ok(body.link.startsWith('https://www.mantiqueira.exemplo/redefinir-senha?token='));
        assert.equal((await request(app).post('/api/v1/auth/redefinir-senha/validar').send({ token: primeiro.body.token }).expect(200)).body.valido, false);
    });

    test('telefone que não dá para normalizar: telefone_whatsapp nulo e aviso claro (o link continua sendo gerado)', async () => {
        await limpar();
        const cliente = await novoCliente({ telefone: '12345' });
        const pedido = await pedidoPendente(cliente);
        const { body } = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`)).expect(201);
        assert.equal(body.telefone_whatsapp, null);
        assert.match(body.aviso, /telefone/i);
        assert.ok(body.link.includes('/redefinir-senha?token='));
        assert.equal((await pedidosDe(cliente.usuario.id_usuario))[0].status, 'atendido');
    });

    test('cliente que ficou inativo depois do pedido: 409 USUARIO_INATIVO e o pedido continua pendente', async () => {
        await limpar();
        const cliente = await novoCliente();
        const pedido = await pedidoPendente(cliente);
        await cliente.usuario.update({ ativo: false });
        const r = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`)).expect(409);
        assert.equal(r.body.codigo, 'USUARIO_INATIVO');
        assert.equal((await pedidosDe(cliente.usuario.id_usuario))[0].status, 'pendente');
    });
});

describe('POST /redefinicoes-senha/pedidos/:id/dispensar', () => {
    test('marca como dispensado, tira do contador e dá 409 na segunda vez ou depois de atendido', async () => {
        await limpar();
        const cliente = await novoCliente();
        const pedido = await pedidoPendente(cliente);
        assert.equal(await contador(), 1);
        const r = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/dispensar`)).expect(200);
        assert.equal(r.body.status, 'dispensado');
        assert.equal(await contador(), 0);
        const repetido = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/dispensar`)).expect(409);
        assert.equal(repetido.body.codigo, 'PEDIDO_NAO_PENDENTE');
        await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedido.id_pedido}/enviar-link`)).expect(409);
        // depois de dispensado, um novo pedido do mesmo cliente volta a ser pendente
        await solicitar(cliente.usuario.cnpj).expect(200);
        assert.equal(await contador(), 1);
        assert.equal((await pedidosDe(cliente.usuario.id_usuario)).length, 2);
    });
});

describe('rotas antigas continuam funcionando e atendem o pedido', () => {
    test('POST /clientes/:id/redefinicao-senha e PUT /clientes/:id/senha marcam o pedido pendente como atendido', async () => {
        await limpar();
        const a = await novoCliente();
        const b = await novoCliente();
        await pedidoPendente(a);
        await pedidoPendente(b);
        assert.equal(await contador(), 2);
        const gerado = await doEquipe(request(app).post(`/api/v1/clientes/${a.usuario.id_usuario}/redefinicao-senha`)).expect(201);
        assert.deepEqual(Object.keys(gerado.body).sort(), ['expira_em', 'mensagem', 'token']);
        await doEquipe(request(app).put(`/api/v1/clientes/${b.usuario.id_usuario}/senha`)).send({ senha: 'Temporaria@123' }).expect(200);
        assert.equal(await contador(), 0);
        assert.equal((await pedidosDe(a.usuario.id_usuario))[0].status, 'atendido');
        assert.equal((await pedidosDe(b.usuario.id_usuario))[0].status, 'atendido');
    });

    test('quando o cliente troca a senha com o link, o pedido pendente também é atendido', async () => {
        await limpar();
        const cliente = await novoCliente();
        const { body } = await doEquipe(request(app).post(`/api/v1/clientes/${cliente.usuario.id_usuario}/redefinicao-senha`)).expect(201);
        await pedidoPendente(cliente);
        await request(app).post('/api/v1/auth/redefinir-senha').send({ token: body.token, nova_senha: SENHA_NOVA }).expect(200);
        assert.equal(await contador(), 0);
    });
});

describe('telefone para o WhatsApp', () => {
    const { telefoneWhatsapp } = require('../servicos/pedidosRedefinicaoSenha');

    test('normaliza para só dígitos com DDI 55', () => {
        assert.equal(telefoneWhatsapp('(19) 99999-0000'), '5519999990000');
        assert.equal(telefoneWhatsapp('19999990000'), '5519999990000');
        assert.equal(telefoneWhatsapp('1936330000'), '551936330000');
        assert.equal(telefoneWhatsapp('+55 (19) 99999-0000'), '5519999990000');
        assert.equal(telefoneWhatsapp('5519999990000'), '5519999990000');
        assert.equal(telefoneWhatsapp('019 99999-0000'), '5519999990000');
    });

    test('devolve nulo quando não dá para normalizar', () => {
        for (const ruim of [null, undefined, '', '12345', '99999-0000', '0000000000', '00999990000', 'sem telefone']) {
            assert.equal(telefoneWhatsapp(ruim), null, `esperava nulo para ${JSON.stringify(ruim)}`);
        }
    });
});

describe('limpeza: expirar pendentes e apagar resolvidos', () => {
    test('pendente com mais de 7 dias vira expirado; resolvido com mais de 30 dias é apagado; o resto fica', async () => {
        const { limparPedidosAntigos } = require('../servicos/pedidosRedefinicaoSenha');
        const { PedidoRedefinicaoSenha } = require('../models');
        await limpar();
        const clientes = [];
        for (let i = 0; i < 6; i += 1) clientes.push(await novoCliente());
        const criar = (cliente, status, diasCriado, diasAtualizado) => PedidoRedefinicaoSenha.create({
            id_usuario: cliente.usuario.id_usuario, status, criado_em: new Date(Date.now() - diasCriado * 86400000), atualizado_em: new Date(Date.now() - diasAtualizado * 86400000)
        });
        const velhoPendente = await criar(clientes[0], 'pendente', 8, 8);
        const novoPendente = await criar(clientes[1], 'pendente', 2, 2);
        const atendidoAntigo = await criar(clientes[2], 'atendido', 40, 31);
        const dispensadoAntigo = await criar(clientes[3], 'dispensado', 40, 32);
        const expiradoAntigo = await criar(clientes[4], 'expirado', 60, 31);
        const atendidoRecente = await criar(clientes[5], 'atendido', 40, 5);

        const relatorio = await limparPedidosAntigos({ tamanhoLote: 2 });
        assert.equal(relatorio.pedidos_expirados, 1);
        assert.equal(relatorio.pedidos_removidos, 3);
        const restantes = (await PedidoRedefinicaoSenha.findAll({ order: [['id_pedido', 'ASC']] })).map((p) => [p.id_pedido, p.status]);
        assert.deepEqual(restantes, [[velhoPendente.id_pedido, 'expirado'], [novoPendente.id_pedido, 'pendente'], [atendidoRecente.id_pedido, 'atendido']]);
        assert.ok(![atendidoAntigo, dispensadoAntigo, expiradoAntigo].some((p) => restantes.some(([id]) => id === p.id_pedido)));
    });

    test('o job de limpeza (limparRedefinicoesAntigas) inclui os números dos pedidos no relatório', async () => {
        const { limparRedefinicoesAntigas } = require('../servicos/redefinicaoSenha');
        const relatorio = await limparRedefinicoesAntigas();
        for (const campo of ['removidos', 'pedidos_expirados', 'pedidos_removidos']) assert.equal(typeof relatorio[campo], 'number', campo);
    });
});

describe('auditoria sem token nem link', () => {
    test('registra pedido criado, link enviado e pedido dispensado, sem nada sensível', async () => {
        const { Auditoria } = require('../models');
        await sequelize.query('DELETE FROM auditoria');
        await limpar();
        const a = await novoCliente();
        const b = await novoCliente();
        const pedidoA = await pedidoPendente(a);
        const pedidoB = await pedidoPendente(b);
        const enviado = await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedidoA.id_pedido}/enviar-link`)).expect(201);
        await doEquipe(request(app).post(`/api/v1/redefinicoes-senha/pedidos/${pedidoB.id_pedido}/dispensar`)).expect(200);

        const linhas = await Auditoria.findAll({ where: { acao: ['pedido_senha.criado', 'pedido_senha.link_enviado', 'pedido_senha.dispensado'] }, order: [['id_auditoria', 'ASC']] });
        assert.deepEqual(linhas.map((l) => l.acao), ['pedido_senha.criado', 'pedido_senha.criado', 'pedido_senha.link_enviado', 'pedido_senha.dispensado']);
        assert.equal(linhas[0].id_usuario, null); // o pedido público não tem usuário logado
        assert.equal(linhas[2].id_usuario, equipe.usuario.id_usuario);
        const texto = JSON.stringify(linhas.map((l) => l.toJSON()));
        assert.ok(!texto.includes(tokenDoLink(enviado.body.link)));
        assert.doesNotMatch(texto, /redefinir-senha\?token|"token"|"link"|cnpj/i);
        assert.ok(!texto.includes(a.usuario.cnpj));
    });
});
