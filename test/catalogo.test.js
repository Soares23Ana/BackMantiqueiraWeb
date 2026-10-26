const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario } = require('./ajuda');

const CSV = fs.readFileSync(path.join(__dirname, '..', 'seeds', 'catalogo_inicial.csv'), 'utf8');

let app;
let sequelize;
let importarCatalogo;
let gerente;
let funcionario;
let cliente;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ importarCatalogo } = require('../servicos/importadorCatalogo'));
    // Dois usuários da equipe (cargos diferentes não mudam permissões).
    gerente = await criarUsuario('equipe', { cargo: 'Gerente' });
    funcionario = await criarUsuario('equipe', { cargo: 'Estoquista' });
    cliente = await criarUsuario('cliente');
});

after(async () => {
    await sequelize.close();
});

const listar = (query = '', auth) => {
    const req = request(app).get(`/api/v1/produtos${query}`);
    return auth ? req.set('Authorization', auth) : req;
};
const skus = (resposta) => resposta.body.produtos.map((p) => p.sku).sort();

describe('importação do catálogo inicial (seed)', () => {
    test('simulação não grava nada', async () => {
        const relatorio = await importarCatalogo(CSV, { simular: true });
        assert.equal(relatorio.criados, 38);
        const [[{ total }]] = await sequelize.query('SELECT COUNT(*) AS total FROM produtos');
        assert.equal(total, 0);
    });

    test('importa os 38 produtos, 4 categorias e 7 marcas', async () => {
        const relatorio = await importarCatalogo(CSV);
        assert.equal(relatorio.criados, 38);
        assert.equal(relatorio.com_erro, 0);
        assert.equal(relatorio.categorias_criadas, 4);
        assert.equal(relatorio.marcas_criadas, 7);
        // 36 produtos têm estoque > 0 e geram movimentação de entrada.
        assert.equal(relatorio.movimentacoes_estoque, 36);
    });

    test('rodar de novo não altera nada (idempotente)', async () => {
        const relatorio = await importarCatalogo(CSV);
        assert.equal(relatorio.criados, 0);
        assert.equal(relatorio.atualizados, 0);
        assert.equal(relatorio.inalterados, 38);
        assert.equal(relatorio.movimentacoes_estoque, 0);
    });

    test('valida linha a linha e importa as linhas boas', async () => {
        const conteudo = [
            'sku;nome;estoque;ativo;multiplo_venda;imagem_url',
            'NOVO-1;Produto novo;5;sim;1;/img/x.webp',
            ';Sem SKU;1;sim;1;',
            'NOVO-2;Estoque ruim;-3;sim;1;',
            'NOVO-3;Ativo ruim;1;talvez;1;',
            'NOVO-4;Múltiplo ruim;1;sim;0;',
            'NOVO-5;Imagem ruim;1;sim;1;javascript:alert(1)',
            'NOVO-1;Repetido;1;sim;1;',
            'SKU-NAO-EXISTE;;3;;;'
        ].join('\n');
        const relatorio = await importarCatalogo(conteudo, { simular: true });
        assert.equal(relatorio.criados, 1);
        assert.equal(relatorio.com_erro, 7);
        const porLinha = Object.fromEntries(relatorio.erros.map((erro) => [erro.linha, erro.campo]));
        assert.deepEqual(porLinha, { 3: 'sku', 4: 'estoque', 5: 'ativo', 6: 'multiplo_venda', 7: 'imagem_url', 8: 'sku', 9: 'nome' });
    });

    test('arquivo só com sku;estoque atualiza apenas o estoque', async () => {
        const relatorio = await importarCatalogo('sku;estoque\nSKU-101;130\nSKU-102;45', { simular: true });
        assert.equal(relatorio.atualizados, 1);
        assert.equal(relatorio.inalterados, 1);
        assert.equal(relatorio.movimentacoes_estoque, 1);
    });

    test('carga completa desativa os produtos ausentes do arquivo', async () => {
        const relatorio = await importarCatalogo('sku;nome\nSKU-101;Loção hidratante Paixão Flor de Baunilha 200 ml', {
            simular: true,
            desativarAusentes: true
        });
        assert.equal(relatorio.desativados, 37);
    });

    test('CSV sem coluna sku é recusado', async () => {
        await assert.rejects(importarCatalogo('nome;estoque\nX;1'), { codigo: 'CSV_INVALIDO' });
    });
});

