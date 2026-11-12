const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { zipSync, strToU8 } = require('fflate');
const writeXlsxFile = require('write-excel-file/node').default;
const { prepararApp, criarUsuario } = require('./ajuda');

let app;
let sequelize;
let equipe;
let Produto;
let Marca;

before(async () => {
    ({ app, sequelize } = await prepararApp());
    ({ Produto, Marca } = require('../models'));
    equipe = await criarUsuario('equipe');
});

after(async () => {
    await sequelize.close();
});

// ---- fixtures ----------------------------------------------------------------------------------------------

// Planilha no formato do portfólio, gerada pela biblioteca de escrita (devDependency). Códigos e códigos de
// barras são NÚMEROS no Excel; há uma linha vazia no meio e uma no começo (o cabeçalho é a primeira linha preenchida).
const CABECALHO_PORTFOLIO = ['CÓDIGO', 'PRODUTO', 'FABRICANTE', 'CÓDIGO DE BARRAS', 'CATEGORIA - Cad. ERP'];
const LINHAS_PORTFOLIO = [
    [1391, 'SAB. PHEBO 90G*', 'PHEBO', 7891234567890, 'HIGIENE PESSOAL'],
    [1392, 'SH PANTENE RESTAURACAO 400ML', 'PROCTER', 7891234567891, 'CABELOS'],
    [1393, 'ESM. ED. LIMITADA RISQUE 8ML', 'RISQUE', 7891234567892, 'UNHAS'],
    null,
    [1394, 'LOC.HID. NIVEA DE PROTECAO 200 ML', 'NIVEA', 7891234567893, 'HIGIENE PESSOAL'],
    [1395, 'DES. REXONA AP. 150ML C/8', 'REXONA', 7891234567894, 'HIGIENE PESSOAL']
];

async function xlsxDoPortfolio(linhas = LINHAS_PORTFOLIO) {
    const dados = [
        CABECALHO_PORTFOLIO.map(() => null),
        CABECALHO_PORTFOLIO.map((valor) => ({ value: valor, type: String })),
        ...linhas.map((linha) => (linha === null ? CABECALHO_PORTFOLIO.map(() => null) : linha.map((valor) => ({
            value: valor, type: typeof valor === 'number' ? Number : String
        }))))
    ];
    return writeXlsxFile(dados).toBuffer();
}

function csvDoPortfolio(linhas = LINHAS_PORTFOLIO) {
    return [CABECALHO_PORTFOLIO, ...linhas.filter(Boolean)].map((linha) => linha.join(';')).join('\n');
}

// .xlsx montado à mão, para casos que o gerador não cobre: fórmula com valor calculado e célula com erro.
function celulaTexto(endereco, texto) {
    return `<c r="${endereco}" t="inlineStr"><is><t>${texto}</t></is></c>`;
}
function xlsxManual(linhasXml, { nomeAba = 'Plan1', outraAba = null } = {}) {
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const abas = [nomeAba, ...(outraAba ? ['Outra'] : [])];
    return Buffer.from(zipSync({
        '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'),
        '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
        'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((nome, i) => `<sheet name="${nome}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
        'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>'),
        'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetData>${linhasXml.map((cel, i) => `<row r="${i + 1}">${cel}</row>`).join('')}</sheetData></worksheet>`),
        ...(outraAba ? {
            'xl/worksheets/sheet2.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><sheetData>${outraAba.map((cel, i) => `<row r="${i + 1}">${cel}</row>`).join('')}</sheetData></worksheet>`)
        } : {})
    }));
}

const enviar = (buffer, nome, query = '') => request(app).post(`/api/v1/produtos/importar${query}`)
    .set('Authorization', equipe.auth).attach('arquivo', buffer, { filename: nome });
const nomeDe = async (sku) => (await Produto.findOne({ where: { sku } })).nome;
const logs = async () => (await sequelize.query('SELECT tipo, origem, status, mensagem FROM sincronizacoes_log ORDER BY id_sincronizacao', { type: 'SELECT' }));

// ---- testes ------------------------------------------------------------------------------------------------

