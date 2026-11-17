// Baixa uma imagem de um endereço informado pela equipe e a grava em UPLOADS_DIR, com proteção contra SSRF.
//
// - Só http/https, até 2048 caracteres, sem usuário e senha.
// - O DNS é resolvido pela opção "lookup" da própria conexão: o endereço validado é exatamente o usado
//   para conectar (não há segunda resolução), o que impede rebinding de DNS. IPs literais na URL são
//   conferidos antes de conectar (o Node não chama o lookup para eles).
// - Bloqueia loopback, privados, link-local (inclusive 169.254.169.254), CGNAT, multicast, reservados e
//   não especificados, em IPv4 e IPv6 (inclusive IPv4 embutido em IPv6).
// - Até 3 redirecionamentos, cada um revalidado. Tempo total de 10 s. No máximo 5 MB, interrompendo o download.
// - Não envia cookies nem credenciais. Nada da resposta remota é devolvido ao usuário.
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');
const config = require('../config/ambiente');
const { ErroApi } = require('../lib/erros');
const { assinaturaConfere, detectarTipoImagem, lerCabecalho, LIMITE_IMAGEM_BYTES, TIPOS_IMAGEM } = require('../lib/imagem');
const { PASTA_UPLOADS, EXTENSAO_POR_TIPO, garantirPasta, novoNomeDeUpload, caminhoDoUpload } = require('../lib/uploads');

const MAXIMO_URL = 2048;
const MAXIMO_REDIRECIONAMENTOS = 3;
const TEMPO_TOTAL_MS = 10 * 1000;
const STATUS_REDIRECIONAMENTO = new Set([301, 302, 303, 307, 308]);

const erroUrlInvalida = () => new ErroApi(422, 'URL_INVALIDA',
    'Informe um endereço de imagem válido (http ou https, até 2048 caracteres, sem usuário e senha).');
const erroNaoPermitida = () => new ErroApi(422, 'URL_NAO_PERMITIDA', 'Este endereço não é permitido.');
const erroImagemInvalida = () => new ErroApi(422, 'IMAGEM_INVALIDA',
    'O endereço não aponta para uma imagem válida (JPEG, PNG, WEBP ou GIF).');
const erroMuitoGrande = () => new ErroApi(422, 'IMAGEM_MUITO_GRANDE', 'A imagem deve ter no máximo 5 MB.');
const erroInacessivel = () => new ErroApi(422, 'IMAGEM_INACESSIVEL',
    'Não foi possível baixar a imagem desse endereço. Confira o link e tente novamente.');

// Loopback só pode ser liberado em NODE_ENV=test (para o servidor HTTP local dos testes). Em produção é impossível.
const estadoTeste = { permitirLoopback: false };
function permitirLoopbackNosTestes(valor) {
    if (!config.teste) throw new Error('Só disponível com NODE_ENV=test.');
    estadoTeste.permitirLoopback = Boolean(valor);
}

// ---------- Endereços bloqueados ----------

