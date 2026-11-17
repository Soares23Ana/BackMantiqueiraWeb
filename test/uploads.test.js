const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { unzipSync } = require('fflate');
const { prepararApp, criarUsuario, config } = require('./ajuda');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

let app;
let sequelize;
let Produto;
let equipe;
let produto;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto } = require('../models'));
    equipe = await criarUsuario('equipe');
    produto = await Produto.create({ sku: 'UP-1', nome: 'Produto de foto', quantidade_estoque: 1 });
});

after(async () => {
    await sequelize.close();
});

const enviar = () => request(app).post(`/api/v1/produtos/${produto.id_produto}/imagem`).set('Authorization', equipe.auth)
    .attach('imagem', PNG, { filename: 'foto.png', contentType: 'image/png' });
const arquivoDe = (url) => path.join(config.uploads.dir, url.replace('/arquivos/uploads/', ''));

describe('pasta de uploads (UPLOADS_DIR)', () => {
    test('o upload grava em UPLOADS_DIR e a foto é servida na mesma URL, com cache longo', async () => {
        assert.ok(config.uploads.definido);
        assert.ok(path.isAbsolute(config.uploads.dir));
        const resposta = await enviar().expect(200);
        const url = resposta.body.produto.imagem_url;
        assert.match(url, /^\/arquivos\/uploads\/[0-9a-f-]{36}\.png$/);
        assert.ok(fs.existsSync(arquivoDe(url)));
        const servida = await request(app).get(url).expect(200);
        assert.match(servida.headers['cache-control'], /max-age=2592000/);
        assert.match(servida.headers['cache-control'], /immutable/);
        await request(app).get('/arquivos/uploads/00000000-0000-0000-0000-000000000000.png').expect(404);
    });

    test('a troca da imagem do produto apaga o arquivo anterior', async () => {
        const primeira = (await enviar().expect(200)).body.produto.imagem_url;
        const segunda = (await enviar().expect(200)).body.produto.imagem_url;
        assert.notEqual(primeira, segunda);
        assert.equal(fs.existsSync(arquivoDe(primeira)), false);
        assert.equal(fs.existsSync(arquivoDe(segunda)), true);
    });

    test('prepararPastaUploads confirma a gravação e conta os arquivos', async () => {
        const { prepararPastaUploads } = require('../lib/uploads');
        const estado = await prepararPastaUploads();
        assert.equal(estado.criada, false);
        assert.equal(estado.gravavel, true);
        assert.ok(estado.arquivos >= 1);
    });
});

describe('npm run uploads:mover', () => {
    test('copia sem sobrescrever, é idempotente e --simular não grava', async () => {
        const { moverUploads } = require('../scripts/mover-uploads');
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'mantiqueira-mover-'));
        const origem = path.join(raiz, 'origem');
        const destino = path.join(raiz, 'destino');
        fs.mkdirSync(origem);
        fs.writeFileSync(path.join(origem, 'a.png'), 'A');
        fs.writeFileSync(path.join(origem, 'b.jpg'), 'B');
        fs.writeFileSync(path.join(origem, '.oculto'), 'x');
        try {
            const simulado = await moverUploads({ origem, destino, simular: true });
            assert.deepEqual(simulado, { copiados: 2, ja_existentes: 0, total: 2, mesma_pasta: false });
            assert.equal(fs.existsSync(destino), false);

            assert.deepEqual(await moverUploads({ origem, destino }), { copiados: 2, ja_existentes: 0, total: 2, mesma_pasta: false });
            assert.equal(fs.readFileSync(path.join(destino, 'a.png'), 'utf8'), 'A');
            assert.ok(fs.existsSync(path.join(origem, 'a.png')), 'copia, não move');

            fs.writeFileSync(path.join(destino, 'a.png'), 'EDITADO');
            assert.deepEqual(await moverUploads({ origem, destino }), { copiados: 0, ja_existentes: 2, total: 2, mesma_pasta: false });
            assert.equal(fs.readFileSync(path.join(destino, 'a.png'), 'utf8'), 'EDITADO');

            assert.equal((await moverUploads({ origem, destino: origem })).mesma_pasta, true);
        } finally {
            fs.rmSync(raiz, { recursive: true, force: true });
        }
    });
});

describe('npm run backup:fotos', () => {
    test('gera o ZIP com as fotos e mantém só as últimas cópias', async () => {
        const { fazerBackup } = require('../scripts/backup-fotos');
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'mantiqueira-backup-'));
        const origem = path.join(raiz, 'fotos');
        const destino = path.join(raiz, 'backups');
        fs.mkdirSync(origem);
        fs.writeFileSync(path.join(origem, 'a.png'), PNG);
        fs.writeFileSync(path.join(origem, 'b.png'), PNG);
        fs.writeFileSync(path.join(origem, '.oculto'), 'x');
        try {
            let ultimo;
            for (let dia = 1; dia <= 4; dia += 1) {
                ultimo = await fazerBackup({ origem, destino, manter: 2, agora: new Date(2026, 0, dia, 3, 0, 0) });
            }
            assert.equal(ultimo.arquivo, 'fotos-20260104-030000.zip');
            assert.equal(ultimo.arquivos, 2);
            assert.ok(ultimo.tamanho_bytes > 0);
            assert.deepEqual(fs.readdirSync(destino).sort(), ['fotos-20260103-030000.zip', 'fotos-20260104-030000.zip']);
            const conteudo = unzipSync(new Uint8Array(fs.readFileSync(ultimo.caminho)));
            assert.deepEqual(Object.keys(conteudo).sort(), ['a.png', 'b.png']);
            assert.deepEqual(Buffer.from(conteudo['a.png']), PNG);

            // Falha: origem inexistente não deixa arquivo parcial.
            await assert.rejects(fazerBackup({ origem: path.join(raiz, 'nao-existe'), destino, manter: 2 }));
            assert.equal(fs.readdirSync(destino).length, 2);
        } finally {
            fs.rmSync(raiz, { recursive: true, force: true });
        }
    });

    test('o comando termina com código diferente de zero se falhar', () => {
        const { spawnSync } = require('node:child_process');
        const script = path.join(__dirname, '..', 'scripts', 'backup-fotos.js');
        // O script lê as variáveis do ambiente; com NODE_ENV=test e as pastas temporárias dos testes.
        const ruim = spawnSync(process.execPath, [script], {
            env: { ...process.env, UPLOADS_DIR: path.join(os.tmpdir(), 'mantiqueira-inexistente-xyz') },
            encoding: 'utf8'
        });
        assert.notEqual(ruim.status, 0);
        const bom = spawnSync(process.execPath, [script], { env: process.env, encoding: 'utf8' });
        assert.equal(bom.status, 0, bom.stderr);
        assert.match(bom.stdout, /Arquivos: \d+/);
    });
});
