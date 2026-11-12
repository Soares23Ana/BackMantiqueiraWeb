const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario, config } = require('./ajuda');

let app;
let sequelize;
let equipe;
let cliente;
let Produto;
let Categoria;
let importarCatalogo;
const c = {};
const p = {};

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto, Categoria } = require('../models'));
    ({ importarCatalogo } = require('../servicos/importadorCatalogo'));
    equipe = await criarUsuario('equipe');
    cliente = await criarUsuario('cliente');
});

after(async () => {
    await sequelize.close();
});

const api = (metodo, url, usuario) => {
    const req = request(app)[metodo](`/api/v1${url}`);
    return usuario ? req.set('Authorization', usuario.auth) : req;
};
const criarCategoria = (corpo) => api('post', '/categorias', equipe).send(corpo);
const skus = (resposta) => resposta.body.produtos.map((produto) => produto.sku).sort();

describe('categorias em 2 níveis (gestão)', () => {
    test('as categorias atuais são principais (id_pai nulo)', async () => {
        await Categoria.create({ nome: 'Higiene e Beleza', slug: 'higiene-e-beleza' });
        const lista = await api('get', '/categorias?plano=true').expect(200);
        assert.ok(lista.body.categorias.every((categoria) => categoria.id_pai === null));
    });

    test('cria subcategoria com id_pai; slug único gerado; nome único dentro do mesmo pai', async () => {
        c.higiene = (await Categoria.findOne({ where: { slug: 'higiene-e-beleza' } })).id_categoria;
        c.casa = (await criarCategoria({ nome: 'Casa' }).expect(201)).body.categoria.id_categoria;

        const sabonetes = await criarCategoria({ nome: 'Sabonetes', id_pai: c.higiene }).expect(201);
        assert.equal(sabonetes.body.categoria.id_pai, c.higiene);
        c.sabonetes = sabonetes.body.categoria.id_categoria;
        c.cabelos = (await criarCategoria({ nome: 'Cabelos', id_pai: c.higiene }).expect(201)).body.categoria.id_categoria;

        // Mesmo nome em pais diferentes é permitido; o slug (único no geral) se diferencia sozinho.
        const outrosA = await criarCategoria({ nome: 'Outros', id_pai: c.higiene }).expect(201);
        const outrosB = await criarCategoria({ nome: 'Outros', id_pai: c.casa }).expect(201);
        assert.equal(outrosA.body.categoria.slug, 'outros');
        assert.equal(outrosB.body.categoria.slug, 'casa-outros');
        c.outrosCasa = outrosB.body.categoria.id_categoria;

        // Nome repetido no mesmo nível (sem acento ou maiúsculas) é recusado, nas principais e nas subcategorias.
        for (const corpo of [{ nome: 'sabonetes', id_pai: c.higiene }, { nome: 'HIGIENE E BELEZA' }, { nome: 'Higiene e Beleza', slug: 'outro-slug' }]) {
            const resposta = await criarCategoria(corpo).expect(409);
            assert.equal(resposta.body.codigo, 'NOME_DUPLICADO', JSON.stringify(corpo));
        }
        // Slug informado e repetido continua sendo SLUG_DUPLICADO.
        const slug = await criarCategoria({ nome: 'Outro nome', slug: 'sabonetes', id_pai: c.casa }).expect(409);
        assert.equal(slug.body.codigo, 'SLUG_DUPLICADO');
    });

    test('profundidade máxima 2 e validação do pai', async () => {
        const erro = async (corpo, metodo = 'post', url = '/categorias') => (await api(metodo, url, equipe).send(corpo).expect(422)).body;
        assert.match((await erro({ nome: 'Neta', id_pai: c.sabonetes })).mensagem, /dois níveis/);
        await erro({ nome: 'Sem pai', id_pai: 999999 });
        for (const id_pai of [0, -1, 'abc', 1.5]) await erro({ nome: 'Pai inválido', id_pai });
        // Mover: uma categoria com subcategorias não vira subcategoria; ninguém é pai de si mesmo; subcategoria não vira pai.
        assert.match((await erro({ id_pai: c.casa }, 'patch', `/categorias/${c.higiene}`)).mensagem, /tem subcategorias/);
        assert.match((await erro({ id_pai: c.sabonetes }, 'patch', `/categorias/${c.sabonetes}`)).mensagem, /dela mesma/);
        assert.match((await erro({ id_pai: c.sabonetes }, 'put', `/categorias/${c.casa}`)).mensagem, /dois níveis/);
        await api('post', '/categorias', cliente).send({ nome: 'X', id_pai: c.casa }).expect(403);
    });

    test('mover entre pais e promover a principal', async () => {
        const movida = await api('patch', `/categorias/${c.outrosCasa}`, equipe).send({ id_pai: c.higiene }).expect(409);
        // "Outros" já existe em Higiene e Beleza: o nome único dentro do mesmo pai vale também ao mover.
        assert.equal(movida.body.codigo, 'NOME_DUPLICADO');
        const renomeada = await api('put', `/categorias/${c.outrosCasa}`, equipe).send({ nome: 'Diversos', id_pai: c.higiene }).expect(200);
        assert.equal(renomeada.body.categoria.id_pai, c.higiene);
        const promovida = await api('patch', `/categorias/${c.outrosCasa}`, equipe).send({ id_pai: null }).expect(200);
        assert.equal(promovida.body.categoria.id_pai, null);
        await api('patch', `/categorias/${c.outrosCasa}`, equipe).send({ id_pai: c.casa }).expect(200);
    });

    test('GET /categorias: árvore por padrão (total soma as subcategorias) e lista plana com ?plano=true', async () => {
        const arvore = await api('get', '/categorias').expect(200);
        assert.deepEqual(arvore.body.categorias.map((x) => x.slug).sort(), ['casa', 'higiene-e-beleza']);
        const higiene = arvore.body.categorias.find((x) => x.slug === 'higiene-e-beleza');
        assert.deepEqual(higiene.subcategorias.map((x) => x.nome).sort(), ['Cabelos', 'Outros', 'Sabonetes']);
        const plano = await api('get', '/categorias?plano=true').expect(200);
        assert.equal(plano.body.categorias.length, 6);
        assert.ok(plano.body.categorias.filter((x) => x.id_pai !== null).length === 4);
    });
});

