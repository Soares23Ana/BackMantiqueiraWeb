const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepararApp, criarUsuario } = require('./ajuda');

const LEGADO = path.join(__dirname, 'fixtures', 'catalogo_legado.csv');
const NOVO = path.join(__dirname, 'fixtures', 'catalogo_novo.csv');

let sequelize;
let Produto;
let Categoria;
let semearCatalogo;
let importarCatalogo;
let idAntigo101;
let idPedido;

before(async () => {
    ({ sequelize } = await prepararApp());
    ({ Produto, Categoria } = require('../models'));
    ({ semearCatalogo } = require('../scripts/seed-catalogo'));
    ({ importarCatalogo } = require('../servicos/importadorCatalogo'));
    // Catálogo antigo de demonstração (SKU-1xx) já no banco, com um pedido em cima de um deles.
    await importarCatalogo(fs.readFileSync(LEGADO, 'utf8'));
    await Produto.create({ sku: 'MANUAL-1', nome: 'Cadastrado à mão', quantidade_estoque: 5 });
    const { Endereco } = require('../models');
    const { usuario: cliente, auth } = await criarUsuario('cliente');
    await Endereco.create({
        id_usuario: cliente.id_usuario, cep: '37550000', logradouro: 'Rua A', numero: '1',
        bairro: 'Centro', cidade: 'Pouso Alegre', estado: 'MG', principal: true
    });
    idAntigo101 = (await Produto.findOne({ where: { sku: 'SKU-101' } })).id_produto;
    const request = require('supertest');
    const { criarApp } = require('../app');
    const resposta = await request(criarApp()).post('/api/v1/pedidos').set('Authorization', auth)
        .send({ itens: [{ id_produto: idAntigo101, quantidade: 4 }] }).expect(201);
    idPedido = resposta.body.pedido.id_pedido;
});

after(async () => {
    await sequelize.close();
});

const contar = () => Produto.count();
const porSku = (sku) => Produto.findOne({ where: { sku } });

