// Copia (não move) as fotos de publico/uploads para a pasta definida em UPLOADS_DIR. Pode rodar várias vezes:
// não sobrescreve arquivo que já existe no destino. As URLs gravadas no banco continuam valendo.
//
// Uso: npm run uploads:mover                → copia
//      npm run uploads:mover -- --simular   → só mostra o que seria copiado
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');

const ORIGEM_PADRAO = path.join(__dirname, '..', 'publico', 'uploads');

async function listarArquivos(pasta) {
    try {
        const itens = await fs.readdir(pasta, { withFileTypes: true });
        return itens.filter((item) => item.isFile() && !item.name.startsWith('.')).map((item) => item.name);
    } catch (erro) {
        if (erro.code === 'ENOENT') return [];
        throw erro;
    }
}

async function moverUploads({ origem = ORIGEM_PADRAO, destino, simular = false } = {}) {
    const relatorio = { copiados: 0, ja_existentes: 0, total: 0, mesma_pasta: false };
    if (path.resolve(origem) === path.resolve(destino)) {
        return { ...relatorio, mesma_pasta: true };
    }
    const nomes = await listarArquivos(origem);
    relatorio.total = nomes.length;
    if (!simular) await fs.mkdir(destino, { recursive: true });
    for (const nome of nomes) {
        const alvo = path.join(destino, nome);
        if (simular) {
            const existe = await fs.access(alvo).then(() => true, () => false);
            relatorio[existe ? 'ja_existentes' : 'copiados'] += 1;
            continue;
        }
        try {
            await fs.copyFile(path.join(origem, nome), alvo, constants.COPYFILE_EXCL);
            relatorio.copiados += 1;
        } catch (erro) {
            if (erro.code !== 'EEXIST') throw erro;
            relatorio.ja_existentes += 1;
        }
    }
    return relatorio;
}

async function principal() {
    const config = require('../config/ambiente');
    const simular = process.argv.includes('--simular');
    console.log(`Origem: ${ORIGEM_PADRAO}`);
    console.log(`Destino (UPLOADS_DIR): ${config.uploads.dir}${simular ? ' (simulação)' : ''}`);
    const relatorio = await moverUploads({ destino: config.uploads.dir, simular });
    if (relatorio.mesma_pasta) {
        console.log('A origem e o destino são a mesma pasta (UPLOADS_DIR não está definido). Nada a copiar.');
        return;
    }
    console.log(`${simular ? 'Seriam copiados' : 'Copiados'}: ${relatorio.copiados}`);
    console.log(`Já existentes no destino: ${relatorio.ja_existentes}`);
    console.log(`Total na origem: ${relatorio.total}`);
}

if (require.main === module) {
    principal().catch((erro) => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}

module.exports = { moverUploads, ORIGEM_PADRAO };
