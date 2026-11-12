const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

let app;
let sequelize;
let gestor;
let equipeA;
let equipeB;
let cliente;
let Auditoria;
const p = {};

before(async () => {
    ({ app, sequelize } = await prepararApp());
    const { Produto, Endereco } = require('../models');
    ({ Auditoria } = require('../models'));
    gestor = await criarUsuario('equipe', { nome: 'Gestora', pode_gerenciar_equipe: true });
    equipeA = await criarUsuario('equipe', { nome: 'Equipe A' });
    equipeB = await criarUsuario('equipe', { nome: 'Equipe B' });
    cliente = await criarUsuario('cliente', { nome: 'Cliente Notas', razao_social: 'Notas Ltda', cnpj: '11222333000181' });
    await Endereco.create({
        id_usuario: cliente.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
        bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
    });
    p.a = (await Produto.create({ sku: 'SUP-A', nome: 'Produto Suporte', quantidade_estoque: 10, preco: 9.9 })).id_produto;
});

after(async () => {
    await sequelize.close();
});

const api = (metodo, url, usuario) => {
    const req = request(app)[metodo](`/api/v1${url}`);
    return usuario ? req.set('Authorization', usuario.auth) : req;
};
const idCliente = () => cliente.usuario.id_usuario;
const trilha = async (query = '') => (await api('get', `/auditoria${query}`, gestor).expect(200)).body;

describe('notas por cliente', () => {
    const ids = {};

    test('só a equipe lê e escreve', async () => {
        await api('get', `/clientes/${idCliente()}/notas`).expect(401);
        await api('get', `/clientes/${idCliente()}/notas`, cliente).expect(403);
        await api('post', `/clientes/${idCliente()}/notas`, cliente).send({ texto: 'x' }).expect(403);
    });

    test('cria, lista (mais recente primeiro) com o autor e valida o texto', async () => {
        const primeira = await api('post', `/clientes/${idCliente()}/notas`, equipeA).send({ texto: '  Pediu retorno na segunda.  ' }).expect(201);
        assert.equal(primeira.body.nota.texto, 'Pediu retorno na segunda.');
        assert.deepEqual(primeira.body.nota.autor, { id_usuario: equipeA.usuario.id_usuario, nome: 'Equipe A' });
        assert.equal(primeira.body.nota.pode_excluir, true);
        ids.a = primeira.body.nota.id_nota;
        ids.b = (await api('post', `/clientes/${idCliente()}/notas`, equipeB).send({ texto: 'Segunda nota' }).expect(201)).body.nota.id_nota;

        const lista = await api('get', `/clientes/${idCliente()}/notas`, equipeA).expect(200);
        assert.deepEqual(lista.body.notas.map((n) => n.texto), ['Segunda nota', 'Pediu retorno na segunda.']);
        assert.deepEqual(lista.body.notas.map((n) => n.pode_excluir), [false, true]);
        assert.equal(lista.body.paginacao.total, 2);

        await api('post', `/clientes/${idCliente()}/notas`, equipeA).send({ texto: 'a'.repeat(1000) }).expect(201);
        for (const corpo of [{}, { texto: '   ' }, { texto: 'a'.repeat(1001) }, { texto: 5 }, { texto: 'ok', extra: 1 }]) {
            await api('post', `/clientes/${idCliente()}/notas`, equipeA).send(corpo).expect(422);
        }
        await api('post', '/clientes/999999/notas', equipeA).send({ texto: 'x' }).expect(404);
        await api('get', '/clientes/999999/notas', equipeA).expect(404);
        // Equipe não é cliente: id de equipe não tem notas.
        await api('get', `/clientes/${equipeA.usuario.id_usuario}/notas`, equipeA).expect(404);
    });

    test('exclui só o autor ou quem gerencia a equipe', async () => {
        await api('delete', `/clientes/${idCliente()}/notas/${ids.a}`, equipeB).expect(403);
        await api('delete', `/clientes/${idCliente()}/notas/${ids.a}`, equipeA).expect(200);
        await api('delete', `/clientes/${idCliente()}/notas/${ids.a}`, equipeA).expect(404);
        // Gestor apaga a nota de outra pessoa.
        const lista = (await api('get', `/clientes/${idCliente()}/notas`, gestor).expect(200)).body.notas;
        assert.ok(lista.every((n) => n.pode_excluir === true));
        await api('delete', `/clientes/${idCliente()}/notas/${ids.b}`, gestor).expect(200);
        // Nota de outro cliente não é alcançada por este id de cliente.
        const outra = await criarUsuario('cliente');
        const nota = (await api('post', `/clientes/${outra.usuario.id_usuario}/notas`, equipeA).send({ texto: 'outra' }).expect(201)).body.nota;
        await api('delete', `/clientes/${idCliente()}/notas/${nota.id_nota}`, equipeA).expect(404);
        await api('delete', `/clientes/${idCliente()}/notas/abc`, equipeA).expect(400);
    });
});