describe('seed:catalogo com o catálogo real (sku_antigo)', () => {
    test('--simular mostra o resultado sem gravar nada', async () => {
        const antes = await contar();
        const relatorio = await semearCatalogo({ arquivo: NOVO, simular: true });
        assert.equal(relatorio.simulado, true);
        assert.equal(relatorio.com_erro, 0);
        assert.deepEqual([relatorio.criados, relatorio.atualizados, relatorio.skus_trocados], [2, 3, 3]);
        // 38 antigos - 3 aproveitados = 35 desativados; o produto cadastrado à mão não é tocado.
        assert.equal(relatorio.desativados, 35);
        assert.equal(await contar(), antes);
        assert.ok(await porSku('SKU-101'));
        assert.equal(await porSku('1391'), null);
        assert.equal((await porSku('SKU-102')).ativo, true);
    });

    test('troca o SKU do produto EXISTENTE (mesmo id e pedidos), cria os novos e desativa os antigos sem correspondência', async () => {
        const relatorio = await semearCatalogo({ arquivo: NOVO });
        assert.deepEqual([relatorio.criados, relatorio.atualizados, relatorio.skus_trocados, relatorio.desativados, relatorio.com_erro], [2, 3, 3, 35, 0]);

        // Mesmo id: o SKU-101 virou 1393, com o pedido preservado.
        assert.equal(await porSku('SKU-101'), null);
        const trocado = await porSku('1393');
        assert.equal(trocado.id_produto, idAntigo101);
        assert.equal(trocado.nome_erp, 'LOC.HID. PAIXAO FLOR DE BAUNILHA 200ML');
        const [[item]] = await sequelize.query('SELECT id_produto, quantidade FROM itens_pedido WHERE id_pedido = ?', { replacements: [idPedido] });
        assert.deepEqual(item, { id_produto: idAntigo101, quantidade: 4 });
        const [[movimentos]] = await sequelize.query('SELECT COUNT(*) AS total FROM movimentacoes_estoque WHERE id_produto = ?', { replacements: [idAntigo101] });
        assert.ok(movimentos.total >= 2, 'o histórico de estoque do produto continua junto');

        // Estoques definidos pelo arquivo, inclusive baixo e zerado.
        assert.equal((await porSku('1391')).quantidade_estoque, 0);
        assert.equal((await porSku('1392')).quantidade_estoque, 8);
        assert.equal(trocado.quantidade_estoque, 120);
        assert.equal((await porSku('1394')).multiplo_venda, 6);

        // Novos: categoria e subcategoria criadas, produto na subcategoria; inativo respeitado.
        const biscoitos = await Categoria.findOne({ where: { nome: 'Biscoitos' } });
        assert.equal((await Categoria.findByPk(biscoitos.id_pai)).nome, 'Mercearia');
        assert.equal((await porSku('1394')).id_categoria, biscoitos.id_categoria);
        assert.equal((await porSku('1395')).ativo, false);
        assert.equal((await porSku('1392')).ativo, true);

        // Antigos sem correspondência: desativados, nunca apagados. Cadastro manual intocado.
        const antigo = await porSku('SKU-102');
        assert.ok(antigo);
        assert.equal(antigo.ativo, false);
        assert.equal((await porSku('MANUAL-1')).ativo, true);
        assert.equal(await contar(), 38 + 1 + 2);
        assert.equal(await Produto.count({ where: { ativo: false } }), 35 + 1);
    });

    test('é idempotente: rodar de novo não muda nada', async () => {
        const antes = await Produto.findAll({ order: [['id_produto', 'ASC']], raw: true });
        const relatorio = await semearCatalogo({ arquivo: NOVO });
        assert.deepEqual(
            [relatorio.criados, relatorio.atualizados, relatorio.inalterados, relatorio.skus_trocados, relatorio.desativados, relatorio.movimentacoes_estoque, relatorio.com_erro],
            [0, 0, 5, 0, 0, 0, 0]
        );
        const depois = await Produto.findAll({ order: [['id_produto', 'ASC']], raw: true });
        assert.deepEqual(depois, antes);
    });

    test('um sku_antigo que já não existe mais não atrapalha (o produto novo é só atualizado)', async () => {
        const relatorio = await importarCatalogo('sku;nome;sku_antigo\n1392;Esmalte Risqué Renda 8 ml;SKU-103', {});
        assert.deepEqual([relatorio.skus_trocados, relatorio.com_erro], [0, 0]);
    });

    test('sku_antigo repetido ou inválido é erro da linha; com erro no arquivo ninguém é desativado', async () => {
        await Produto.update({ ativo: true }, { where: { sku: 'SKU-102' } });
        const relatorio = await semearCatalogo({
            arquivo: (() => {
                const temporario = path.join(__dirname, 'fixtures', 'catalogo_com_erro.tmp.csv');
                fs.writeFileSync(temporario, 'sku;nome;sku_antigo\nERR-1;Erro um;SKU-110\nERR-2;Erro dois;SKU-110\nERR-3;Erro três;com espaço');
                return temporario;
            })()
        });
        fs.rmSync(path.join(__dirname, 'fixtures', 'catalogo_com_erro.tmp.csv'), { force: true });
        assert.deepEqual(relatorio.erros.map((e) => [e.linha, e.campo]), [[3, 'sku_antigo'], [4, 'sku_antigo']]);
        assert.equal(relatorio.desativados, 0);
        assert.match(relatorio.avisos.join(' '), /Nenhum produto foi desativado/);
        assert.equal((await porSku('SKU-102')).ativo, true, 'a proteção vale também para os antigos');
        // O SKU-110 foi aproveitado só pela primeira linha.
        assert.ok(await porSku('ERR-1'));
        assert.equal(await porSku('SKU-110'), null);
        assert.equal(await porSku('ERR-2'), null);
    });
});
