const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const { unzipSync, strFromU8 } = require('fflate');
const { readSheet } = require('read-excel-file/node');
const { ErroApi } = require('./erros');
const { lerCsvMatriz } = require('./csv');
const { semAcento } = require('./texto');

/**
 * Leitura de planilhas de importação: CSV e Excel (.xlsx, só a PRIMEIRA aba).
 * As duas origens viram a mesma matriz de texto aparado, para reaproveitar a validação linha a linha, a simulação
 * e o relatório do importador. Não usa o pacote "xlsx" (vulnerável); a leitura é do read-excel-file.
 */
const LIMITE_BYTES = 5 * 1024 * 1024;
const LIMITE_LINHAS = 20000;
// Proteção contra .xlsx "bomba" (poucos KB que descompactam em gigabytes).
const LIMITE_DESCOMPACTADO = 100 * 1024 * 1024;
const FORMATOS_ANTIGOS = ['.xls', '.xlsm', '.xlsb'];

const MENSAGEM_ANTIGO = 'Salve o arquivo como .xlsx ou CSV.';
const MENSAGEM_PLANILHA = 'Arquivo de planilha inválido.';

const planilhaInvalida = () => new ErroApi(422, 'PLANILHA_INVALIDA', MENSAGEM_PLANILHA);

// O Excel costuma salvar CSV em Windows-1252; se não for UTF-8 válido, lê como Latin-1.
function decodificarArquivo(buffer) {
    return isUtf8(buffer) ? buffer.toString('utf8') : buffer.toString('latin1');
}

// .xlsx é um zip: começa com "PK".
function temAssinaturaZip(buffer) {
    return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Formato pela extensão do nome: 'csv', 'xlsx' ou lança 422 (.xls, .xlsm e .xlsb pedem para salvar como .xlsx ou CSV).
 */
function formatoDoNome(nomeArquivo) {
    const extensao = path.extname(String(nomeArquivo || '')).toLowerCase();
    if (extensao === '.csv') return 'csv';
    if (extensao === '.xlsx') return 'xlsx';
    if (FORMATOS_ANTIGOS.includes(extensao)) {
        throw new ErroApi(422, 'VALIDACAO', MENSAGEM_ANTIGO);
    }
    throw new ErroApi(422, 'VALIDACAO', 'Envie um arquivo .csv ou .xlsx.');
}

// Número inteiro vira texto sem ".0" nem notação científica (1391 => "1391"); decimais ficam com ponto.
function numeroParaTexto(numero) {
    if (Number.isInteger(numero)) return BigInt(numero).toString();
    if (!Number.isFinite(numero)) return String(numero);
    return numero.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

const doisDigitos = (n) => String(n).padStart(2, '0');

// O Excel guarda data e hora sem fuso: o leitor devolve esse "relógio de parede" nos campos UTC do Date, que
// aqui valem como horário de São Paulo. Saída: "AAAA-MM-DD HH:MM:SS".
function dataParaTexto(data) {
    return `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())} ` +
        `${doisDigitos(data.getUTCHours())}:${doisDigitos(data.getUTCMinutes())}:${doisDigitos(data.getUTCSeconds())}`;
}

function celulaParaTexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return dataParaTexto(valor);
    if (typeof valor === 'number') return numeroParaTexto(valor);
    if (typeof valor === 'boolean') return valor ? 'true' : 'false';
    return String(valor).trim();
}

// "B12" => { linha: 12, coluna: 1 } (colunas a partir de 0).
function parseEndereco(endereco) {
    const [, letras, linha] = /^([A-Z]+)(\d+)$/.exec(endereco) || [];
    if (!letras) return null;
    const coluna = [...letras].reduce((total, letra) => total * 26 + (letra.charCodeAt(0) - 64), 0) - 1;
    return { linha: Number(linha), coluna };
}

function lerArquivoDoZip(arquivos, nome) {
    const dados = arquivos[nome];
    return dados ? strFromU8(dados) : null;
}

/**
 * O leitor de .xlsx trata célula com erro (#N/D, #REF!...) como vazia. Para o relatório apontar a linha, procuramos
 * essas células direto no XML da primeira aba. Devolve Map("linha:coluna" => "#N/D").
 */
function encontrarCelulasComErro(buffer) {
    const mapa = new Map();
    const pequenos = unzipSync(buffer, {
        filter: (arquivo) => arquivo.originalSize <= LIMITE_DESCOMPACTADO &&
            ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels'].includes(arquivo.name)
    });
    const workbook = lerArquivoDoZip(pequenos, 'xl/workbook.xml');
    const relacoes = lerArquivoDoZip(pequenos, 'xl/_rels/workbook.xml.rels');
    if (!workbook || !relacoes) return mapa;
    const primeiraAba = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook);
    if (!primeiraAba) return mapa;
    const relacao = [...relacoes.matchAll(/<Relationship\b[^>]*>/g)].map((item) => item[0])
        .find((tag) => new RegExp(`\\bId="${primeiraAba[1]}"`).test(tag));
    const destino = relacao && /\bTarget="([^"]+)"/.exec(relacao);
    if (!destino) return mapa;
    const nomeAba = destino[1].startsWith('/') ? destino[1].slice(1) : `xl/${destino[1]}`;
    const abas = unzipSync(buffer, {
        filter: (arquivo) => arquivo.name === nomeAba && arquivo.originalSize <= LIMITE_DESCOMPACTADO
    });
    const xml = lerArquivoDoZip(abas, nomeAba);
    if (!xml) return mapa;
    for (const celula of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        if (!/\bt="e"/.test(celula[1])) continue;
        const endereco = /\br="([A-Z]+\d+)"/.exec(celula[1]);
        const posicao = endereco && parseEndereco(endereco[1]);
        if (!posicao) continue;
        const valor = /<v>([\s\S]*?)<\/v>/.exec(celula[2]);
        mapa.set(`${posicao.linha}:${posicao.coluna}`, valor ? valor[1].trim() : '#ERRO');
    }
    return mapa;
}