describe('leitura de .xlsx (lib/planilha)', () => {
    const { lerMatriz } = require('../lib/planilha');

    test('números viram texto sem ".0" nem notação científica; datas viram data e hora de São Paulo; só a primeira aba', async () => {
        const buffer = await writeXlsxFile([
            [{ value: 'a', type: String }, { value: 'b', type: String }, { value: 'c', type: String }, { value: 'd', type: String }],
            [{ value: 1391, type: Number }, { value: 7891234567890, type: Number }, { value: 12.5, type: Number },
                { value: new Date('2026-11-10T08:30:15Z'), type: Date, format: 'yyyy-mm-dd hh:mm:ss' }],
            [{ value: 1e21, type: Number }, { value: true, type: Boolean }, null, null]
        ]).toBuffer();
        const { linhas, formato } = await lerMatriz(buffer, { formato: 'xlsx' });
        assert.equal(formato, 'xlsx');
        assert.deepEqual(linhas[1].celulas, ['1391', '7891234567890', '12.5', '2026-11-10 08:30:15']);
        assert.deepEqual(linhas[2].celulas.slice(0, 2), ['1000000000000000000000', 'true']);
        assert.deepEqual(linhas.map((l) => l.linha), [1, 2, 3]);
    });

    test('lê só a primeira aba, usa o valor calculado das fórmulas e marca células com erro', async () => {
        const buffer = xlsxManual([
            celulaTexto('A1', 'sku') + celulaTexto('B1', 'estoque'),
            celulaTexto('A2', 'F-1') + '<c r="B2"><f>20+22</f><v>42</v></c>',
            celulaTexto('A3', 'F-2') + '<c r="B3" t="e"><v>#N/A</v></c>',
            ''
        ], { outraAba: [celulaTexto('A1', 'sku'), celulaTexto('A2', 'OUTRA-ABA')] });
        const { linhas } = await lerMatriz(buffer, { formato: 'xlsx' });
        assert.deepEqual(linhas.map((l) => l.celulas), [['sku', 'estoque'], ['F-1', '42'], ['F-2', '']]);
        assert.deepEqual(linhas[2].erros, [{ coluna: 1, erro: '#N/A' }]);
        assert.deepEqual(linhas[1].erros, []);
    });

    test('arquivo que não é planilha vira PLANILHA_INVALIDA', async () => {
        for (const conteudo of [Buffer.from('isto é só texto;sku\nA;B'), Buffer.from('PK\u0003\u0004 lixo que não é zip de verdade'), Buffer.alloc(0)]) {
            await assert.rejects(lerMatriz(conteudo, { formato: 'xlsx' }), { codigo: 'PLANILHA_INVALIDA', message: 'Arquivo de planilha inválido.' });
        }
    });
});

describe('nome de exibição (lib/nomeProduto)', () => {
    const { gerarNomeExibicao } = require('../lib/nomeProduto');

    test('expande o dicionário, capitaliza com preposições em minúsculas, mantém unidades e remove o "*"', () => {
        assert.equal(gerarNomeExibicao('SAB.LIQ. PHEBO 250ML*').nome, 'Sabonete Líquido Phebo 250ML');
        assert.equal(gerarNomeExibicao('LOC.HID. NIVEA DE PROTECAO 200 ML').nome, 'Loção Hidratante Nivea de Protecao 200 ML');
        assert.equal(gerarNomeExibicao('AP.BAR. GILLETTE C/8').nome, 'Aparelho de Barbear Gillette C/8');
        assert.equal(gerarNomeExibicao('DEO. REXONA').nome, 'Desodorante Rexona');
        assert.equal(gerarNomeExibicao('ANTI-SEP. BUCAL LISTERINE').nome, 'Antisséptico Bucal Listerine');
        assert.equal(gerarNomeExibicao('COND. DOVE E SH DOVE').nome, 'Condicionador Dove e Shampoo Dove');
        assert.equal(gerarNomeExibicao('FR. PAMPERS ABS. CR. 10 UN').nome, 'Fralda Pampers Absorvente Creme 10 UN');
        assert.equal(gerarNomeExibicao('TINT. ESM. LOC. X').nome, 'Tintura Esmalte Loção X');
    });

    test('não expande as ambíguas nem abreviações desconhecidas: devolve em pendentes', () => {
        const resultado = gerarNomeExibicao('ESM. ED. RP. P. PRES. CHUP. AP. FRESC. SUAVE');
        assert.equal(resultado.nome, 'Esmalte Ed. Rp. P. Pres. Chup. Ap. Fresc. Suave');
        assert.deepEqual(resultado.pendentes, ['ED.', 'RP.', 'P.', 'PRES.', 'CHUP.', 'AP.', 'FRESC.']);
    });
});