describe('vitrine pública', () => {
    test('lista sem token, paginada, sem preço e sem estoque exato', async () => {
        const resposta = await listar('?limite=5').expect(200);
        assert.equal(resposta.body.produtos.length, 5);
        assert.deepEqual(resposta.body.paginacao, { total: 38, pagina: 1, limite: 5, total_paginas: 8 });
        const produto = resposta.body.produtos[0];
        assert.equal(produto.preco, undefined);
        assert.equal(produto.estoque, undefined);
        assert.ok(['disponivel', 'ultimas_unidades', 'indisponivel'].includes(produto.disponibilidade));
        assert.ok(produto.categoria.slug && produto.marca.slug);
    });

    test('cliente logado vê estoque exato, mas não preço; equipe vê preço', async () => {
        const doCliente = await listar('?busca=SKU-101', cliente.auth).expect(200);
        assert.equal(doCliente.body.produtos[0].estoque, 120);
        assert.equal(doCliente.body.produtos[0].preco, undefined);
        const daEquipe = await listar('?busca=SKU-101', funcionario.auth).expect(200);
        assert.ok('preco' in daEquipe.body.produtos[0]);
        assert.equal(daEquipe.body.produtos[0].estoque_minimo, 10);
    });

    test('token inválido é tratado como visitante', async () => {
        const resposta = await listar('?busca=SKU-101', 'Bearer invalido').expect(200);
        assert.equal(resposta.body.produtos[0].estoque, undefined);
    });

    test('busca ignora acentos e maiúsculas', async () => {
        assert.deepEqual(skus(await listar('?busca=locao paixao')), ['SKU-101']);
        assert.deepEqual(skus(await listar('?busca=RISQUE')), ['SKU-103', 'SKU-111', 'SKU-117', 'SKU-118']);
        assert.deepEqual(skus(await listar('?busca=antisseptico')), ['SKU-102', 'SKU-130', 'SKU-138']);
        assert.deepEqual(skus(await listar('?busca=calendula')), ['SKU-134']);
    });

    test('busca com vários termos exige todos (inclusive marca e categoria)', async () => {
        const resposta = await listar('?busca=sabonete granado');
        assert.deepEqual(skus(resposta), ['SKU-106', 'SKU-133', 'SKU-135']);
        const porMarca = await listar('?busca=kimberly fralda');
        assert.deepEqual(skus(porMarca), ['SKU-107']);
    });

    test('relevância: nome que começa com o termo vem primeiro', async () => {
        const resposta = await listar('?busca=esmalte');
        assert.ok(resposta.body.produtos.every((p) => p.nome.startsWith('Esmalte')));
        const lenco = await listar('?busca=lenco');
        assert.deepEqual(skus(lenco), ['SKU-113', 'SKU-137']);
    });

    test('curingas do LIKE são tratados como texto', async () => {
        const resposta = await listar('?busca=%25%25').expect(200);
        assert.equal(resposta.body.paginacao.total, 0);
    });

    test('filtra por categoria (slug ou id), marca e disponibilidade', async () => {
        const bebe = await listar('?categoria=loja-do-bebe&limite=100');
        assert.equal(bebe.body.paginacao.total, 8);
        const idBebe = bebe.body.produtos[0].categoria.id_categoria;
        const porId = await listar(`?categoria=${idBebe}&limite=100`);
        assert.equal(porId.body.paginacao.total, 8);

        const granadoBebe = await listar('?categoria=loja-do-bebe&marca=granado');
        assert.deepEqual(skus(granadoBebe), ['SKU-106', 'SKU-133', 'SKU-134', 'SKU-137']);

        const duasMarcas = await listar('?marca=bic,risque&limite=100');
        assert.equal(duasMarcas.body.paginacao.total, 10);

        assert.deepEqual(skus(await listar('?disponibilidade=indisponivel')), ['SKU-104', 'SKU-112']);
        assert.deepEqual(skus(await listar('?disponibilidade=ultimas_unidades')), ['SKU-103', 'SKU-107', 'SKU-109']);
        const emEstoque = await listar('?disponibilidade=em_estoque');
        assert.equal(emEstoque.body.paginacao.total, 36);
    });

    test('ordenação por nome decrescente e parâmetros inválidos', async () => {
        const resposta = await listar('?ordenar=nome_desc&limite=3');
        const nomes = resposta.body.produtos.map((p) => p.nome);
        assert.deepEqual(nomes, [...nomes].sort().reverse());
        assert.equal((await listar('?ordenar=estoque').expect(400)).body.codigo, 'FILTRO_INVALIDO');
        await listar('?ordenar=estoque', funcionario.auth).expect(200);
        assert.equal((await listar('?disponibilidade=talvez').expect(400)).body.codigo, 'FILTRO_INVALIDO');
        assert.equal((await listar('?limite=500').expect(400)).body.codigo, 'PAGINACAO_INVALIDA');
    });

    test('GET /produtos/:id aceita id ou SKU', async () => {
        const porSku = await request(app).get('/api/v1/produtos/SKU-115').expect(200);
        assert.equal(porSku.body.produto.destaques.length, 4);
        const porId = await request(app).get(`/api/v1/produtos/${porSku.body.produto.id_produto}`).expect(200);
        assert.equal(porId.body.produto.sku, 'SKU-115');
        const inexistente = await request(app).get('/api/v1/produtos/NAO-EXISTE').expect(404);
        assert.equal(inexistente.body.codigo, 'PRODUTO_NAO_ENCONTRADO');
    });

    test('sugestões: produtos, categorias e marcas', async () => {
        const resposta = await request(app).get('/api/v1/produtos/sugestoes?busca=gran').expect(200);
        assert.ok(resposta.body.produtos.length > 0 && resposta.body.produtos.length <= 8);
        assert.deepEqual(resposta.body.marcas.map((m) => m.slug), ['granado']);
        const curta = await request(app).get('/api/v1/produtos/sugestoes?busca=g').expect(200);
        assert.deepEqual(curta.body.produtos, []);
    });

    test('filtros com contagem respeitam os outros filtros', async () => {
        const todos = await request(app).get('/api/v1/produtos/filtros').expect(200);
        const totalCategorias = todos.body.categorias.reduce((soma, c) => soma + c.total, 0);
        assert.equal(totalCategorias, 38);
        assert.deepEqual(todos.body.disponibilidade, { disponivel: 33, ultimas_unidades: 3, indisponivel: 2, em_estoque: 36 });

        const granado = await request(app).get('/api/v1/produtos/filtros?marca=granado').expect(200);
        const bebe = granado.body.categorias.find((c) => c.slug === 'loja-do-bebe');
        assert.equal(bebe.total, 4);
        // A lista de marcas ignora o próprio filtro de marca, para o usuário poder trocar de marca.
        assert.equal(granado.body.marcas.length, 7);
    });

    test('categorias e marcas públicas com total de produtos', async () => {
        const categorias = await request(app).get('/api/v1/categorias').expect(200);
        assert.equal(categorias.body.categorias.length, 4);
        const farmacia = categorias.body.categorias.find((c) => c.slug === 'farmacia');
        assert.equal(Number(farmacia.total_produtos), 5);
        const marcas = await request(app).get('/api/v1/marcas').expect(200);
        assert.equal(marcas.body.marcas.length, 7);
    });
});

