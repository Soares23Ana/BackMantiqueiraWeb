const { test, before, after, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const request = require('supertest');
const { prepararApp, criarUsuario, config } = require('./ajuda');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);

let app;
let sequelize;
let Produto;
let Auditoria;
let equipe;
let servidor;
let base;
let ultimaRequisicao;
let permitirLoopbackNosTestes;
let baixarImagem;
let ipBloqueado;
let produto;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto, Auditoria } = require('../models'));
    ({ baixarImagem, ipBloqueado, permitirLoopbackNosTestes } = require('../servicos/baixarImagem'));
    equipe = await criarUsuario('equipe');
    produto = await Produto.create({ sku: 'LINK-1', nome: 'Produto do link', quantidade_estoque: 1 });

    servidor = http.createServer((req, res) => {
        ultimaRequisicao = req;
        const caminho = req.url.split('?')[0];
        const enviar = (tipo, corpo) => { res.writeHead(200, { 'Content-Type': tipo }); res.end(corpo); };
        switch (caminho) {
            case '/ok.png': return enviar('image/png', PNG);
            case '/ok.jpg': return enviar('image/jpeg; charset=binary', JPEG);
            case '/texto': return enviar('text/plain', 'olá');
            case '/falso.png': return enviar('image/png', Buffer.from('isto não é um PNG de verdade'));
            case '/svg': return enviar('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>');
            case '/svg-disfarcado': return enviar('image/png', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
            case '/vazio': return enviar('image/png', Buffer.alloc(0));
            case '/grande': {
                // Sem Content-Length: o limite precisa interromper o download em andamento.
                res.writeHead(200, { 'Content-Type': 'image/png' });
                res.write(PNG);
                const pedaco = Buffer.alloc(1024 * 1024);
                let enviados = 0;
                const escrever = () => {
                    while (enviados < 50 && !res.destroyed) {
                        enviados += 1;
                        if (!res.write(pedaco)) { res.once('drain', escrever); return; }
                    }
                    res.end();
                };
                req.socket.on('close', () => { servidor.interrompido = enviados; });
                return escrever();
            }
            case '/grande-declarado':
                res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(6 * 1024 * 1024) });
                return res.end(Buffer.alloc(10));
            case '/lento':
                res.writeHead(200, { 'Content-Type': 'image/png' });
                return undefined; // nunca termina
            case '/redireciona': res.writeHead(302, { Location: '/ok.png' }); return res.end();
            case '/redireciona-interno': res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); return res.end();
            case '/redireciona-localhost-nome': res.writeHead(302, { Location: 'http://10.0.0.7:9/x' }); return res.end();
            case '/redireciona-arquivo': res.writeHead(302, { Location: 'file:///etc/passwd' }); return res.end();
            case '/volta': res.writeHead(302, { Location: '/volta2' }); return res.end();
            case '/volta2': res.writeHead(302, { Location: '/volta3' }); return res.end();
            case '/volta3': res.writeHead(302, { Location: '/volta4' }); return res.end();
            case '/volta4': res.writeHead(302, { Location: '/ok.png' }); return res.end();
            case '/tres-saltos': res.writeHead(302, { Location: '/volta3' }); return res.end();
            case '/erro500': res.writeHead(500); return res.end('segredo interno do servidor remoto');
            default: res.writeHead(404); return res.end();
        }
    });
    await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${servidor.address().port}`;
    permitirLoopbackNosTestes(true);
});

after(async () => {
    permitirLoopbackNosTestes(false);
    servidor.closeAllConnections();
    await new Promise((resolve) => servidor.close(resolve));
    await sequelize.close();
});

const colarComo = (url, auth, id = produto.id_produto) =>
    request(app).post(`/api/v1/produtos/${id}/imagem/link`).set('Authorization', auth).send({ url });
const colar = (url, auth = equipe.auth, id = produto.id_produto) =>
    request(app).post(`/api/v1/produtos/${id}/imagem/link`).set('Authorization', auth).send({ url });
const arquivoDe = (url) => path.join(config.uploads.dir, url.replace('/arquivos/uploads/', ''));
const semResiduos = () => fs.readdirSync(config.uploads.dir).filter((nome) => nome.startsWith('.baixando-'));
const erroDe = async (promessa) => { try { await promessa; } catch (erro) { return erro; } return null; };

describe('POST /produtos/:id/imagem/link', () => {
    test('baixa, guarda a cópia em UPLOADS_DIR e audita a origem sem a query string', async () => {
        const resposta = await colar(`${base}/ok.png?token=SEGREDO&x=1`).expect(200);
        const url = resposta.body.produto.imagem_url;
        assert.match(url, /^\/arquivos\/uploads\/[0-9a-f-]{36}\.png$/);
        assert.ok(fs.existsSync(arquivoDe(url)));
        assert.deepEqual(fs.readFileSync(arquivoDe(url)), PNG);
        await request(app).get(url).expect(200);
        assert.deepEqual(semResiduos(), []);

        // Nenhum cookie nem credencial é enviado ao servidor remoto.
        assert.equal(ultimaRequisicao.headers.cookie, undefined);
        assert.equal(ultimaRequisicao.headers.authorization, undefined);

        const auditorias = await Auditoria.findAll({ where: { entidade: 'produto', id_entidade: String(produto.id_produto) } });
        const registro = auditorias.map((a) => a.resumo).find((r) => r.detalhe && r.detalhe.origem_url);
        assert.equal(registro.detalhe.origem_url, `${base}/ok.png`);
        assert.equal(registro.alteracoes.imagem_url.depois, url);
        assert.ok(!JSON.stringify(auditorias.map((a) => a.resumo)).includes('SEGREDO'));
    });

    test('a nova imagem substitui a anterior e apaga o arquivo antigo; aceita JPEG com charset e redirecionamento', async () => {
        const primeira = (await colar(`${base}/ok.png`).expect(200)).body.produto.imagem_url;
        const segunda = (await colar(`${base}/redireciona`).expect(200)).body.produto.imagem_url;
        assert.notEqual(primeira, segunda);
        assert.equal(fs.existsSync(arquivoDe(primeira)), false);
        const terceira = (await colar(`${base}/ok.jpg`).expect(200)).body.produto.imagem_url;
        assert.match(terceira, /\.jpg$/);
        assert.equal(fs.existsSync(arquivoDe(segunda)), false);
        assert.equal(fs.existsSync(arquivoDe(terceira)), true);
    });

    test('só a equipe; produto inexistente dá 404', async () => {
        const cliente = await criarUsuario('cliente');
        await colar(`${base}/ok.png`, cliente.auth).expect(403);
        await request(app).post(`/api/v1/produtos/${produto.id_produto}/imagem/link`).send({ url: `${base}/ok.png` }).expect(401);
        await colar(`${base}/ok.png`, equipe.auth, 999999).expect(404);
    });

    test('URL inválida: 422 URL_INVALIDA', async () => {
        const casos = [undefined, '', 123, 'não é url', 'ftp://exemplo.com/a.png', 'javascript:alert(1)',
            'http://usuario:senha@exemplo.com/a.png', 'https://token@exemplo.com/a.png', `https://exemplo.com/${'a'.repeat(2048)}`];
        for (const url of casos) {
            const resposta = await colar(url).expect(422);
            assert.equal(resposta.body.codigo, 'URL_INVALIDA', String(url).slice(0, 40));
        }
    });

    test('arquivo que não é imagem, SVG, assinatura falsa e vazio: 422 IMAGEM_INVALIDA, sem deixar resíduos', async () => {
        for (const caminho of ['/texto', '/falso.png', '/svg', '/svg-disfarcado', '/vazio']) {
            const resposta = await colar(`${base}${caminho}`).expect(422);
            assert.equal(resposta.body.codigo, 'IMAGEM_INVALIDA', caminho);
        }
        assert.deepEqual(semResiduos(), []);
    });

    test('imagem acima de 5 MB: 422 IMAGEM_MUITO_GRANDE, interrompendo o download', async () => {
        const grande = await colar(`${base}/grande`).expect(422);
        assert.equal(grande.body.codigo, 'IMAGEM_MUITO_GRANDE');
        const declarado = await colar(`${base}/grande-declarado`).expect(422);
        assert.equal(declarado.body.codigo, 'IMAGEM_MUITO_GRANDE');
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.ok(servidor.interrompido < 50, 'o servidor remoto deveria ter sido interrompido antes de enviar tudo');
        assert.deepEqual(semResiduos(), []);
    });

    test('resposta diferente de 200, conexão recusada e nome inexistente: 422 IMAGEM_INACESSIVEL sem detalhes', async () => {
        const quebrada = await colar(`${base}/erro500`).expect(422);
        assert.equal(quebrada.body.codigo, 'IMAGEM_INACESSIVEL');
        assert.ok(!JSON.stringify(quebrada.body).includes('segredo interno'));
        const naoExiste = await colar(`${base}/nao-existe`).expect(422);
        assert.equal(naoExiste.body.codigo, 'IMAGEM_INACESSIVEL');
        const recusada = await colar('http://127.0.0.1:1/a.png').expect(422);
        assert.equal(recusada.body.codigo, 'IMAGEM_INACESSIVEL');
        const semDns = await colar('http://host-que-nao-existe.invalid/a.png').expect(422);
        assert.equal(semDns.body.codigo, 'IMAGEM_INACESSIVEL');
        assert.ok(!/ECONN|ENOTFOUND|127\.0\.0\.1/.test(JSON.stringify(recusada.body) + JSON.stringify(semDns.body)));
    });

    test('limite de requisições por usuário (30 por minuto)', async () => {
        const outro = await criarUsuario('equipe');
        for (let i = 0; i < 30; i += 1) await colar('', outro.auth).expect(422);
        const bloqueada = await colar('', outro.auth).expect(429);
        assert.equal(bloqueada.body.codigo, 'LIMITE_REQUISICOES');
        // O limite é por usuário: outra pessoa da equipe não é afetada.
        await colar('', equipe.auth).expect(422);
    });
});