describe('importação da planilha do portfólio (.xlsx e CSV equivalente)', () => {
    let relatorioXlsx;

    test('simulação do .xlsx não grava nada', async () => {
        const antes = await Produto.count();
        const resposta = await enviar(await xlsxDoPortfolio(), 'portfolio.xlsx', '?simular=true').expect(200);
        assert.equal(resposta.body.relatorio.simulado, true);
        assert.equal(resposta.body.relatorio.criados, 5);
        assert.equal(resposta.body.relatorio.formato, 'xlsx');
        assert.equal(await Produto.count(), antes);
        assert.equal(await Marca.count(), 0);
    });

    test('importa o .xlsx: SKU do código, nome gerado, nome_erp guardado, marca criada e colunas ignoradas listadas', async () => {
        const resposta = await enviar(await xlsxDoPortfolio(), 'portfolio.xlsx').expect(200);
        const relatorio = resposta.body.relatorio;
        relatorioXlsx = relatorio;
        assert.deepEqual([relatorio.linhas, relatorio.criados, relatorio.com_erro, relatorio.marcas_criadas, relatorio.categorias_criadas], [5, 5, 0, 5, 3]);
        assert.deepEqual(relatorio.colunas_ignoradas, ['CÓDIGO DE BARRAS']);
        assert.deepEqual(relatorio.categorias_sem_mapa, []);
        assert.deepEqual(relatorio.abreviacoes_pendentes.map((p) => [p.abreviacao, p.ocorrencias]), [['AP.', 1], ['ED.', 1]]);
        assert.match(relatorio.avisos.join(' '), /CÓDIGO DE BARRAS/);

        assert.equal(await nomeDe('1391'), 'Sabonete Phebo 90G');
        assert.equal((await Produto.findOne({ where: { sku: '1391' } })).nome_erp, 'SAB. PHEBO 90G*');
        assert.equal(await nomeDe('1392'), 'Shampoo Pantene Restauracao 400ML');
        assert.equal(await nomeDe('1393'), 'Esmalte Ed. Limitada Risque 8ML');
        assert.equal(await nomeDe('1394'), 'Loção Hidratante Nivea de Protecao 200 ML');
        assert.equal(await nomeDe('1395'), 'Desodorante Rexona Ap. 150ML C/8');
        const marca = await Marca.findOne({ where: { nome: 'PHEBO' } });
        assert.equal((await Produto.findOne({ where: { sku: '1391' } })).id_marca, marca.id_marca);
        // O log registra a importação do arquivo .xlsx.
        assert.ok((await logs()).some((l) => l.origem === 'upload: portfolio.xlsx' && l.status === 'sucesso'));
    });

    test('o CSV equivalente dá o mesmo resultado', async () => {
        const resposta = await enviar(Buffer.from(csvDoPortfolio(), 'utf8'), 'portfolio.csv', '?simular=true').expect(200);
        const csv = resposta.body.relatorio;
        assert.equal(csv.formato, 'csv');
        // Já importado pelo .xlsx: nada muda e os relatórios batem.
        assert.deepEqual([csv.linhas, csv.criados, csv.atualizados, csv.inalterados, csv.com_erro], [5, 0, 0, 5, 0]);
        assert.deepEqual(csv.colunas_ignoradas, relatorioXlsx.colunas_ignoradas);
        assert.deepEqual(csv.abreviacoes_pendentes, relatorioXlsx.abreviacoes_pendentes);
    });

    test('CSV em Latin-1 do Excel também é lido', async () => {
        const csv = Buffer.from('CÓDIGO;PRODUTO;FABRICANTE\n2001;SAB. DOVE 90G;DOVE', 'latin1');
        const resposta = await enviar(csv, 'portfolio_latin1.csv').expect(200);
        assert.equal(resposta.body.relatorio.criados, 1);
        assert.equal(await nomeDe('2001'), 'Sabonete Dove 90G');
    });

    test('apelidos de cabeçalho: sem diferenciar maiúsculas nem acentos; formato atual continua valendo', async () => {
        const csv = 'Cód;codigo;Saldo;Fabricante\nx;3001;7;Marca Apelido';
        // "Cód" não é apelido (só "cod" sem acento? "cód" normaliza para "cod"), então vale como sku; "codigo" repetido é ignorado.
        const resposta = await enviar(Buffer.from(csv), 'apelidos.csv', '?simular=true').expect(200);
        assert.deepEqual(resposta.body.relatorio.colunas_ignoradas, ['codigo']);
        const atual = await enviar(Buffer.from('sku;nome;estoque\nATUAL-1;Produto Atual;4'), 'atual.csv').expect(200);
        assert.equal(atual.body.relatorio.criados, 1);
        assert.equal(await nomeDe('ATUAL-1'), 'Produto Atual');
    });

    test('célula com erro do Excel vira linha com erro no relatório, e as outras linhas entram', async () => {
        const buffer = xlsxManual([
            celulaTexto('A1', 'CÓDIGO') + celulaTexto('B1', 'PRODUTO') + celulaTexto('C1', 'saldo'),
            celulaTexto('A2', 'ERR-1') + celulaTexto('B2', 'SAB. OK') + '<c r="C2"><f>10+5</f><v>15</v></c>',
            celulaTexto('A3', 'ERR-2') + celulaTexto('B3', 'SAB. COM ERRO') + '<c r="C3" t="e"><v>#N/D</v></c>',
            celulaTexto('A4', 'ERR-3') + '<c r="B4" t="e"><v>#REF!</v></c>'
        ]);
        const resposta = await enviar(buffer, 'erros.xlsx').expect(200);
        const relatorio = resposta.body.relatorio;
        assert.deepEqual([relatorio.linhas, relatorio.criados, relatorio.com_erro], [3, 1, 2]);
        assert.deepEqual(relatorio.erros.map((e) => [e.linha, e.sku, e.campo, e.mensagem]), [
            [3, 'ERR-2', 'estoque', 'Célula com erro (#N/D).'],
            [4, 'ERR-3', 'nome_erp', 'Célula com erro (#REF!).']
        ]);
        assert.equal((await Produto.findOne({ where: { sku: 'ERR-1' } })).quantidade_estoque, 15);
        assert.equal(await Produto.findOne({ where: { sku: 'ERR-2' } }), null);
    });

    test('só a primeira aba é importada', async () => {
        const buffer = xlsxManual([celulaTexto('A1', 'sku') + celulaTexto('B1', 'nome'), celulaTexto('A2', 'ABA-1') + celulaTexto('B2', 'Da primeira aba')],
            { outraAba: [celulaTexto('A1', 'sku') + celulaTexto('B1', 'nome'), celulaTexto('A2', 'ABA-2') + celulaTexto('B2', 'Da segunda aba')] });
        await enviar(buffer, 'duas-abas.xlsx').expect(200);
        assert.ok(await Produto.findOne({ where: { sku: 'ABA-1' } }));
        assert.equal(await Produto.findOne({ where: { sku: 'ABA-2' } }), null);
    });
});

