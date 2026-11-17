// Leitura de ZIP em disco, uma entrada por vez, sem carregar o arquivo inteiro na memória.
// Lê o diretório central (nomes e tamanhos declarados) e só descompacta a entrada pedida, com limite de saída
// (proteção contra ZIP bomba: a entrada nunca passa do tamanho declarado, que o chamador já limitou).
// Não suporta ZIP64, senha ou métodos diferentes de "armazenado" e "deflate".
const fs = require('node:fs/promises');
const zlib = require('node:zlib');

const MAXIMO_ENTRADAS_BRUTAS = 2000;
const MAXIMO_DIRETORIO_CENTRAL = 4 * 1024 * 1024;

class ErroZip extends Error {
    constructor(mensagem, tipo = 'invalido') {
        super(mensagem);
        this.name = 'ErroZip';
        this.tipo = tipo; // 'invalido' (corrompido) ou 'limite' (entradas demais)
    }
}

async function lerTrecho(arquivo, posicao, tamanho) {
    const buffer = Buffer.alloc(tamanho);
    const { bytesRead } = await arquivo.read(buffer, 0, tamanho, posicao);
    if (bytesRead !== tamanho) throw new ErroZip('ZIP truncado.');
    return buffer;
}

// Abre o ZIP e devolve { entradas, ler(entrada), fechar() }. Lança ErroZip se estiver corrompido.
async function abrirZip(caminho) {
    const arquivo = await fs.open(caminho, 'r');
    try {
        const { size } = await arquivo.stat();
        if (size < 22) throw new ErroZip('Arquivo pequeno demais para ser um ZIP.');

        const tamanhoCauda = Math.min(size, 22 + 65535);
        const cauda = await lerTrecho(arquivo, size - tamanhoCauda, tamanhoCauda);
        let eocd = -1;
        for (let i = cauda.length - 22; i >= 0; i -= 1) {
            if (cauda.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new ErroZip('Fim do ZIP não encontrado.');
        const total = cauda.readUInt16LE(eocd + 10);
        const tamanhoDiretorio = cauda.readUInt32LE(eocd + 12);
        const inicioDiretorio = cauda.readUInt32LE(eocd + 16);
        if (total === 0xffff || tamanhoDiretorio === 0xffffffff || inicioDiretorio === 0xffffffff) {
            throw new ErroZip('ZIP64 não suportado.');
        }
        if (total > MAXIMO_ENTRADAS_BRUTAS) throw new ErroZip('Entradas demais.', 'limite');
        if (tamanhoDiretorio > MAXIMO_DIRETORIO_CENTRAL || inicioDiretorio + tamanhoDiretorio > size) {
            throw new ErroZip('Diretório central inválido.');
        }

        const diretorio = await lerTrecho(arquivo, inicioDiretorio, tamanhoDiretorio);
        const entradas = [];
        let posicao = 0;
        for (let i = 0; i < total; i += 1) {
            if (posicao + 46 > diretorio.length || diretorio.readUInt32LE(posicao) !== 0x02014b50) {
                throw new ErroZip('Diretório central corrompido.');
            }
            const flags = diretorio.readUInt16LE(posicao + 8);
            const tamanhoNome = diretorio.readUInt16LE(posicao + 28);
            const tamanhoExtra = diretorio.readUInt16LE(posicao + 30);
            const tamanhoComentario = diretorio.readUInt16LE(posicao + 32);
            if (posicao + 46 + tamanhoNome > diretorio.length) throw new ErroZip('Diretório central corrompido.');
            const nome = diretorio.toString(flags & 0x800 ? 'utf8' : 'latin1', posicao + 46, posicao + 46 + tamanhoNome);
            entradas.push({
                nome,
                criptografada: Boolean(flags & 1),
                metodo: diretorio.readUInt16LE(posicao + 10),
                tamanhoComprimido: diretorio.readUInt32LE(posicao + 20),
                tamanhoOriginal: diretorio.readUInt32LE(posicao + 24),
                deslocamento: diretorio.readUInt32LE(posicao + 42),
                diretorio: nome.endsWith('/') || nome.endsWith('\\')
            });
            posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
        }

        // Descompacta uma única entrada, no máximo até o tamanho declarado.
        async function ler(entrada) {
            if (entrada.criptografada || ![0, 8].includes(entrada.metodo)) throw new ErroZip('Entrada não suportada.', 'entrada');
            if (entrada.tamanhoOriginal === 0) return Buffer.alloc(0);
            const cabecalho = await lerTrecho(arquivo, entrada.deslocamento, 30);
            if (cabecalho.readUInt32LE(0) !== 0x04034b50) throw new ErroZip('Entrada corrompida.', 'entrada');
            const inicio = entrada.deslocamento + 30 + cabecalho.readUInt16LE(26) + cabecalho.readUInt16LE(28);
            if (inicio + entrada.tamanhoComprimido > size) throw new ErroZip('Entrada corrompida.', 'entrada');
            const comprimido = await lerTrecho(arquivo, inicio, entrada.tamanhoComprimido);
            let conteudo;
            try {
                conteudo = entrada.metodo === 0
                    ? comprimido
                    : zlib.inflateRawSync(comprimido, { maxOutputLength: entrada.tamanhoOriginal });
            } catch {
                throw new ErroZip('Entrada corrompida.', 'entrada');
            }
            if (conteudo.length !== entrada.tamanhoOriginal) throw new ErroZip('Entrada corrompida.', 'entrada');
            return conteudo;
        }

        return { entradas, ler, fechar: () => arquivo.close() };
    } catch (erro) {
        await arquivo.close();
        throw erro instanceof ErroZip ? erro : new ErroZip('ZIP ilegível.');
    }
}

module.exports = { abrirZip, ErroZip };