function bytesIPv4(texto) {
    const partes = texto.split('.');
    if (partes.length !== 4) return null;
    const bytes = partes.map((parte) => (/^\d{1,3}$/.test(parte) ? Number(parte) : NaN));
    return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function ipv4Bloqueado([a, b, c], permitirLoopback) {
    if (a === 127) return !permitirLoopback;
    if (a === 0 || a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local e metadados da AWS
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 192 && b === 88 && c === 99) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    return a >= 224; // multicast, reservado e broadcast
}

// Converte um IPv6 (com ou sem IPv4 no final) em 16 bytes; null se malformado.
function bytesIPv6(texto) {
    let t = texto.split('%')[0].toLowerCase();
    if (t.includes('.')) {
        const posicao = t.lastIndexOf(':');
        const v4 = bytesIPv4(t.slice(posicao + 1));
        if (!v4) return null;
        t = `${t.slice(0, posicao + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
    }
    const lados = t.split('::');
    if (lados.length > 2) return null;
    const grupos = (lado) => (lado === '' ? [] : lado.split(':'));
    const inicio = grupos(lados[0]);
    const fim = lados.length === 2 ? grupos(lados[1]) : [];
    const faltam = 8 - inicio.length - fim.length;
    if (lados.length === 1 ? faltam !== 0 : faltam < 1) return null;
    const todos = [...inicio, ...Array(lados.length === 2 ? faltam : 0).fill('0'), ...fim];
    const bytes = [];
    for (const grupo of todos) {
        if (!/^[0-9a-f]{1,4}$/.test(grupo)) return null;
        const valor = parseInt(grupo, 16);
        bytes.push(valor >> 8, valor & 0xff);
    }
    return bytes.length === 16 ? bytes : null;
}

function ipv6Bloqueado(bytes, permitirLoopback) {
    const zerosAte = (n) => bytes.slice(0, n).every((b) => b === 0);
    // IPv4 mapeado (::ffff:a.b.c.d): vale a regra do IPv4 embutido.
    if (zerosAte(10) && bytes[10] === 0xff && bytes[11] === 0xff) return ipv4Bloqueado(bytes.slice(12), permitirLoopback);
    if (zerosAte(15) && bytes[15] === 1) return !permitirLoopback; // ::1
    if (zerosAte(12)) {
        // :: (não especificado) e ::a.b.c.d (IPv4 compatível, obsoleto).
        return bytes.slice(12).every((b) => b === 0) ? true : ipv4Bloqueado(bytes.slice(12), permitirLoopback);
    }
    // NAT64 (64:ff9b::/96): vale a regra do IPv4 embutido; o resto de 64:ff9b::/32 (uso local) é bloqueado.
    if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
        return bytes.slice(4, 12).every((b) => b === 0) ? ipv4Bloqueado(bytes.slice(12), permitirLoopback) : true;
    }
    // Só unicast global (2000::/3); o resto (fe80::/10, fc00::/7, ff00::/8, 100::/64...) é bloqueado.
    if ((bytes[0] >> 5) !== 1) return true;
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] <= 0x01) return true; // 2001::/23 (Teredo, protocolos)
    if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // documentação
    if (bytes[0] === 0x20 && bytes[1] === 0x02) return ipv4Bloqueado(bytes.slice(2, 6), permitirLoopback); // 6to4
    return false;
}

// true se o endereço IP (texto) não pode ser acessado. Texto que não seja IP válido também é bloqueado.
function ipBloqueado(ip, { permitirLoopback = false } = {}) {
    const texto = String(ip);
    if (net.isIPv4(texto)) {
        const bytes = bytesIPv4(texto);
        return !bytes || ipv4Bloqueado(bytes, permitirLoopback);
    }
    if (net.isIPv6(texto)) {
        const bytes = bytesIPv6(texto);
        return !bytes || ipv6Bloqueado(bytes, permitirLoopback);
    }
    return true;
}

// ---------- Validação da URL ----------

function interpretarUrl(texto, ErroParaFalha) {
    if (typeof texto !== 'string' || texto.length === 0 || texto.length > MAXIMO_URL) throw ErroParaFalha();
    let url;
    try {
        url = new URL(texto);
    } catch {
        throw ErroParaFalha();
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw ErroParaFalha();
    return url;
}

// Endereço sem query nem fragmento (links assinados podem trazer tokens): é o que vai para a auditoria.
function urlParaAuditoria(texto) {
    const url = new URL(texto);
    return `${url.origin}${url.pathname}`;
}

// ---------- Conexão ----------

function criarLookup(permitirLoopback) {
    return (hostname, opcoes, callback) => {
        if (typeof opcoes === 'function') {
            callback = opcoes;
            opcoes = {};
        }
        dns.lookup(hostname, { all: true, family: opcoes.family, hints: opcoes.hints }, (erro, enderecos) => {
            if (erro) return callback(erro);
            // Se qualquer endereço do nome for interno, recusa tudo: nada de escolher o "bom" de uma lista mista.
            if (enderecos.length === 0 || enderecos.some((e) => ipBloqueado(e.address, { permitirLoopback }))) {
                return callback(Object.assign(new Error('Endereço não permitido.'), { bloqueado: true }));
            }
            if (opcoes.all) return callback(null, enderecos);
            return callback(null, enderecos[0].address, enderecos[0].family);
        });
    };
}

function requisitar(url, { permitirLoopback, sinal }) {
    return new Promise((resolve, reject) => {
        const modulo = url.protocol === 'https:' ? https : http;
        const requisicao = modulo.request(url, {
            method: 'GET',
            agent: false,
            lookup: criarLookup(permitirLoopback),
            signal: sinal,
            // Sem cookies, sem Authorization: só o necessário.
            headers: { Accept: 'image/jpeg,image/png,image/webp,image/gif', 'User-Agent': 'MantiqueiraAPI/1.0' }
        }, resolve);
        requisicao.on('error', (erro) => {
            if (erro && erro.bloqueado) return reject(erroNaoPermitida());
            return reject(erroInacessivel());
        });
        requisicao.end();
    });
}

const TIPOS_GENERICOS = ['application/octet-stream', 'binary/octet-stream'];

// Content-Type de imagem: o tipo declarado precisa bater com a assinatura. Ausente ou genérico (octet-stream):
// o tipo sai da assinatura do arquivo. Qualquer outro: recusado, sem baixar o corpo.
function interpretarContentType(resposta) {
    const bruto = String(resposta.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (TIPOS_IMAGEM.includes(bruto)) return { declarado: bruto };
    if (bruto === '' || TIPOS_GENERICOS.includes(bruto)) return { declarado: null };
    return null;
}

class LimiteDeTamanho extends Transform {
    constructor(limite) {
        super();
        this.limite = limite;
        this.total = 0;
    }

    _transform(pedaco, codificacao, callback) {
        this.total += pedaco.length;
        if (this.total > this.limite) return callback(erroMuitoGrande());
        return callback(null, pedaco);
    }
}

// Grava a resposta num arquivo temporário (oculto) da pasta de uploads, confere e só então dá o nome final.
async function salvarResposta(resposta, sinal) {
    const contentType = interpretarContentType(resposta);
    if (!contentType) {
        resposta.resume();
        throw erroImagemInvalida();
    }
    const declarado = Number(resposta.headers['content-length']);
    if (Number.isFinite(declarado) && declarado > LIMITE_IMAGEM_BYTES) {
        resposta.resume();
        throw erroMuitoGrande();
    }
    await garantirPasta();
    const temporario = path.join(PASTA_UPLOADS, `.baixando-${randomUUID()}`);
    try {
        await pipeline(resposta, new LimiteDeTamanho(LIMITE_IMAGEM_BYTES), fs.createWriteStream(temporario, { flags: 'wx' }), { signal: sinal });
        const info = await fsp.stat(temporario);
        const cabecalho = await lerCabecalho(temporario);
        const tipo = contentType.declarado || detectarTipoImagem(cabecalho);
        if (info.size === 0 || !tipo || !assinaturaConfere(tipo, cabecalho)) throw erroImagemInvalida();
        const nomeArquivo = novoNomeDeUpload(tipo);
        await fsp.rename(temporario, caminhoDoUpload(nomeArquivo));
        return { nomeArquivo, tipo, tamanho: info.size, extensao: EXTENSAO_POR_TIPO[tipo] };
    } catch (erro) {
        await fsp.rm(temporario, { force: true });
        throw erro instanceof ErroApi ? erro : erroInacessivel();
    }
}

/**
 * Baixa a imagem do endereço e a grava em UPLOADS_DIR com nome UUID.
 * Devolve { nomeArquivo, tipo, tamanho }; lança ErroApi 422 (URL_INVALIDA, URL_NAO_PERMITIDA, IMAGEM_INVALIDA,
 * IMAGEM_MUITO_GRANDE ou IMAGEM_INACESSIVEL) com mensagens que não revelam nada da rede.
 */
async function baixarImagem(urlTexto, { tempoMs = TEMPO_TOTAL_MS, permitirLoopback = estadoTeste.permitirLoopback } = {}) {
    let atual = interpretarUrl(urlTexto, erroUrlInvalida);
    const controle = new AbortController();
    const temporizador = setTimeout(() => controle.abort(), tempoMs);
    try {
        for (let redirecionamentos = 0; ; redirecionamentos += 1) {
            // IP literal na URL: o Node não passa pelo lookup, então confere aqui.
            const host = atual.hostname.replace(/^\[|\]$/g, '');
            if (net.isIP(host) && ipBloqueado(host, { permitirLoopback })) throw erroNaoPermitida();

            const resposta = await requisitar(atual, { permitirLoopback, sinal: controle.signal });
            if (STATUS_REDIRECIONAMENTO.has(resposta.statusCode)) {
                resposta.resume();
                if (redirecionamentos >= MAXIMO_REDIRECIONAMENTOS || !resposta.headers.location) throw erroInacessivel();
                let destino;
                try {
                    destino = new URL(resposta.headers.location, atual).href;
                } catch {
                    throw erroInacessivel();
                }
                atual = interpretarUrl(destino, erroNaoPermitida);
                continue;
            }
            if (resposta.statusCode !== 200) {
                resposta.resume();
                throw erroInacessivel();
            }
            return await salvarResposta(resposta, controle.signal);
        }
    } catch (erro) {
        throw erro instanceof ErroApi ? erro : erroInacessivel();
    } finally {
        clearTimeout(temporizador);
        controle.abort();
    }
}

module.exports = { baixarImagem, ipBloqueado, urlParaAuditoria, permitirLoopbackNosTestes, MAXIMO_URL };
