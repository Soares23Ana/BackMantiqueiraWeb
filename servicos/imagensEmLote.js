const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { fn, col, where } = require('sequelize');
const { Produto } = require('../models');
const { ErroApi } = require('../lib/erros');
const logger = require('../lib/logger');
const { abrirZip, ErroZip } = require('../lib/zip');
const { lerCsv } = require('../lib/csv');
const { decodificarArquivo } = require('../lib/planilha');
const { assinaturaConfere, TIPO_POR_EXTENSAO, LIMITE_IMAGEM_BYTES } = require('../lib/imagem');
const { caminhoDoUpload, novoNomeDeUpload, removerArquivo } = require('../lib/uploads');
const { aplicarImagemProduto } = require('./imagemProduto');

// O sku_antigo não é uma coluna do banco: só existe no catálogo inicial (a importação troca o SKU do produto existente).
const ARQUIVO_CATALOGO = path.join(__dirname, '..', 'seeds', 'catalogo_inicial.csv');
const MAXIMO_ARQUIVOS = 200;
const MAXIMO_DESCOMPACTADO = 100 * 1024 * 1024;
const MAXIMO_ITENS_LISTA = 200;
const MAXIMO_NOME = 120;

const erroDividir = (detalhe) => new ErroApi(422, 'ZIP_MUITO_GRANDE',
    `${detalhe} Divida as fotos em mais de um ZIP e envie um de cada vez.`);

// Arquivos do sistema que vêm em ZIPs de Mac e Windows: __MACOSX/, .DS_Store e qualquer arquivo ou pasta oculta.
function ehDoSistema(segmentos) {
    // "." e ".." são só caminhos relativos (o nome interno nunca é usado para gravar); o que conta é o resto.
    return segmentos.some((segmento) => segmento === '__MACOSX' || (segmento.startsWith('.') && segmento !== '.' && segmento !== '..'));
}

// Casa o nome do arquivo (sem pasta e sem extensão, sem espaços nas pontas, sem diferenciar maiúsculas) com o SKU
// do produto; se não achar, com o sku_antigo. O nome interno do ZIP nunca é usado para gravar nada.
async function produtoPorSku(chave) {
    const candidatos = await Produto.findAll({ where: where(fn('LOWER', col('sku')), chave), limit: 5 });
    return candidatos.find((produto) => String(produto.sku).trim().toLowerCase() === chave) || null;
}

// Mapa sku_antigo (minúsculas) -> sku atual, lido do catálogo inicial. Sem o arquivo, o mapa fica vazio.
function carregarMapaSkuAntigo(arquivo) {
    const mapa = new Map();
    try {
        const { registros } = lerCsv(decodificarArquivo(fsSync.readFileSync(arquivo)));
        for (const { valores } of registros) {
            if (valores.sku && valores.sku_antigo) mapa.set(valores.sku_antigo.trim().toLowerCase(), valores.sku.trim().toLowerCase());
        }
    } catch (erro) {
        if (erro.code !== 'ENOENT') logger.warn('Não foi possível ler o catálogo para o sku_antigo.', { erro: erro.message });
    }
    return mapa;
}

async function acharProduto(chave, mapaSkuAntigo) {
    const direto = await produtoPorSku(chave);
    if (direto) return direto;
    const atual = mapaSkuAntigo.get(chave);
    return atual ? produtoPorSku(atual) : null;
}

function relatorioVazio() {
    return {
        total_arquivos: 0,
        aplicadas: 0,
        ignoradas_ja_tem_imagem: 0,
        sem_produto: [],
        formato_invalido: [],
        grande_demais: [],
        duplicadas: [],
        falhas: [],
        arquivos_ignorados_do_sistema: 0,
        listas_cortadas: []
    };
}

/**
 * Aplica as fotos de um ZIP (em disco) aos produtos. Uma imagem por vez: só a entrada em tratamento é
 * descompactada. Uma imagem com problema nunca derruba as outras.
 * Lança ErroApi 422 (ZIP_INVALIDO, ZIP_MUITO_GRANDE) para problemas do ZIP como um todo.
 */