describe('gestão de produtos', () => {
    let idCriado;

    test('visitante recebe 401 e cliente recebe 403 ao cadastrar', async () => {
        await request(app).post('/api/v1/produtos').send({ sku: 'X-1', nome: 'X' }).expect(401);
        const doCliente = await request(app).post('/api/v1/produtos').set('Authorization', cliente.auth)
            .send({ sku: 'X-1', nome: 'X' }).expect(403);
        assert.equal(doCliente.body.codigo, 'ACESSO_NEGADO');
    });

    test('gerente cadastra com estoque inicial registrado como movimentação', async () => {
        const resposta = await request(app).post('/api/v1/produtos').set('Authorization', gerente.auth).send({
            sku: 'NOVO-100',
            nome: 'Fralda Teste M c/ 30',
            destaques: ['Tamanho M', '30 unidades'],
            imagem_url: '/img/teste.webp',
            multiplo_venda: 6,
            quantidade_estoque: 60
        }).expect(201);
        idCriado = resposta.body.id_produto;
        assert.equal(resposta.body.produto.estoque, 60);
        assert.equal(resposta.body.produto.preco, null);

        const movimentacoes = await request(app).get(`/api/v1/produtos/${idCriado}/movimentacoes`)
            .set('Authorization', funcionario.auth).expect(200);
        assert.equal(movimentacoes.body.movimentacoes.length, 1);
        assert.equal(movimentacoes.body.movimentacoes[0].quantidade, 60);
    });

    test('validação devolve todos os campos com problema e SKU duplicado dá 409', async () => {
        const invalido = await request(app).post('/api/v1/produtos').set('Authorization', gerente.auth)
            .send({ sku: 'tem espaço', multiplo_venda: 0, preco: -1, campo_x: 1 }).expect(422);
        assert.equal(invalido.body.codigo, 'VALIDACAO');
        const campos = invalido.body.detalhes.map((d) => d.campo).sort();
        assert.deepEqual(campos, ['campo_x', 'multiplo_venda', 'nome', 'preco', 'sku']);

        const duplicado = await request(app).post('/api/v1/produtos').set('Authorization', gerente.auth)
            .send({ sku: 'NOVO-100', nome: 'Outro' }).expect(409);
        assert.equal(duplicado.body.codigo, 'SKU_DUPLICADO');

        const categoriaInexistente = await request(app).post('/api/v1/produtos').set('Authorization', gerente.auth)
            .send({ sku: 'NOVO-101', nome: 'Outro', id_categoria: 9999 }).expect(422);
        assert.equal(categoriaInexistente.body.detalhes[0].campo, 'id_categoria');
    });

    test('PATCH altera só o enviado; PUT exige obrigatórios; estoque não muda por PATCH', async () => {
        const parcial = await request(app).patch(`/api/v1/produtos/${idCriado}`).set('Authorization', gerente.auth)
            .send({ nome: 'Fralda Teste M c/ 30 (nova)', preco: '12,50' }).expect(200);
        assert.equal(parcial.body.produto.nome, 'Fralda Teste M c/ 30 (nova)');
        assert.equal(parcial.body.produto.preco, 12.5);
        assert.equal(parcial.body.produto.multiplo_venda, 6);

        await request(app).put(`/api/v1/produtos/${idCriado}`).set('Authorization', gerente.auth)
            .send({ nome: 'Sem SKU' }).expect(422);
        const completo = await request(app).put(`/api/v1/produtos/${idCriado}`).set('Authorization', gerente.auth)
            .send({ sku: 'NOVO-100', nome: 'Fralda Teste' }).expect(200);
        assert.equal(completo.body.produto.multiplo_venda, 1);
        assert.deepEqual(completo.body.produto.destaques, []);

        const estoque = await request(app).patch(`/api/v1/produtos/${idCriado}`).set('Authorization', gerente.auth)
            .send({ quantidade_estoque: 5 }).expect(422);
        assert.match(estoque.body.mensagem, /estoque/);
    });

    test('ajuste de estoque exige observação e não deixa ficar negativo', async () => {
        const url = `/api/v1/produtos/${idCriado}/estoque`;
        await request(app).patch(url).set('Authorization', funcionario.auth).send({ ajuste: -10 }).expect(422);
        await request(app).patch(url).set('Authorization', cliente.auth).send({ ajuste: -10, observacao: 'x' }).expect(403);

        const saida = await request(app).patch(url).set('Authorization', funcionario.auth)
            .send({ ajuste: -10, observacao: 'Avaria na conferência' }).expect(200);
        assert.equal(saida.body.produto.estoque, 50);
        assert.equal(saida.body.movimentacao.estoque_anterior, 60);
        assert.equal(saida.body.movimentacao.observacao, 'Avaria na conferência');

        const negativo = await request(app).patch(url).set('Authorization', funcionario.auth)
            .send({ ajuste: -51, observacao: 'Teste negativo' }).expect(409);
        assert.equal(negativo.body.codigo, 'ESTOQUE_INSUFICIENTE');

        const definido = await request(app).patch(url).set('Authorization', funcionario.auth)
            .send({ quantidade: 200, observacao: 'Inventário mensal' }).expect(200);
        assert.equal(definido.body.produto.estoque, 200);
    });

    test('desativar esconde da vitrine, mas a equipe ainda vê e pode reativar', async () => {
        await request(app).delete(`/api/v1/produtos/${idCriado}`).set('Authorization', gerente.auth).expect(200);
        await request(app).get(`/api/v1/produtos/${idCriado}`).expect(404);
        assert.equal((await listar('?busca=NOVO-100')).body.paginacao.total, 0);
        const equipe = await listar('?busca=NOVO-100&incluir_inativos=true', gerente.auth);
        assert.equal(equipe.body.produtos[0].ativo, false);
        // Visitante não consegue usar incluir_inativos.
        assert.equal((await listar('?busca=NOVO-100&incluir_inativos=true')).body.paginacao.total, 0);

        await request(app).patch(`/api/v1/produtos/${idCriado}`).set('Authorization', gerente.auth)
            .send({ ativo: true }).expect(200);
        await request(app).get(`/api/v1/produtos/${idCriado}`).expect(200);
    });

    test('upload de imagem valida o conteúdo e atualiza imagem_url', async () => {
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            'base64'
        );
        const resposta = await request(app).post(`/api/v1/produtos/${idCriado}/imagem`)
            .set('Authorization', gerente.auth)
            .attach('imagem', png, { filename: 'foto.png', contentType: 'image/png' })
            .expect(200);
        assert.match(resposta.body.produto.imagem_url, /^\/arquivos\/uploads\/[0-9a-f-]{36}\.png$/);
        await request(app).get(resposta.body.produto.imagem_url).expect(200);

        const falsa = await request(app).post(`/api/v1/produtos/${idCriado}/imagem`)
            .set('Authorization', gerente.auth)
            .attach('imagem', Buffer.from('não sou png'), { filename: 'x.png', contentType: 'image/png' })
            .expect(400);
        assert.equal(falsa.body.sucesso, false);

        // Limpa o arquivo criado pelo teste.
        const arquivo = path.join(__dirname, '..', 'publico', resposta.body.produto.imagem_url.replace('/arquivos/', ''));
        fs.unlinkSync(arquivo);
    });
});