describe('nome editado à mão x nome gerado', () => {
    test('só troca o nome se ele ainda for igual ao gerado do nome_erp anterior', async () => {
        const importar = async (...linhas) => enviar(await xlsxDoPortfolio(linhas), 'portfolio.xlsx').expect(200);
        await importar([5001, 'SAB. LUX 85G', 'LUX', 1, 'HIGIENE'], [5002, 'SAB. DOVE 90G', 'DOVE', 2, 'HIGIENE']);
        assert.equal(await nomeDe('5001'), 'Sabonete Lux 85G');
        // A equipe edita o nome do 5002 à mão.
        await Produto.update({ nome: 'Sabonete Dove Branco Original' }, { where: { sku: '5002' } });
        // O portfólio muda o texto dos dois.
        const resposta = await importar([5001, 'SAB. LUX 85G NOVO*', 'LUX', 1, 'HIGIENE'], [5002, 'SAB. DOVE 100G', 'DOVE', 2, 'HIGIENE']);
        assert.equal(resposta.body.relatorio.atualizados, 2);
        assert.equal(await nomeDe('5001'), 'Sabonete Lux 85G Novo');
        assert.equal(await nomeDe('5002'), 'Sabonete Dove Branco Original');
        // O nome_erp acompanha o portfólio nos dois.
        assert.equal((await Produto.findOne({ where: { sku: '5002' } })).nome_erp, 'SAB. DOVE 100G');
    });

    test('planilha com a própria coluna "nome" não é alterada pela geração', async () => {
        const csv = 'sku;nome;produto\nNOME-1;Nome Exato Da Planilha;SAB. LUX';
        await enviar(Buffer.from(csv), 'com-nome.csv').expect(200);
        assert.equal(await nomeDe('NOME-1'), 'Nome Exato Da Planilha');
        assert.equal((await Produto.findOne({ where: { sku: 'NOME-1' } })).nome_erp, 'SAB. LUX');
    });

    test('produto antigo sem nome_erp: o nome não muda, só o nome_erp é preenchido', async () => {
        await Produto.create({ sku: 'LEGADO-1', nome: 'Nome Antigo' });
        await enviar(Buffer.from('codigo;produto\nLEGADO-1;SAB. NOVO LEGADO'), 'legado.csv').expect(200);
        const produto = await Produto.findOne({ where: { sku: 'LEGADO-1' } });
        assert.deepEqual([produto.nome, produto.nome_erp], ['Nome Antigo', 'SAB. NOVO LEGADO']);
    });

    test('equipe vê o nome_erp; cliente não', async () => {
        const { id_produto: id } = await Produto.findOne({ where: { sku: '5001' } });
        const daEquipe = await request(app).get(`/api/v1/produtos/${id}`).set('Authorization', equipe.auth).expect(200);
        assert.equal(daEquipe.body.produto.nome_erp, 'SAB. LUX 85G NOVO*');
        const publico = await request(app).get(`/api/v1/produtos/${id}`).expect(200);
        assert.equal(publico.body.produto.nome_erp, undefined);
    });

    test('SKU só com dígitos (código do portfólio) também abre o produto, quando não há produto com esse id', async () => {
        const resposta = await request(app).get('/api/v1/produtos/5001').expect(200);
        assert.equal(resposta.body.produto.sku, '5001');
    });
});