describe('proteção contra acesso à rede interna (SSRF)', () => {
    // Cada teste usa uma pessoa da equipe própria, para não esbarrar no limite de 30 requisições por minuto.
    let dono;
    beforeEach(async () => { dono = await criarUsuario('equipe'); });
    const colar = (url) => colarComo(url, dono.auth);

    test('endereços internos são recusados, em IPv4 e IPv6, inclusive IPv4 embutido', async () => {
        permitirLoopbackNosTestes(false);
        try {
            const alvos = [
                `${base}/ok.png`, // 127.0.0.1 com o loopback desligado
                'http://localhost:3000/saude', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/',
                'http://0.0.0.0/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://192.168.1.1/', 'http://100.64.0.1/',
                'http://169.254.169.254/latest/meta-data/', 'http://224.0.0.1/', 'http://255.255.255.255/',
                'http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/',
                'http://[::ffff:169.254.169.254]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[fc00::1]/',
                'http://[ff02::1]/', 'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:a9fe:a9fe::1]/', 'http://[::127.0.0.1]/'
            ];
            for (const alvo of alvos) {
                const resposta = await colar(alvo).expect(422);
                assert.equal(resposta.body.codigo, 'URL_NAO_PERMITIDA', alvo);
                assert.ok(!/169\.254|127\.0|10\.0/.test(JSON.stringify(resposta.body)), 'a resposta não pode ecoar o endereço');
            }
        } finally {
            permitirLoopbackNosTestes(true);
        }
    });

    test('mesmo com o loopback liberado nos testes, redes privadas e metadados continuam bloqueados', async () => {
        for (const alvo of ['http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3/', 'http://[::ffff:10.0.0.1]/']) {
            assert.equal((await colar(alvo).expect(422)).body.codigo, 'URL_NAO_PERMITIDA', alvo);
        }
    });

    test('redirecionamento para endereço interno ou esquema proibido é recusado', async () => {
        for (const caminho of ['/redireciona-interno', '/redireciona-localhost-nome', '/redireciona-arquivo']) {
            const resposta = await colar(`${base}${caminho}`).expect(422);
            assert.equal(resposta.body.codigo, 'URL_NAO_PERMITIDA', caminho);
        }
    });

    test('no máximo 3 redirecionamentos', async () => {
        // /tres-saltos -> /volta3 -> /volta4 -> /ok.png (3 redirecionamentos): aceito.
        await colar(`${base}/tres-saltos`).expect(200);
        // /volta -> /volta2 -> /volta3 -> /volta4 -> /ok.png (4 redirecionamentos): recusado.
        const resposta = await colar(`${base}/volta`).expect(422);
        assert.equal(resposta.body.codigo, 'IMAGEM_INACESSIVEL');
    });

    test('o nome que resolve para endereço interno é bloqueado na própria conexão (lookup)', async () => {
        permitirLoopbackNosTestes(false);
        try {
            const erro = await erroDe(baixarImagem(`http://localhost:${servidor.address().port}/ok.png`));
            assert.equal(erro.codigo, 'URL_NAO_PERMITIDA');
        } finally {
            permitirLoopbackNosTestes(true);
        }
        const permitido = await baixarImagem(`http://localhost:${servidor.address().port}/ok.png`);
        assert.ok(permitido.nomeArquivo);
        fs.unlinkSync(path.join(config.uploads.dir, permitido.nomeArquivo));
    });

    test('tempo esgotado: IMAGEM_INACESSIVEL e sem resíduos', async () => {
        const inicio = Date.now();
        const erro = await erroDe(baixarImagem(`${base}/lento`, { tempoMs: 300 }));
        assert.equal(erro.codigo, 'IMAGEM_INACESSIVEL');
        assert.ok(Date.now() - inicio < 3000);
        assert.deepEqual(semResiduos(), []);
    });

    test('tabela de endereços (ipBloqueado)', () => {
        const bloqueados = ['127.0.0.1', '10.0.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '0.0.0.0', '100.100.100.100',
            '224.0.0.1', '240.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fdff::1', 'ff00::1', '::ffff:127.0.0.1', '::ffff:0a00:0001',
            '::ffff:169.254.169.254', '2001:db8::1', '2002:7f00:0001::', '64:ff9b::7f00:1', 'não-é-ip', ''];
        for (const ip of bloqueados) assert.equal(ipBloqueado(ip), true, ip);
        const liberados = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '191.252.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888',
            '::ffff:8.8.8.8', '64:ff9b::808:808'];
        for (const ip of liberados) assert.equal(ipBloqueado(ip), false, ip);
        assert.equal(ipBloqueado('127.0.0.1', { permitirLoopback: true }), false);
        assert.equal(ipBloqueado('::ffff:127.0.0.1', { permitirLoopback: true }), false);
        assert.equal(ipBloqueado('10.0.0.1', { permitirLoopback: true }), true);
    });
});