describe('categorias e marcas (gestão)', () => {
    test('cria com slug automático, edita, bloqueia exclusão em uso e exclui vazia', async () => {
        const criada = await request(app).post('/api/v1/categorias').set('Authorization', gerente.auth)
            .send({ nome: 'Perfumaria Fina', ordem: 5 }).expect(201);
        assert.equal(criada.body.categoria.slug, 'perfumaria-fina');
        const id = criada.body.categoria.id_categoria;

        const duplicada = await request(app).post('/api/v1/categorias').set('Authorization', gerente.auth)
            .send({ nome: 'Perfumaria fina' }).expect(409);
        assert.equal(duplicada.body.codigo, 'SLUG_DUPLICADO');

        await request(app).patch(`/api/v1/categorias/${id}`).set('Authorization', gerente.auth)
            .send({ nome: 'Perfumaria' }).expect(200);
        await request(app).post('/api/v1/categorias').set('Authorization', cliente.auth)
            .send({ nome: 'X' }).expect(403);

        const granado = (await request(app).get('/api/v1/marcas')).body.marcas.find((m) => m.slug === 'granado');
        const emUso = await request(app).delete(`/api/v1/marcas/${granado.id_marca}`).set('Authorization', gerente.auth).expect(409);
        assert.equal(emUso.body.codigo, 'EM_USO');

        await request(app).delete(`/api/v1/categorias/${id}`).set('Authorization', gerente.auth).expect(200);
    });

    test('categoria desativada some da lista pública', async () => {
        const { body } = await request(app).get('/api/v1/categorias');
        const papelaria = body.categorias.find((c) => c.slug === 'papelaria-e-utilidades');
        await request(app).patch(`/api/v1/categorias/${papelaria.id_categoria}`).set('Authorization', gerente.auth)
            .send({ ativo: false }).expect(200);
        const depois = await request(app).get('/api/v1/categorias');
        assert.equal(depois.body.categorias.length, 3);
        const equipe = await request(app).get('/api/v1/categorias?incluir_inativos=true').set('Authorization', gerente.auth);
        assert.equal(equipe.body.categorias.length, 4);
    });
});

