// Conferência da assinatura (primeiros bytes) de imagens JPEG, PNG, WEBP e GIF. SVG não é aceito.
const fs = require('node:fs/promises');

const TAMANHO_CABECALHO = 12;
const LIMITE_IMAGEM_BYTES = 5 * 1024 * 1024;
const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const TIPO_POR_EXTENSAO = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Confere se o conteúdo (pelo menos os 12 primeiros bytes) tem a assinatura do tipo informado.
function assinaturaConfere(tipo, cabecalho) {
    if (!Buffer.isBuffer(cabecalho) || cabecalho.length < TAMANHO_CABECALHO) return false;
    switch (tipo) {
        case 'image/jpeg':
            return cabecalho[0] === 0xff && cabecalho[1] === 0xd8 && cabecalho[2] === 0xff;
        case 'image/png':
            return cabecalho.subarray(0, 8).equals(ASSINATURA_PNG);
        case 'image/gif':
            return ['GIF87a', 'GIF89a'].includes(cabecalho.toString('ascii', 0, 6));
        case 'image/webp':
            return cabecalho.toString('ascii', 0, 4) === 'RIFF' && cabecalho.toString('ascii', 8, 12) === 'WEBP';
        default:
            return false;
    }
}

// Descobre o tipo pela assinatura; null se não for uma das quatro imagens aceitas.
function detectarTipoImagem(cabecalho) {
    return TIPOS_IMAGEM.find((tipo) => assinaturaConfere(tipo, cabecalho)) || null;
}

// Lê só os primeiros bytes de um arquivo (nunca o arquivo inteiro).
async function lerCabecalho(caminho) {
    const arquivo = await fs.open(caminho, 'r');
    try {
        const cabecalho = Buffer.alloc(TAMANHO_CABECALHO);
        const { bytesRead } = await arquivo.read(cabecalho, 0, TAMANHO_CABECALHO, 0);
        return cabecalho.subarray(0, bytesRead);
    } finally {
        await arquivo.close();
    }
}

module.exports = { assinaturaConfere, detectarTipoImagem, lerCabecalho, LIMITE_IMAGEM_BYTES, TIPOS_IMAGEM, TIPO_POR_EXTENSAO };