describe('produtos com categoria e subcategoria', () => {
    test('preparação: produtos na categoria principal e nas subcategorias', async () => {
        const novo = async (sku, nome, idCategoria, extra = {}) => {
            const resposta = await api('post', '/produtos', equipe).send({ sku, nome, id_categoria: idCategoria, quantidade_estoque: 80, ...extra }).expect(201);
            p[sku] = resposta.body.id_produto;
        };
        await novo('P-SAB-1', 'Sabonete Um', c.sabonetes);
        await novo('P-SAB-2', 'Sabonete Dois', c.sabonetes);
        await novo('P-CAB-1', 'Shampoo Um', c.cabelos);
        await novo('P-HIG-1', 'Higiene solta', c.higiene);
        await novo('P-CASA-1', 'Vassoura', c.casa);
        await novo('P-SEM-1', 'Sem categoria', null);
    });

    test('respostas trazem categoria (principal) e subcategoria (ou null)', async () => {
        const doSub = (await api('get', `/produtos/${p['P-SAB-1']}`).expect(200)).body.produto;
        assert.equal(doSub.categoria.slug, 'higiene-e-beleza');
        assert.equal(doSub.subcategoria.slug, 'sabonetes');
        assert.deepEqual(Object.keys(doSub.subcategoria).sort(), ['id_categoria', 'nome', 'slug']);
        const daPrincipal = (await api('get', `/produtos/${p['P-HIG-1']}`).expect(200)).body.produto;
        assert.equal(daPrincipal.categoria.slug, 'higiene-e-beleza');
        assert.equal(daPrincipal.subcategoria, null);
        const semNada = (await api('get', `/produtos/${p['P-SEM-1']}`).expect(200)).body.produto;
        assert.deepEqual([semNada.categoria, semNada.subcategoria], [null, null]);
        // Também na lista, nas campanhas e nos favoritos.
        const lista = await api('get', '/produtos?busca=Sabonete Um').expect(200);
        assert.equal(lista.body.produtos[0].subcategoria.nome, 'Sabonetes');
        await api('put', `/favoritos/${p['P-SAB-1']}`, cliente).expect(200);
        const favoritos = await api('get', '/favoritos', cliente).expect(200);
        assert.equal(favoritos.body.produtos[0].subcategoria.slug, 'sabonetes');
        const dia = 86400000;
        await api('post', '/campanhas', equipe).send({
            titulo: 'Campanha das subcategorias', inicio_em: new Date(Date.now() - dia).toISOString(), fim_em: new Date(Date.now() + dia).toISOString(), produtos: [p['P-CAB-1']]
        }).expect(201);
        const ativas = await api('get', '/campanhas/ativas').expect(200);
        assert.equal(ativas.body.campanhas[0].produtos[0].subcategoria.slug, 'cabelos');
    });

    test('?categoria= inclui as subcategorias; ?subcategoria= filtra uma; ids e slugs; busca pelo nome do pai', async () => {
        const lista = (query) => api('get', `/produtos${query}`).expect(200);
        assert.deepEqual(skus(await lista('?categoria=higiene-e-beleza')), ['P-CAB-1', 'P-HIG-1', 'P-SAB-1', 'P-SAB-2']);
        assert.deepEqual(skus(await lista(`?categoria=${c.higiene}`)), ['P-CAB-1', 'P-HIG-1', 'P-SAB-1', 'P-SAB-2']);
        assert.deepEqual(skus(await lista('?categoria=casa')), ['P-CASA-1']);
        assert.deepEqual(skus(await lista('?categoria=casa,higiene-e-beleza')).length, 5);
        assert.deepEqual(skus(await lista('?subcategoria=sabonetes')), ['P-SAB-1', 'P-SAB-2']);
        assert.deepEqual(skus(await lista(`?subcategoria=${c.cabelos}`)), ['P-CAB-1']);
        // Subcategoria no lugar de categoria principal não filtra nada (e vice-versa).
        assert.deepEqual(skus(await lista('?subcategoria=higiene-e-beleza')), []);
        assert.deepEqual(skus(await lista('?categoria=sabonetes')), ['P-SAB-1', 'P-SAB-2']);
        assert.deepEqual(skus(await lista('?categoria=higiene-e-beleza&subcategoria=cabelos')), ['P-CAB-1']);
        assert.deepEqual(skus(await lista('?busca=higiene e beleza sabonete')), ['P-SAB-1', 'P-SAB-2']);
    });

    test('GET /produtos/filtros devolve a árvore com contagens e respeita os outros filtros', async () => {
        const todos = (await api('get', '/produtos/filtros').expect(200)).body;
        const higiene = todos.categorias.find((x) => x.slug === 'higiene-e-beleza');
        assert.equal(higiene.total, 4);
        assert.deepEqual(higiene.subcategorias.map((x) => [x.slug, x.total]), [['cabelos', 1], ['sabonetes', 2]]);
        assert.deepEqual(todos.categorias.find((x) => x.slug === 'casa'), { id_categoria: c.casa, nome: 'Casa', slug: 'casa', total: 1, subcategorias: [] });
        assert.ok(todos.categorias.every((categoria) => 'subcategorias' in categoria));

        // A contagem das categorias ignora o próprio filtro de categoria, mas respeita a busca.
        const buscado = (await api('get', '/produtos/filtros?busca=Sabonete').expect(200)).body;
        assert.equal(buscado.categorias.find((x) => x.slug === 'higiene-e-beleza').total, 2);
        assert.equal(buscado.categorias.find((x) => x.slug === 'casa'), undefined);
        const comSub = (await api('get', '/produtos/filtros?subcategoria=cabelos').expect(200)).body;
        assert.equal(comSub.categorias.find((x) => x.slug === 'higiene-e-beleza').total, 4);
        // Desativar um produto tira da contagem.
        await api('patch', `/produtos/${p['P-SAB-2']}`, equipe).send({ ativo: false }).expect(200);
        const depois = (await api('get', '/produtos/filtros').expect(200)).body;
        assert.deepEqual(depois.categorias.find((x) => x.slug === 'higiene-e-beleza').subcategorias.map((x) => [x.slug, x.total]), [['cabelos', 1], ['sabonetes', 1]]);
        await api('patch', `/produtos/${p['P-SAB-2']}`, equipe).send({ ativo: true }).expect(200);
    });

    test('DELETE bloqueado com subcategorias ou produtos; libera quando vazia', async () => {
        const comSubs = await api('delete', `/categorias/${c.higiene}`, equipe).expect(409);
        assert.equal(comSubs.body.codigo, 'EM_USO');
        assert.match(comSubs.body.mensagem, /subcategoria/);
        const comProdutos = await api('delete', `/categorias/${c.sabonetes}`, equipe).expect(409);
        assert.match(comProdutos.body.mensagem, /produto/);
        const vazia = await api('delete', `/categorias/${c.outrosCasa}`, equipe).expect(200);
        assert.equal(vazia.body.mensagem, 'Categoria excluída.');
    });
});

