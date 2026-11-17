// Único lugar que conhece a pasta das fotos enviadas (UPLOADS_DIR). Nenhum outro arquivo monta esse caminho.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const config = require('../config/ambiente');
const logger = require('./logger');

const PASTA_UPLOADS = config.uploads.dir;
const PREFIXO_URL = '/arquivos/uploads/';
// Padrão estrito: só nomes gerados pelo upload (UUID + extensão). Impede que um valor com ".." apague arquivos de fora.
const PADRAO_URL = /^\/arquivos\/uploads\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/;

const EXTENSAO_POR_TIPO = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif'
};

const caminhoDoUpload = (nome) => path.join(PASTA_UPLOADS, nome);
const urlDoUpload = (nome) => `${PREFIXO_URL}${nome}`;
const nomeDeUpload = (url) => {
    const achado = typeof url === 'string' ? url.match(PADRAO_URL) : null;
    return achado ? achado[1] : null;
};
const novoNomeDeUpload = (tipo) => `${randomUUID()}${EXTENSAO_POR_TIPO[tipo]}`;

async function garantirPasta() {
    await fsp.mkdir(PASTA_UPLOADS, { recursive: true });
}

async function removerArquivo(caminho) {
    if (!caminho) return;
    try {
        await fsp.unlink(caminho);
    } catch (erro) {
        if (erro.code !== 'ENOENT') logger.error('Erro ao remover arquivo de upload.', { erro });
    }
}

// Apaga o arquivo de um imagem_url gerado pelo upload; URLs externas ou caminhos locais (/img/...) são ignorados.
async function removerUploadPorUrl(url) {
    const nome = nomeDeUpload(url);
    if (nome) await removerArquivo(caminhoDoUpload(nome));
}

// Confere se dá para gravar na pasta (cria e apaga um arquivo de prova).
async function pastaGravavel() {
    const prova = path.join(PASTA_UPLOADS, `.gravacao-${process.pid}-${randomUUID()}`);
    try {
        await fsp.writeFile(prova, 'ok');
        await fsp.unlink(prova);
        return true;
    } catch {
        return false;
    }
}

async function contarArquivos() {
    try {
        const itens = await fsp.readdir(PASTA_UPLOADS, { withFileTypes: true });
        return itens.filter((item) => item.isFile() && !item.name.startsWith('.')).length;
    } catch {
        return 0;
    }
}

// Na subida da API: cria a pasta, confirma que dá para gravar e avisa de situações que denunciam risco de perda.
async function prepararPastaUploads() {
    const existia = fs.existsSync(PASTA_UPLOADS);
    await garantirPasta();
    const gravavel = await pastaGravavel();
    const arquivos = await contarArquivos();
    if (!gravavel) {
        logger.error('A pasta de uploads não aceita gravação: o envio de imagens vai falhar.', { arquivos });
    }
    if (config.producao && !config.uploads.definido) {
        logger.warn('UPLOADS_DIR não definido em produção: as fotos ficam dentro do projeto e podem sumir numa nova publicação.');
    }
    if (!existia) {
        logger.warn('A pasta de uploads acabou de ser criada e está vazia. Se já havia fotos, o disco ou o caminho mudou.');
    }
    return { criada: !existia, gravavel, arquivos };
}

// Estado para o /saude/detalhado, sem expor o caminho do servidor.
async function estadoPastaUploads() {
    return { gravavel: await pastaGravavel(), arquivos: await contarArquivos() };
}

module.exports = {
    PASTA_UPLOADS,
    PREFIXO_URL,
    EXTENSAO_POR_TIPO,
    caminhoDoUpload,
    urlDoUpload,
    nomeDeUpload,
    novoNomeDeUpload,
    garantirPasta,
    removerArquivo,
    removerUploadPorUrl,
    prepararPastaUploads,
    estadoPastaUploads
};