async function aplicarImagensEmLote({ caminhoZip, substituir = false, usuario, arquivoCatalogo = ARQUIVO_CATALOGO }) {
    const relatorio = relatorioVazio();

    let zip;
    try {
        const cabecalho = Buffer.alloc(4);
        const arquivo = await fs.open(caminhoZip, 'r');
        try { await arquivo.read(cabecalho, 0, 4, 0); } finally { await arquivo.close(); }
        if (cabecalho.readUInt32LE(0) !== 0x04034b50 && cabecalho.readUInt32LE(0) !== 0x06054b50) throw new ErroZip('Não é um ZIP.');
        zip = await abrirZip(caminhoZip);
    } catch (erro) {
        if (erro instanceof ErroZip && erro.tipo === 'limite') throw erroDividir('O ZIP tem entradas demais.');
        throw new ErroApi(422, 'ZIP_INVALIDO', 'O arquivo enviado não é um ZIP válido ou está corrompido.');
    }

    try {
        // Separa o que é foto candidata do que é pasta ou arquivo do sistema, e confere os limites antes de gravar qualquer coisa.
        const candidatas = [];
        for (const entrada of zip.entradas) {
            if (entrada.diretorio) continue;
            const segmentos = entrada.nome.replace(/\\/g, '/').split('/').filter(Boolean);
            if (segmentos.length === 0) continue;
            if (ehDoSistema(segmentos)) {
                relatorio.arquivos_ignorados_do_sistema += 1;
                continue;
            }
            candidatas.push({ entrada, nome: segmentos[segmentos.length - 1] });
        }
        if (candidatas.length > MAXIMO_ARQUIVOS) {
            throw erroDividir(`O ZIP tem ${candidatas.length} arquivos; o limite é ${MAXIMO_ARQUIVOS}.`);
        }
        const totalDescompactado = candidatas.reduce((soma, { entrada }) => soma + entrada.tamanhoOriginal, 0);
        if (totalDescompactado > MAXIMO_DESCOMPACTADO) {
            throw erroDividir('O conteúdo do ZIP descompactado passa de 100 MB.');
        }
        relatorio.total_arquivos = candidatas.length;

        const produtosTratados = new Set();
        const mapaSkuAntigo = carregarMapaSkuAntigo(arquivoCatalogo);
        const registrar = (lista, nome) => {
            if (relatorio[lista].length < MAXIMO_ITENS_LISTA) relatorio[lista].push(nome.slice(0, MAXIMO_NOME));
            else if (!relatorio.listas_cortadas.includes(lista)) relatorio.listas_cortadas.push(lista);
        };

        for (const { entrada, nome } of candidatas) {
            try {
                const ponto = nome.lastIndexOf('.');
                const extensao = ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : '';
                const tipo = TIPO_POR_EXTENSAO[extensao];
                const chave = (ponto > 0 ? nome.slice(0, ponto) : nome).trim().toLowerCase();
                if (!tipo || !chave) {
                    registrar('formato_invalido', nome);
                    continue;
                }

                const produto = await acharProduto(chave, mapaSkuAntigo);
                if (!produto) {
                    registrar('sem_produto', nome);
                    continue;
                }
                // Uma foto por produto: vale a primeira que casou (mesmo SKU em extensões diferentes, ou SKU e sku_antigo).
                if (produtosTratados.has(produto.id_produto)) {
                    registrar('duplicadas', nome);
                    continue;
                }
                produtosTratados.add(produto.id_produto);

                if (!substituir && produto.imagem_url) {
                    relatorio.ignoradas_ja_tem_imagem += 1;
                    continue;
                }
                if (entrada.tamanhoOriginal > LIMITE_IMAGEM_BYTES) {
                    registrar('grande_demais', nome);
                    continue;
                }

                let conteudo;
                try {
                    conteudo = await zip.ler(entrada);
                } catch (erro) {
                    if (!(erro instanceof ErroZip)) throw erro;
                    registrar('formato_invalido', nome);
                    continue;
                }
                if (!assinaturaConfere(tipo, conteudo.subarray(0, 12))) {
                    registrar('formato_invalido', nome);
                    continue;
                }

                // O arquivo é gravado com nome UUID; o nome interno do ZIP só serviu para casar o produto.
                const nomeArquivo = novoNomeDeUpload(tipo);
                try {
                    await fs.writeFile(caminhoDoUpload(nomeArquivo), conteudo, { flag: 'wx' });
                } catch (erro) {
                    await removerArquivo(caminhoDoUpload(nomeArquivo));
                    throw erro;
                }
                try {
                    await aplicarImagemProduto({ produto, nomeArquivo, usuario });
                } catch (erro) {
                    // aplicarImagemProduto já apagou o arquivo gravado.
                    logger.error('Falha ao aplicar imagem do lote.', { erro, produto: produto.id_produto });
                    registrar('falhas', nome);
                    continue;
                }
                relatorio.aplicadas += 1;
            } catch (erro) {
                logger.error('Falha ao tratar imagem do lote.', { erro });
                registrar('falhas', nome);
            }
        }
        return relatorio;
    } finally {
        await zip.fechar();
    }
}

module.exports = { aplicarImagensEmLote };