describe('importação com categoria e subcategoria', () => {
    const importar = (csv, opcoes = {}) => importarCatalogo(csv, opcoes);

    test('colunas categoria e subcategoria criam o que falta; o produto aponta para a subcategoria', async () => {
        const relatorio = await importar([
            'sku;nome;categoria;subcategoria',
            'IMP-1;Produto 1;Mercearia;Biscoitos',
            'IMP-2;Produto 2;Mercearia;',
            'IMP-3;Produto 3;Higiene e Beleza;Sabonetes',
            'IMP-4;Produto 4;Mercearia;Biscoitos'
        ].join('\n'));
        assert.deepEqual([relatorio.criados, relatorio.com_erro, relatorio.categorias_criadas], [4, 0, 2]);
        const mercearia = await Categoria.findOne({ where: { nome: 'Mercearia' } });
        const biscoitos = await Categoria.findOne({ where: { nome: 'Biscoitos' } });
        assert.equal(mercearia.id_pai, null);
        assert.equal(biscoitos.id_pai, mercearia.id_categoria);
        const idDe = async (sku) => (await Produto.findOne({ where: { sku } })).id_categoria;
        assert.equal(await idDe('IMP-1'), biscoitos.id_categoria);
        assert.equal(await idDe('IMP-2'), mercearia.id_categoria);
        assert.equal(await idDe('IMP-3'), c.sabonetes, 'reaproveita a subcategoria existente');
        // Rodar de novo não cria nada.
        assert.equal((await importar('sku;categoria;subcategoria\nIMP-1;mercearia;biscoitos')).categorias_criadas, 0);
    });

    test('subcategoria sem categoria é erro da linha', async () => {
        const relatorio = await importar('sku;nome;categoria;subcategoria\nIMP-5;Produto 5;;Sozinha\nIMP-6;Produto 6;Mercearia;Doces');
        assert.deepEqual([relatorio.criados, relatorio.com_erro], [1, 1]);
        assert.deepEqual(relatorio.erros.map((e) => [e.linha, e.campo]), [[2, 'subcategoria']]);
    });

    test('mesmo nome de subcategoria em pais diferentes cria slugs distintos', async () => {
        const relatorio = await importar('sku;nome;categoria;subcategoria\nIMP-7;Produto 7;Casa;Diversos\nIMP-8;Produto 8;Mercearia;Diversos');
        assert.equal(relatorio.com_erro, 0);
        const slugs = (await Categoria.findAll({ where: { nome: 'Diversos' } })).map((x) => x.slug).sort();
        assert.deepEqual(slugs, ['diversos', 'mercearia-diversos']);
    });

    test('"CATEGORIA - Cad. ERP" passa pelo mapa; sem mapa o produto entra sem categoria e nada é criado', async () => {
        const mapa = 'categoria_erp;categoria;subcategoria\nSABONETE LIQUIDO;Higiene e Beleza;Sabonetes\nBISCOITO DOCE;Mercearia;\nBISCOITO SALGADO;;\n';
        const antes = await Categoria.count();
        const relatorio = await importar([
            'CÓDIGO;PRODUTO;CATEGORIA - Cad. ERP',
            '9001;SAB.LIQ. UM;sabonete liquido',
            '9002;BISC. DOIS;Biscoito Doce',
            '9003;PRODUTO TRES;ÁREA DESCONHECIDA',
            '9004;PRODUTO QUATRO;ÁREA DESCONHECIDA',
            '9005;PRODUTO CINCO;BISCOITO SALGADO'
        ].join('\n'), { mapaCategoriasOrigem: mapa });
        assert.equal(relatorio.com_erro, 0);
        assert.deepEqual(relatorio.categorias_sem_mapa, [
            { categoria_erp: 'ÁREA DESCONHECIDA', ocorrencias: 2 },
            { categoria_erp: 'BISCOITO SALGADO', ocorrencias: 1 }
        ]);
        assert.equal(await Categoria.count(), antes, 'nenhuma categoria nova');
        const idDe = async (sku) => (await Produto.findOne({ where: { sku } })).id_categoria;
        assert.equal(await idDe('9001'), c.sabonetes);
        assert.equal(await idDe('9002'), (await Categoria.findOne({ where: { nome: 'Mercearia' } })).id_categoria);
        assert.equal(await idDe('9003'), null);
        assert.equal(await idDe('9005'), null);
        assert.equal((await Produto.findOne({ where: { sku: '9001' } })).nome, 'Sabonete Líquido Um');
    });

    test('produto existente sem mapa mantém a categoria que já tinha', async () => {
        const antes = await Produto.findOne({ where: { sku: '9001' } });
        const relatorio = await importar('codigo;produto;categoria - cad. erp\n9001;SAB.LIQ. UM;SEM MAPA ALGUM', { mapaCategoriasOrigem: 'categoria_erp;categoria;subcategoria\n' });
        assert.deepEqual(relatorio.categorias_sem_mapa, [{ categoria_erp: 'SEM MAPA ALGUM', ocorrencias: 1 }]);
        assert.equal((await Produto.findByPk(antes.id_produto)).id_categoria, antes.id_categoria);
    });

    test('arquivo de mapa ausente: tudo sem mapa, com aviso', async () => {
        const original = config.importacao.mapaCategorias;
        config.importacao.mapaCategorias = path.join(os.tmpdir(), 'mapa-que-nao-existe.csv');
        try {
            const relatorio = await importar('codigo;produto;categoria - cad. erp\n9010;PRODUTO X;QUALQUER');
            assert.equal(relatorio.categorias_sem_mapa.length, 1);
            assert.match(relatorio.avisos.join(' '), /Mapa de categorias não encontrado/);
        } finally {
            config.importacao.mapaCategorias = original;
        }
    });

    test('o mapa é lido do arquivo configurado (seeds/mapa_categorias.csv por padrão)', async () => {
        const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'mantiqueira-mapa-teste-'));
        const original = config.importacao.mapaCategorias;
        config.importacao.mapaCategorias = path.join(pasta, 'mapa.csv');
        fs.writeFileSync(config.importacao.mapaCategorias, 'categoria_erp;categoria;subcategoria\nDOCES;Mercearia;Doces\n');
        try {
            const relatorio = await importar('codigo;produto;categoria - cad. erp\n9020;BOMBOM X;doces');
            assert.deepEqual(relatorio.categorias_sem_mapa, []);
            const doces = await Categoria.findOne({ where: { nome: 'Doces' } });
            assert.equal((await Produto.findOne({ where: { sku: '9020' } })).id_categoria, doces.id_categoria);
        } finally {
            config.importacao.mapaCategorias = original;
            fs.rmSync(pasta, { recursive: true, force: true });
        }
    });
});