/**
 * Matriz de uma planilha .xlsx (primeira aba): [{ linha, celulas, erros }], sem as linhas totalmente vazias.
 * "erros" ({ coluna, erro }) lista as células com erro do Excel naquela linha. Qualquer falha de leitura
 * (arquivo corrompido, não é planilha) vira 422 PLANILHA_INVALIDA.
 */
async function lerXlsx(buffer) {
    if (!temAssinaturaZip(buffer)) throw planilhaInvalida();
    let dados;
    let celulasComErro;
    try {
        dados = await readSheet(buffer);
        celulasComErro = encontrarCelulasComErro(buffer);
    } catch {
        throw planilhaInvalida();
    }
    const linhas = [];
    dados.forEach((linhaBruta, indice) => {
        const numero = indice + 1;
        const celulas = linhaBruta.map(celulaParaTexto);
        const erros = [];
        for (const [chave, erro] of celulasComErro) {
            const [linha, coluna] = chave.split(':').map(Number);
            if (linha === numero) erros.push({ coluna, erro });
        }
        // Célula com erro conta como preenchida (a linha precisa aparecer no relatório).
        if (celulas.every((celula) => celula === '') && erros.length === 0) return;
        linhas.push({ linha: numero, celulas, erros });
    });
    return linhas;
}

/**
 * Lê o conteúdo de uma importação como matriz [{ linha, celulas, erros? }].
 * entrada: texto CSV (string) ou Buffer. Para Buffer, "formato" ('csv' ou 'xlsx', vindo da extensão do arquivo)
 * decide como ler; sem ele, a assinatura "PK" indica .xlsx.
 */
async function lerMatriz(entrada, { formato } = {}) {
    const ehBuffer = Buffer.isBuffer(entrada);
    const tamanho = ehBuffer ? entrada.length : Buffer.byteLength(String(entrada));
    if (tamanho > LIMITE_BYTES) {
        throw new ErroApi(422, 'ARQUIVO_MUITO_GRANDE', 'O arquivo deve ter no máximo 5 MB.');
    }
    const usarXlsx = ehBuffer && (formato ? formato === 'xlsx' : temAssinaturaZip(entrada));
    let linhas;
    if (usarXlsx) {
        linhas = await lerXlsx(entrada);
    } else {
        const texto = ehBuffer ? decodificarArquivo(entrada) : String(entrada);
        try {
            linhas = lerCsvMatriz(texto);
        } catch (erro) {
            throw new ErroApi(422, 'CSV_INVALIDO', `Não foi possível ler o CSV: ${erro.message}`);
        }
    }
    if (linhas.length - 1 > LIMITE_LINHAS) {
        throw new ErroApi(422, 'LIMITE_DE_LINHAS', `A planilha tem mais de ${LIMITE_LINHAS.toLocaleString('pt-BR')} linhas.`);
    }
    return { linhas, formato: usarXlsx ? 'xlsx' : 'csv' };
}

// Nome de coluna para comparar: sem acento, minúsculo e com espaços simples ("CÓDIGO  DE BARRAS" => "codigo de barras").
function normalizarNomeColuna(nome) {
    return semAcento(nome).toLowerCase().replace(/\s+/g, ' ').trim();
}

module.exports = {
    lerMatriz, formatoDoNome, decodificarArquivo, normalizarNomeColuna, temAssinaturaZip,
    LIMITE_BYTES, LIMITE_LINHAS, MENSAGEM_ANTIGO, FORMATOS_ANTIGOS
};