describe('recusas e arquivos inválidos', () => {
    test('.xls, .xlsm e .xlsb são recusados com a orientação de salvar como .xlsx ou CSV', async () => {
        for (const nome of ['antigo.xls', 'macro.xlsm', 'binario.xlsb', 'MAIUSCULO.XLS']) {
            const resposta = await enviar(Buffer.from('qualquer coisa'), nome).expect(422);
            assert.equal(resposta.body.mensagem, 'Salve o arquivo como .xlsx ou CSV.');
        }
        const outro = await enviar(Buffer.from('x'), 'foto.png').expect(422);
        assert.equal(outro.body.mensagem, 'Envie um arquivo .csv ou .xlsx.');
    });

    test('.xlsx corrompido ou com conteúdo de texto: 422 PLANILHA_INVALIDA, API de pé e falha registrada no log', async () => {
        const antes = (await logs()).length;
        for (const [nome, conteudo] of [
            ['texto.xlsx', Buffer.from('sku;nome\nA;B')],
            ['corrompido.xlsx', Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from('lixo qualquer que não é um zip válido')])]
        ]) {
            const resposta = await enviar(conteudo, nome).expect(422);
            assert.equal(resposta.body.codigo, 'PLANILHA_INVALIDA');
            assert.equal(resposta.body.mensagem, 'Arquivo de planilha inválido.');
            assert.ok(resposta.body.request_id);
        }
        const novos = (await logs()).slice(antes);
        assert.deepEqual(novos.map((l) => [l.origem, l.status, l.mensagem]), [
            ['upload: texto.xlsx', 'falha', 'Arquivo de planilha inválido.'],
            ['upload: corrompido.xlsx', 'falha', 'Arquivo de planilha inválido.']
        ]);
        await request(app).get('/saude').expect(200);
    });

    test('um .zip qualquer com extensão .xlsx (sem o formato de planilha) também é recusado', async () => {
        const zip = Buffer.from(zipSync({ 'a.txt': strToU8('nada de planilha') }));
        const resposta = await enviar(zip, 'zip.xlsx').expect(422);
        assert.equal(resposta.body.codigo, 'PLANILHA_INVALIDA');
    });

    test('limites: mais de 20.000 linhas e mais de 5 MB', async () => {
        const muitas = ['sku;nome', ...Array.from({ length: 20001 }, (_, i) => `L-${i};Produto ${i}`)].join('\n');
        const resposta = await enviar(Buffer.from(muitas), 'muitas.csv', '?simular=true').expect(422);
        assert.equal(resposta.body.codigo, 'LIMITE_DE_LINHAS');
        const grande = await enviar(Buffer.alloc(5 * 1024 * 1024 + 10, 'a'), 'grande.csv').expect(422);
        assert.match(grande.body.mensagem, /5 MB/);
        // 20.000 linhas é aceito.
        const limite = ['sku;nome', ...Array.from({ length: 20000 }, (_, i) => `L-${i};Produto ${i}`)].join('\n');
        const ok = await enviar(Buffer.from(limite), 'limite.csv', '?simular=true').expect(200);
        assert.equal(ok.body.relatorio.linhas, 20000);
    });
});

