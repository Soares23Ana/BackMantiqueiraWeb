const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const { zipSync } = require('fflate');
const { prepararApp, criarUsuario, config } = require('./ajuda');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(40)]);

let app;
let sequelize;
let Produto;
let Auditoria;
let equipe;
const ids = {};

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto, Auditoria } = require('../models'));
    equipe = await criarUsuario('equipe');
    const criar = async (chave, extra = {}) => {
        ids[chave] = (await Produto.create({ sku: chave, nome: `Produto ${chave}`, quantidade_estoque: 1, ...extra })).id_produto;
    };
    await criar('LOTE-A');
    await criar('LOTE-B');
    await criar('110606');
    await criar('DUP-1');
    await criar('DUP-2');
    await criar('DUP-3');
    await criar('LOTE-LOCAL', { imagem_url: '/img/lote-local.webp' });
    await criar('LOTE-E');
    await criar('LOTE-F');
});

after(async () => {
    await sequelize.close();
});

// Zip de teste. Cada item: nome -> conteúdo (nível 0 = armazenado; nível 6 = deflate).
const montarZip = (arquivos, nivel = 0) => Buffer.from(zipSync(
    Object.fromEntries(Object.entries(arquivos).map(([nome, conteudo]) => [nome, [new Uint8Array(conteudo), { level: nivel }]]))
));
const enviar = (zip, { substituir, nome = 'fotos.zip', auth = equipe.auth } = {}) => {
    const req = request(app).post('/api/v1/produtos/imagens/lote').set('Authorization', auth);
    if (substituir !== undefined) req.field('substituir', substituir);
    return req.attach('arquivo', zip, { filename: nome, contentType: 'application/zip' });
};
const produtoDe = (chave) => Produto.findByPk(ids[chave]);
const arquivoDe = (url) => path.join(config.uploads.dir, url.replace('/arquivos/uploads/', ''));
const arquivosDaPasta = () => fs.readdirSync(config.uploads.dir, { withFileTypes: true }).filter((i) => i.isFile()).map((i) => i.name);

