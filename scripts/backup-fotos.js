// Gera fotos-AAAAMMDD-HHMMSS.zip com a pasta de uploads em BACKUP_DIR e mantém só as últimas BACKUP_FOTOS_MANTER cópias.
// O ZIP é gravado em fluxo (arquivo por arquivo, em pedaços), sem montar nada grande na memória.
// Termina com código diferente de zero se falhar.
//
// Uso: npm run backup:fotos
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { Zip, ZipPassThrough } = require('fflate');

const PADRAO_NOME = /^fotos-\d{8}-\d{6}\.zip$/;

function nomeDoBackup(data) {
    const p = (n) => String(n).padStart(2, '0');
    return `fotos-${data.getFullYear()}${p(data.getMonth() + 1)}${p(data.getDate())}-${p(data.getHours())}${p(data.getMinutes())}${p(data.getSeconds())}.zip`;
}

// Fotos já são comprimidas: grava sem recomprimir (ZipPassThrough), o que também poupa CPU na t3.micro.
async function gravarZip(arquivos, saida) {
    const destino = fs.createWriteStream(saida, { flags: 'wx' });
    let falha = null;
    destino.on('error', (erro) => { falha = erro; });
    const zip = new Zip((erro, pedaco) => {
        if (erro) { falha = erro; return; }
        destino.write(pedaco);
    });
    try {
        for (const { nome, caminho, mtime } of arquivos) {
            const entrada = new ZipPassThrough(nome);
            entrada.mtime = mtime;
            zip.add(entrada);
            for await (const pedaco of fs.createReadStream(caminho, { highWaterMark: 256 * 1024 })) {
                entrada.push(pedaco);
                if (falha) throw falha;
                if (destino.writableNeedDrain) await once(destino, 'drain');
            }
            entrada.push(new Uint8Array(0), true);
        }
        zip.end();
        if (falha) throw falha;
        destino.end();
        await once(destino, 'finish');
        if (falha) throw falha;
    } catch (erro) {
        destino.destroy();
        throw erro;
    }
}

async function listarFotos(pasta) {
    const itens = await fsp.readdir(pasta, { withFileTypes: true });
    const arquivos = [];
    for (const item of itens) {
        if (!item.isFile() || item.name.startsWith('.')) continue;
        const caminho = path.join(pasta, item.name);
        const info = await fsp.stat(caminho);
        arquivos.push({ nome: item.name, caminho, mtime: info.mtime, tamanho: info.size });
    }
    return arquivos;
}

async function aplicarRetencao(pasta, manter) {
    const nomes = (await fsp.readdir(pasta)).filter((nome) => PADRAO_NOME.test(nome)).sort();
    const apagar = nomes.slice(0, Math.max(0, nomes.length - manter));
    for (const nome of apagar) await fsp.unlink(path.join(pasta, nome));
    return apagar;
}

async function fazerBackup({ origem, destino, manter, agora = new Date() }) {
    const arquivos = await listarFotos(origem);
    await fsp.mkdir(destino, { recursive: true });
    const nome = nomeDoBackup(agora);
    const final = path.join(destino, nome);
    const parcial = `${final}.parcial`;
    try {
        await gravarZip(arquivos, parcial);
        await fsp.rename(parcial, final);
    } catch (erro) {
        await fsp.rm(parcial, { force: true });
        throw erro;
    }
    const removidos = await aplicarRetencao(destino, manter);
    const tamanho = (await fsp.stat(final)).size;
    return { arquivo: nome, caminho: final, arquivos: arquivos.length, tamanho_bytes: tamanho, removidos };
}

async function principal() {
    const config = require('../config/ambiente');
    const r = await fazerBackup({ origem: config.uploads.dir, destino: config.backupFotos.dir, manter: config.backupFotos.manter });
    console.log(`Backup gerado: ${r.caminho}`);
    console.log(`Arquivos: ${r.arquivos} | Tamanho do ZIP: ${(r.tamanho_bytes / 1024 / 1024).toFixed(2)} MB`);
    if (r.removidos.length > 0) console.log(`Cópias antigas removidas: ${r.removidos.length}`);
}

if (require.main === module) {
    principal().catch((erro) => {
        console.error(`Falha no backup das fotos: ${erro.message}`);
        process.exitCode = 1;
    });
}

module.exports = { fazerBackup, nomeDoBackup, aplicarRetencao };