describe('utilitários', () => {
    test('validação de CNPJ', () => {
        const { cnpjValido, somenteDigitos } = require('../lib/cnpj');
        assert.equal(cnpjValido('11.222.333/0001-81'), true);
        assert.equal(cnpjValido('11222333000182'), false);
        assert.equal(cnpjValido('11111111111111'), false);
        assert.equal(cnpjValido('123'), false);
        assert.equal(somenteDigitos('11.222.333/0001-81'), '11222333000181');
    });

    test('seed de dev recusa produção e RDS', () => {
        const { verificarAmbienteSeguro, USUARIOS } = require('../scripts/seed-dev');
        const { cnpjValido } = require('../lib/cnpj');
        const base = { producao: false, db: { host: 'localhost' } };
        assert.equal(verificarAmbienteSeguro(base, {}), null);
        assert.match(verificarAmbienteSeguro({ ...base, producao: true }, {}), /produção/);
        const rds = { ...base, db: { host: 'mantiqueira.abc123.us-east-1.rds.amazonaws.com' } };
        assert.match(verificarAmbienteSeguro(rds, {}), /RDS/);
        assert.equal(verificarAmbienteSeguro(rds, { SEED_DEV_PERMITIR_REMOTO: '1' }), null);
        assert.ok(cnpjValido(USUARIOS.find((u) => u.tipo === 'cliente').cnpj));
    });

    test('leitor de CSV: BOM, aspas, ; dentro de aspas e quebra de linha', () => {
        const { lerCsv } = require('../lib/csv');
        const { cabecalho, registros } = lerCsv('﻿"sku";"nome"\r\n"A";"x; ""y""\nz"\r\nB;w\r\n\r\n');
        assert.deepEqual(cabecalho, ['sku', 'nome']);
        assert.equal(registros.length, 2);
        assert.equal(registros[0].valores.nome, 'x; "y"\nz');
        assert.equal(registros[1].linha, 4);
    });
});