describe('trilha de auditoria', () => {
    test('GET /auditoria só para a equipe', async () => {
        await api('get', '/auditoria').expect(401);
        await api('get', '/auditoria', cliente).expect(403);
    });

    test('produtos: criar, editar, ativar/desativar e ajuste de estoque', async () => {
        const criado = await api('post', '/produtos', equipeA).send({ sku: 'AUD-1', nome: 'Produto auditado', preco: 12.5, quantidade_estoque: 5 }).expect(201);
        const id = criado.body.id_produto;
        await api('patch', `/produtos/${id}`, equipeA).send({ nome: 'Produto auditado 2', multiplo_venda: 6 }).expect(200);
        await api('patch', `/produtos/${id}`, equipeB).send({ ativo: false }).expect(200);
        await api('patch', `/produtos/${id}`, equipeB).send({ ativo: true }).expect(200);
        await api('patch', `/produtos/${id}/estoque`, equipeA).send({ ajuste: -2, observacao: 'Avaria na doca' }).expect(200);
        await api('delete', `/produtos/${id}`, equipeA).expect(200);

        const { registros } = await trilha(`?entidade=produto&id_entidade=${id}`);
        assert.deepEqual(registros.map((r) => r.acao).reverse(),
            ['produto.criar', 'produto.editar', 'produto.desativar', 'produto.ativar', 'produto.estoque', 'produto.desativar']);
        const porAcao = Object.fromEntries(registros.map((r) => [r.acao, r]));
        assert.equal(porAcao['produto.criar'].usuario.nome, 'Equipe A');
        assert.equal(porAcao['produto.criar'].resumo.depois.sku, 'AUD-1');
        assert.deepEqual(porAcao['produto.editar'].resumo.alteracoes, {
            nome: { antes: 'Produto auditado', depois: 'Produto auditado 2' },
            multiplo_venda: { antes: 1, depois: 6 }
        });
        assert.equal(porAcao['produto.ativar'].usuario.nome, 'Equipe B');
        assert.deepEqual(porAcao['produto.estoque'].resumo, {
            alteracoes: { quantidade_estoque: { antes: 5, depois: 3 } },
            detalhe: { observacao: 'Avaria na doca' }
        });
        // Nada financeiro na trilha.
        assert.ok(!JSON.stringify(registros).includes('preco'));
        assert.ok(!JSON.stringify(registros).includes('12.5'));
    });

    test('clientes: edição, bloqueio e senha temporária sem o valor', async () => {
        await api('put', `/clientes/${idCliente()}`, equipeA).send({ telefone: '35999990000' }).expect(200);
        await api('put', `/clientes/${idCliente()}`, equipeA).send({ ativo: false }).expect(200);
        await api('put', `/clientes/${idCliente()}`, equipeA).send({ ativo: true }).expect(200);
        await api('put', `/clientes/${idCliente()}/senha`, equipeA).send({ senha: 'SenhaTemporaria#2026' }).expect(200);

        const { registros } = await trilha(`?entidade=cliente&id_entidade=${idCliente()}`);
        assert.deepEqual(registros.map((r) => r.acao).reverse(), ['cliente.editar', 'cliente.bloquear', 'cliente.desbloquear', 'cliente.senha_temporaria']);
        assert.deepEqual(registros[3].resumo.alteracoes, { telefone: { antes: null, depois: '35999990000' } });
        assert.deepEqual(registros[0].resumo, { detalhe: { credencial_redefinida: true } });
        const texto = JSON.stringify(await trilha('?limite=200'));
        assert.ok(!texto.includes('SenhaTemporaria'));
        assert.ok(!texto.includes('$2b$') && !texto.includes('$2a$'));
    });

    test('pedidos: mudança de status e cancelamento', async () => {
        const { Endereco } = require('../models');
        const comprador = await criarUsuario('cliente');
        await Endereco.create({
            id_usuario: comprador.usuario.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
            bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
        });
        const feito = await api('post', '/pedidos', comprador).send({ itens: [{ id_produto: p.a, quantidade: 2 }] }).expect(201);
        const id = feito.body.pedido.id_pedido;
        await api('put', `/pedidos/${id}/status`, equipeA).send({ status: 'Em Separação', observacao: 'Separando' }).expect(200);
        await api('post', `/pedidos/${id}/cancelar`, equipeB).send({ motivo: 'Cliente desistiu' }).expect(200);
        const { registros } = await trilha(`?entidade=pedido&id_entidade=${id}`);
        assert.deepEqual(registros.map((r) => r.acao).reverse(), ['pedido.status', 'pedido.cancelar']);
        assert.deepEqual(registros[1].resumo, {
            alteracoes: { status: { antes: 'Aguardando Separação', depois: 'Em Separação' } }, detalhe: { observacao: 'Separando' }
        });
        assert.deepEqual(registros[0].resumo.detalhe, { motivo: 'Cliente desistiu' });
        assert.equal(registros[0].usuario.nome, 'Equipe B');
    });

    test('banners, pop-up, campanhas e configurações', async () => {
        const banner = await api('post', '/cms', equipeA).field('titulo', 'Banner auditado').attach('imagem', PNG, { filename: 'b.png', contentType: 'image/png' }).expect(201);
        const idBanner = banner.body.banner.id_banner;
        await api('patch', `/cms/${idBanner}`, equipeA).send({ titulo: 'Banner novo', ativo: false }).expect(200);
        await api('delete', `/cms/${idBanner}`, equipeA).expect(200);
        assert.deepEqual((await trilha(`?entidade=banner&id_entidade=${idBanner}`)).registros.map((r) => r.acao).reverse(), ['banner.criar', 'banner.editar', 'banner.excluir']);

        await api('put', '/cms/blocos/popup', equipeA).send({ titulo: 'Pop' }).expect(200);
        await api('patch', '/cms/blocos/popup', equipeA).send({ ativo: false }).expect(200);
        await api('put', '/cms/blocos/sobre', equipeA).send({ conteudo: 'Quem somos' }).expect(200);
        assert.deepEqual((await trilha('?entidade=popup')).registros.map((r) => r.acao).reverse(), ['popup.salvar', 'popup.desativar']);
        assert.deepEqual((await trilha('?entidade=bloco_cms&id_entidade=sobre')).registros.map((r) => r.acao), ['bloco.salvar']);

        const dia = 86400000;
        const campanha = await api('post', '/campanhas', equipeA).send({
            titulo: 'Campanha auditada', inicio_em: new Date(Date.now() - dia).toISOString(), fim_em: new Date(Date.now() + dia).toISOString(), produtos: [p.a]
        }).expect(201);
        const idCampanha = campanha.body.campanha.id_campanha;
        await api('patch', `/campanhas/${idCampanha}`, equipeA).send({ selo: 'Leve 8 pague 6' }).expect(200);
        await api('delete', `/campanhas/${idCampanha}`, equipeA).expect(200);
        assert.deepEqual((await trilha(`?entidade=campanha&id_entidade=${idCampanha}`)).registros.map((r) => r.acao).reverse(), ['campanha.criar', 'campanha.editar', 'campanha.excluir']);

        await api('put', '/configuracoes/meta_reposicao', equipeA).send({ valor: 80 }).expect(200);
        const config = (await trilha('?entidade=configuracao&id_entidade=meta_reposicao')).registros[0];
        assert.deepEqual(config.resumo.alteracoes, { valor: { antes: '50', depois: '80' } });
    });

    test('contas da equipe: criar e editar, sem senha nem hash', async () => {
        const nova = await api('post', '/admin/usuarios', gestor).send({ nome: 'Nova Pessoa', email: 'nova@teste.com', senha: 'SenhaDaNova#2026', cargo: 'Estoquista' }).expect(201);
        const id = nova.body.usuario.id_usuario;
        await api('patch', `/admin/usuarios/${id}`, gestor).send({ cargo: 'Separadora', senha: 'OutraSenha#2026' }).expect(200);
        await api('patch', `/admin/usuarios/${id}`, gestor).send({ ativo: false }).expect(200);
        const { registros } = await trilha(`?entidade=usuario&id_entidade=${id}`);
        assert.deepEqual(registros.map((r) => r.acao).reverse(), ['equipe.criar', 'equipe.editar', 'equipe.editar']);
        assert.deepEqual(registros[1].resumo, { alteracoes: { cargo: { antes: 'Estoquista', depois: 'Separadora' } }, detalhe: { credencial_redefinida: true } });
        const texto = JSON.stringify(registros);
        assert.ok(!texto.includes('SenhaDaNova') && !texto.includes('OutraSenha') && !texto.includes('$2b$'));
    });

    test('filtros: id_usuario, período e paginação', async () => {
        const doA = await trilha(`?id_usuario=${equipeA.usuario.id_usuario}&limite=200`);
        assert.ok(doA.registros.length > 5);
        assert.ok(doA.registros.every((r) => r.usuario.id_usuario === equipeA.usuario.id_usuario));
        const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
        assert.ok((await trilha(`?de=${hoje}&ate=${hoje}`)).paginacao.total > 0);
        assert.equal((await trilha('?ate=2020-01-01')).paginacao.total, 0);
        assert.equal((await trilha('?de=2999-01-01')).paginacao.total, 0);
        const pagina = await trilha('?limite=2&pagina=2');
        assert.equal(pagina.registros.length, 2);
        assert.ok(pagina.paginacao.total_paginas > 2);
        for (const query of ['?de=ontem', '?id_usuario=abc', '?limite=0', '?de=2026-02-01&ate=2026-01-01']) {
            await api('get', `/auditoria${query}`, gestor).expect(400);
        }
    });

    test('o helper nunca derruba a operação principal, mesmo se a gravação falhar', async () => {
        const original = Auditoria.create;
        Auditoria.create = async () => { throw new Error('banco fora do ar'); };
        try {
            await api('patch', `/produtos/${p.a}`, equipeA).send({ nome: 'Produto Suporte editado' }).expect(200);
            const { registrarAuditoria } = require('../servicos/auditoria');
            await assert.doesNotReject(registrarAuditoria({ usuario: null, acao: 'x', entidade: 'y', depois: { a: 1 } }));
        } finally {
            Auditoria.create = original;
        }
        assert.equal((await require('../models').Produto.findByPk(p.a)).nome, 'Produto Suporte editado');
    });

    test('o helper remove chaves sensíveis em qualquer nível e encurta textos longos', () => {
        const { higienizar, registrarAuditoria } = require('../servicos/auditoria');
        const limpo = higienizar({
            nome: 'ok', senha: 'x', SenhaNova: 'x', hash: 'x', token: 'x', password: 'x',
            aninhado: { token_acesso: 'x', valor: 1, lista: [{ senha_hash: 'x', ok: true }] },
            longo: 'a'.repeat(500)
        });
        assert.deepEqual(Object.keys(limpo).sort(), ['aninhado', 'longo', 'nome']);
        assert.deepEqual(limpo.aninhado, { valor: 1, lista: [{ ok: true }] });
        assert.equal(limpo.longo.length, 201);
        assert.equal(typeof registrarAuditoria, 'function');
    });
});