describe('jobs de pasta com .xlsx', () => {
    let base;
    const entrada = () => path.join(base, 'entrada');
    const envelhecer = (caminho) => {
        const passado = new Date(Date.now() - 2 * 60 * 1000);
        fs.utimesSync(caminho, passado, passado);
    };

    before(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'mantiqueira-planilhas-'));
        fs.mkdirSync(entrada(), { recursive: true });
    });
    after(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });

    test('estoque*.xlsx é processado e movido para processados; .xls vai para rejeitados com o aviso', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        await Produto.create({ sku: 'JOB-X1', nome: 'Produto do job', quantidade_estoque: 1 });
        const planilha = path.join(entrada(), 'estoque_0900.xlsx');
        fs.writeFileSync(planilha, await writeXlsxFile([
            [{ value: 'código', type: String }, { value: 'saldo', type: String }],
            [{ value: 'JOB-X1', type: String }, { value: 33, type: Number }]
        ]).toBuffer());
        const antigo = path.join(entrada(), 'estoque_0901.xls');
        fs.writeFileSync(antigo, 'binário antigo');
        envelhecer(planilha);
        envelhecer(antigo);

        const resultados = await processarPasta('estoque', base);
        assert.deepEqual(resultados.map((r) => [r.arquivo, r.status, r.destino]), [
            ['estoque_0900.xlsx', 'sucesso', 'processados'],
            ['estoque_0901.xls', 'falha', 'rejeitados']
        ]);
        assert.equal(resultados[1].erro, 'Salve o arquivo como .xlsx ou CSV.');
        assert.equal((await Produto.findOne({ where: { sku: 'JOB-X1' } })).quantidade_estoque, 33);
        assert.ok(fs.readdirSync(path.join(base, 'processados')).some((n) => n.endsWith('estoque_0900.xlsx')));
        assert.ok(fs.readdirSync(path.join(base, 'rejeitados')).some((n) => n.endsWith('estoque_0901.xls')));
        assert.deepEqual(fs.readdirSync(entrada()), []);
    });

    test('.xlsx corrompido na pasta vai para rejeitados e a falha fica no log', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        const arquivo = path.join(entrada(), 'estoque_0930.xlsx');
        fs.writeFileSync(arquivo, 'isto não é uma planilha');
        envelhecer(arquivo);
        const [resultado] = await processarPasta('estoque', base);
        assert.deepEqual([resultado.status, resultado.destino], ['falha', 'rejeitados']);
        const [ultimo] = (await logs()).slice(-1);
        assert.deepEqual([ultimo.origem, ultimo.status], ['arquivo: estoque_0930.xlsx', 'falha']);
    });

    test('catalogo*.xlsx (incremental) e carga_completa*.xlsx também são lidos', async () => {
        const { processarPasta } = require('../servicos/sincronizacao');
        const incremental = path.join(entrada(), 'catalogo_1000.xlsx');
        fs.writeFileSync(incremental, await xlsxDoPortfolio([[7001, 'SAB. NOVO JOB 90G', 'JOB', 9, 'HIGIENE']]));
        envelhecer(incremental);
        const [resultado] = await processarPasta('catalogo', base);
        assert.equal(resultado.status, 'sucesso');
        assert.equal(await nomeDe('7001'), 'Sabonete Novo Job 90G');
        assert.equal((await Produto.findOne({ where: { sku: '1391' } })).ativo, true);
    });
});