describe('POST /produtos/imagens/lote', () => {
    test('aplica as fotos pelo SKU (ignorando pasta, maiúsculas e espaços) e audita cada produto', async () => {
        const zip = montarZip({
            'fotos/  lote-a .PNG': PNG,
            'LOTE-B.jpeg': JPEG,
            '110606.webp': WEBP
        });
        const resposta = await enviar(zip).expect(200);
        const r = resposta.body.relatorio;
        assert.equal(r.total_arquivos, 3);
        assert.equal(r.aplicadas, 3);
        assert.deepEqual([r.sem_produto, r.formato_invalido, r.grande_demais, r.duplicadas, r.falhas], [[], [], [], [], []]);
        assert.equal(r.ignoradas_ja_tem_imagem, 0);
        assert.deepEqual(r.listas_cortadas, []);

        for (const [chave, extensao] of [['LOTE-A', 'png'], ['LOTE-B', 'jpg'], ['110606', 'webp']]) {
            const produto = await produtoDe(chave);
            assert.match(produto.imagem_url, new RegExp(`^/arquivos/uploads/[0-9a-f-]{36}\\.${extensao}$`), chave);
            assert.ok(fs.existsSync(arquivoDe(produto.imagem_url)));
            const auditoria = await Auditoria.findOne({ where: { entidade: 'produto', id_entidade: String(ids[chave]), acao: 'produto.editar' } });
            assert.equal(auditoria.resumo.alteracoes.imagem_url.depois, produto.imagem_url);
            assert.equal(auditoria.id_usuario, equipe.usuario.id_usuario);
        }
        await request(app).get((await produtoDe('LOTE-A')).imagem_url).expect(200);
    });

    test('relatório: sem produto, formato inválido (arquivo falso e extensão), imagem grande, duplicadas e arquivos do sistema', async () => {
        const grande = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
        const zip = montarZip({
            'LOTE-E.png': PNG,
            'lote-e.jpg': JPEG, // duplicada: vale a primeira
            'NAO-EXISTE.png': PNG,
            'LOTE-F.png': Buffer.from('isto não é um PNG'),
            'leia-me.txt': Buffer.from('texto'),
            'sem-extensao': PNG,
            'GRANDE.png': grande,
            '__MACOSX/._LOTE-E.png': PNG,
            'fotos/.DS_Store': Buffer.from('x'),
            '.oculto.png': PNG,
            'pasta/': new Uint8Array(0)
        }, 6);
        const antes = arquivosDaPasta().length;
        const resposta = await enviar(zip).expect(200);
        const r = resposta.body.relatorio;
        assert.equal(r.aplicadas, 1);
        assert.deepEqual(r.duplicadas, ['lote-e.jpg']);
        assert.deepEqual(r.sem_produto, ['NAO-EXISTE.png', 'GRANDE.png']);
        assert.deepEqual(r.formato_invalido.sort(), ['LOTE-F.png', 'leia-me.txt', 'sem-extensao'].sort());
        assert.equal(r.arquivos_ignorados_do_sistema, 3);
        assert.equal(r.total_arquivos, 7);
        // GRANDE.png não casa com produto algum: o casamento vem antes da checagem de tamanho.
        assert.equal(arquivosDaPasta().length, antes + 1, 'só a imagem aplicada foi gravada');
        assert.equal((await produtoDe('LOTE-F')).imagem_url, null);
    });

    test('imagem acima de 5 MB de um produto existente vai para grande_demais, sem derrubar as outras', async () => {
        const produto = await Produto.create({ sku: 'LOTE-G', nome: 'G', quantidade_estoque: 1 });
        const zip = montarZip({ 'LOTE-G.png': Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), 'LOTE-H.png': PNG }, 6);
        await Produto.create({ sku: 'LOTE-H', nome: 'H', quantidade_estoque: 1 });
        const r = (await enviar(zip).expect(200)).body.relatorio;
        assert.deepEqual(r.grande_demais, ['LOTE-G.png']);
        assert.equal(r.aplicadas, 1);
        assert.equal((await Produto.findByPk(produto.id_produto)).imagem_url, null);
    });

    test('produto que já tem imagem é ignorado; com substituir=sim troca e apaga o upload anterior (não o caminho local /img)', async () => {
        const zip1 = montarZip({ 'LOTE-A.png': PNG, 'LOTE-LOCAL.png': PNG });
        const ignorado = (await enviar(zip1).expect(200)).body.relatorio;
        assert.equal(ignorado.aplicadas, 0);
        assert.equal(ignorado.ignoradas_ja_tem_imagem, 2);
        assert.equal((await produtoDe('LOTE-LOCAL')).imagem_url, '/img/lote-local.webp');

        const anterior = (await produtoDe('LOTE-A')).imagem_url;
        assert.ok(fs.existsSync(arquivoDe(anterior)));
        const trocado = (await enviar(zip1, { substituir: 'SIM' }).expect(200)).body.relatorio;
        assert.equal(trocado.aplicadas, 2);
        const novo = (await produtoDe('LOTE-A')).imagem_url;
        assert.notEqual(novo, anterior);
        assert.equal(fs.existsSync(arquivoDe(anterior)), false);
        assert.ok(fs.existsSync(arquivoDe(novo)));
        assert.match((await produtoDe('LOTE-LOCAL')).imagem_url, /^\/arquivos\/uploads\//);

        await enviar(zip1, { substituir: 'talvez' }).expect(422);
        await enviar(zip1, { substituir: 'nao' }).expect(200);
    });

    test('nomes com ../ nunca saem da pasta de uploads: os arquivos levam nome UUID', async () => {
        const zip = montarZip({ '../../fora/LOTE-F.png': PNG, '..\\..\\x\\NAO-EXISTE.png': PNG });
        const r = (await enviar(zip).expect(200)).body.relatorio;
        assert.equal(r.aplicadas, 1);
        const produto = await produtoDe('LOTE-F');
        assert.match(produto.imagem_url, /^\/arquivos\/uploads\/[0-9a-f-]{36}\.png$/);
        assert.deepEqual(r.sem_produto, ['NAO-EXISTE.png']);
        for (const nome of arquivosDaPasta()) assert.match(nome, /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/);
        assert.ok(!fs.existsSync(path.join(config.uploads.dir, '..', 'fora')));
    });

    test('duplicadas: vale o primeiro arquivo válido do produto, na ordem do ZIP', async () => {
        const grande = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
        // DUP-1: primeira inválida (assinatura falsa) e segunda válida -> aplica a segunda.
        // DUP-2: duas válidas -> aplica a primeira; a segunda é duplicada.
        // DUP-3: primeira grande demais, segunda válida (mesmo nome em outra pasta), terceira duplicada.
        const zip = montarZip({
            'a/DUP-1.png': Buffer.from('não sou PNG'),
            'b/DUP-1.jpg': JPEG,
            'DUP-2.png': PNG,
            'DUP-2.jpg': JPEG,
            'x/DUP-3.png': grande,
            'y/DUP-3.png': PNG,
            'z/DUP-3.png': PNG
        }, 6);
        const r = (await enviar(zip).expect(200)).body.relatorio;
        assert.equal(r.aplicadas, 3);
        assert.deepEqual(r.formato_invalido, ['DUP-1.png']);
        assert.deepEqual(r.grande_demais, ['DUP-3.png']);
        assert.deepEqual(r.duplicadas, ['DUP-2.jpg', 'DUP-3.png']);
        assert.match((await produtoDe('DUP-1')).imagem_url, /\.jpg$/);
        assert.match((await produtoDe('DUP-2')).imagem_url, /\.png$/);
        assert.match((await produtoDe('DUP-3')).imagem_url, /\.png$/);
    });

    test('o casamento usa somente o SKU do banco: um nome que não é SKU vai para sem_produto', async () => {
        const r = (await enviar(montarZip({ 'SKU-101.png': PNG })).expect(200)).body.relatorio;
        assert.deepEqual(r.sem_produto, ['SKU-101.png']);
    });

    test('GIF é aceito', async () => {
        const produto = await Produto.create({ sku: 'LOTE-GIF', nome: 'Gif', quantidade_estoque: 1 });
        const r = (await enviar(montarZip({ 'LOTE-GIF.gif': GIF })).expect(200)).body.relatorio;
        assert.equal(r.aplicadas, 1);
        assert.match((await Produto.findByPk(produto.id_produto)).imagem_url, /\.gif$/);
    });

    test('ZIP corrompido, truncado ou que não é ZIP: 422 ZIP_INVALIDO', async () => {
        const bom = montarZip({ 'LOTE-A.png': PNG });
        const casos = [crypto.randomBytes(500), bom.subarray(0, bom.length - 30), Buffer.from('texto qualquer')];
        for (const conteudo of casos) {
            const r = await enviar(conteudo).expect(422);
            assert.equal(r.body.codigo, 'ZIP_INVALIDO');
        }
        // Entrada corrompida dentro de um ZIP bom: só ela falha.
        const zipRuim = Buffer.from(montarZip({ 'LOTE-B.png': PNG, 'LOTE-E.png': PNG }));
        const posicao = zipRuim.indexOf(PNG);
        zipRuim.fill(0, posicao, posicao + 20); // estraga a assinatura do primeiro PNG
        const r = (await enviar(zipRuim, { substituir: 'sim' }).expect(200)).body.relatorio;
        assert.equal(r.formato_invalido.length, 1);
        assert.equal(r.aplicadas, 1);
        await enviar(bom, { nome: 'fotos.txt' }).expect(422);
        await request(app).post('/api/v1/produtos/imagens/lote').set('Authorization', equipe.auth).expect(422);
    });

    test('limites: mais de 200 arquivos, mais de 100 MB descompactado e ZIP acima de 20 MB pedem para dividir', async () => {
        const arquivos = {};
        for (let i = 0; i < 201; i += 1) arquivos[`X${i}.png`] = PNG;
        const muitos = await enviar(montarZip(arquivos)).expect(422);
        assert.equal(muitos.body.codigo, 'ZIP_MUITO_GRANDE');
        assert.match(muitos.body.mensagem, /mais de um ZIP/);

        // Exatamente 200 é aceito.
        delete arquivos['X200.png'];
        const limite = (await enviar(montarZip(arquivos)).expect(200)).body.relatorio;
        assert.equal(limite.total_arquivos, 200);
        assert.equal(limite.sem_produto.length, 200);
        assert.deepEqual(limite.listas_cortadas, []);

        // ZIP bomba: pequeno comprimido, 105 MB descompactados.
        const bomba = {};
        for (let i = 0; i < 21; i += 1) bomba[`B${i}.png`] = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]);
        const comprimido = montarZip(bomba, 6);
        assert.ok(comprimido.length < 20 * 1024 * 1024);
        const total = await enviar(comprimido).expect(422);
        assert.equal(total.body.codigo, 'ZIP_MUITO_GRANDE');
        assert.match(total.body.mensagem, /mais de um ZIP/);

        const gigante = await enviar(crypto.randomBytes(21 * 1024 * 1024)).expect(422);
        assert.equal(gigante.body.codigo, 'ZIP_MUITO_GRANDE');
    });

    test('só a equipe, e não deixa ZIP temporário para trás', async () => {
        const cliente = await criarUsuario('cliente');
        const zip = montarZip({ 'LOTE-B.png': PNG });
        await enviar(zip, { auth: cliente.auth }).expect(403);
        await request(app).post('/api/v1/produtos/imagens/lote').attach('arquivo', zip, 'a.zip').expect(401);
        await enviar(zip).expect(200);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const pastaTemporaria = path.join(config.uploads.dir, '.lote');
        assert.deepEqual(fs.existsSync(pastaTemporaria) ? fs.readdirSync(pastaTemporaria) : [], []);
    });
});
