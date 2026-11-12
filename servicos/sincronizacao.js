const fs = require('node:fs/promises');
const path = require('node:path');
const { Op } = require('sequelize');
const config = require('../config/ambiente');
const { SincronizacaoLog } = require('../models');
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');
const { executarComTrava } = require('../lib/travaMysql');
const { importarCatalogo } = require('./importadorCatalogo');
const { decodificarArquivo, formatoDoNome, FORMATOS_ANTIGOS, LIMITE_BYTES, MENSAGEM_ANTIGO } = require('../lib/planilha');

// Importações (upload ou job) nunca rodam ao mesmo tempo, nem em instâncias diferentes da API.
const TRAVA_IMPORTACAO = 'mantiqueira:importacao';

// Arquivos lidos pelos jobs em importacao/entrada/, pelo prefixo do nome: catalogo*.csv (incremental, de hora em hora),
// carga_completa*.csv (meia-noite, desativa os ausentes) e estoque*.csv.
const PREFIXOS = { catalogo: 'catalogo', carga_completa: 'carga_completa', estoque: 'estoque' };
// Arquivo modificado há menos tempo que isso pode ainda estar sendo copiado: fica para a próxima execução.
const IDADE_MINIMA_MS = 60 * 1000;

function statusDoRelatorio(relatorio) {
    if (relatorio.linhas > 0 && relatorio.com_erro === relatorio.linhas) return 'falha';
    return relatorio.com_erro > 0 ? 'parcial' : 'sucesso';
}

/**
 * Roda o importador registrando início, resultado e erros em sincronizacoes_log.
 * tipo: importacao_manual | catalogo | carga_completa | estoque. Devolve { log, relatorio }.
 * Erros do arquivo (CSV ilegível, sem coluna sku) ficam registrados como "falha" e são relançados.
 */
async function executarImportacao({ conteudo, formato, tipo, origem, simular = false, idUsuario = null }) {
    const inicio = Date.now();
    const log = await SincronizacaoLog.create({ tipo, origem: origem.slice(0, 255), simulado: simular, id_usuario: idUsuario });
    try {
        const relatorio = await importarCatalogo(conteudo, {
            formato,
            simular,
            desativarAusentes: tipo === 'carga_completa',
            somenteEstoque: tipo === 'estoque',
            idUsuario,
            origem
        });
        await log.update({
            status: statusDoRelatorio(relatorio),
            linhas: relatorio.linhas,
            criados: relatorio.criados,
            atualizados: relatorio.atualizados,
            inalterados: relatorio.inalterados,
            desativados: relatorio.desativados,
            com_erro: relatorio.com_erro,
            movimentacoes_estoque: relatorio.movimentacoes_estoque,
            relatorio: { erros: relatorio.erros, avisos: relatorio.avisos },
            finalizado_em: new Date(),
            duracao_ms: Date.now() - inicio
        });
        return { log, relatorio };
    } catch (erro) {
        await log.update({
            status: 'falha',
            mensagem: (erro instanceof ErroApi ? erro.message : 'Erro interno na importação.').slice(0, 500),
            finalizado_em: new Date(),
            duracao_ms: Date.now() - inicio
        });
        throw erro;
    }
}

// Upload pela API (.csv ou .xlsx): espera até 15 s se outra importação estiver rodando.
// O arquivo ilegível vira 422 já com a falha registrada em sincronizacoes_log.
async function importarUpload({ buffer, nomeArquivo, simular, cargaCompleta, idUsuario }) {
    const formato = formatoDoNome(nomeArquivo);
    const { executado, resultado } = await executarComTrava(TRAVA_IMPORTACAO, () => executarImportacao({
        conteudo: buffer,
        formato,
        tipo: cargaCompleta ? 'carga_completa' : 'importacao_manual',
        origem: `upload: ${nomeArquivo}`,
        simular,
        idUsuario
    }), { esperaSegundos: 15 });
    if (!executado) {
        throw new ErroApi(409, 'IMPORTACAO_EM_ANDAMENTO', 'Outra importação está em andamento. Tente novamente em instantes.');
    }
    return resultado;
}

function carimbo() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

async function mover(origem, pastaDestino, relatorio) {
    await fs.mkdir(pastaDestino, { recursive: true });
    const destino = path.join(pastaDestino, `${carimbo()}_${path.basename(origem)}`);
    await fs.rename(origem, destino);
    await fs.writeFile(`${destino}.relatorio.json`, JSON.stringify(relatorio, null, 2));
    return destino;
}

/**
 * Processa os arquivos de importacao/entrada/ do tipo informado (catalogo*.csv na carga incremental,
 * carga_completa*.csv na carga completa, estoque*.csv no estoque), em ordem alfabética. Cada arquivo vai para processados/ (com ou sem
 * linhas rejeitadas) ou rejeitados/ (arquivo ilegível ou todas as linhas com erro), junto com o relatório.
 * Arquivos modificados nos últimos 60 segundos ficam na entrada e voltam a ser vistos na próxima execução.
 */
async function processarPasta(tipo, pastaBase = config.importacao.pasta) {
    const entrada = path.join(pastaBase, 'entrada');
    await fs.mkdir(entrada, { recursive: true });
    const prefixo = PREFIXOS[tipo];
    const extensoesLidas = ['.csv', '.xlsx', ...FORMATOS_ANTIGOS];
    const arquivos = (await fs.readdir(entrada))
        .filter((nome) => nome.toLowerCase().startsWith(prefixo) && extensoesLidas.includes(path.extname(nome).toLowerCase()))
        .sort();

    const resultados = [];
    for (const nome of arquivos) {
        const caminho = path.join(entrada, nome);
        const { mtimeMs } = await fs.stat(caminho);
        if (Date.now() - mtimeMs < IDADE_MINIMA_MS) {
            const resumo = { arquivo: nome, status: 'ignorado', motivo: 'modificado há menos de 60 segundos' };
            logger.info('Arquivo de importação ignorado por enquanto.', { tipo, ...resumo });
            resultados.push(resumo);
            continue;
        }
        let resumo;
        // .xls, .xlsm e .xlsb não são lidos: o arquivo vai para rejeitados com o aviso para salvar como .xlsx ou CSV.
        if (FORMATOS_ANTIGOS.includes(path.extname(nome).toLowerCase()) || (await fs.stat(caminho)).size > LIMITE_BYTES) {
            const motivo = FORMATOS_ANTIGOS.includes(path.extname(nome).toLowerCase()) ? MENSAGEM_ANTIGO : 'O arquivo deve ter no máximo 5 MB.';
            await mover(caminho, path.join(pastaBase, 'rejeitados'), { erro: motivo });
            resumo = { arquivo: nome, status: 'falha', destino: 'rejeitados', erro: motivo };
            logger.warn('Arquivo de importação rejeitado.', { tipo, ...resumo });
            resultados.push(resumo);
            continue;
        }
        try {
            const { log, relatorio } = await executarImportacao({
                conteudo: await fs.readFile(caminho),
                formato: formatoDoNome(nome),
                tipo,
                origem: `arquivo: ${nome}`
            });
            const pasta = log.status === 'falha' ? 'rejeitados' : 'processados';
            await mover(caminho, path.join(pastaBase, pasta), { id_sincronizacao: log.id_sincronizacao, ...relatorio });
            resumo = { arquivo: nome, status: log.status, destino: pasta, id_sincronizacao: log.id_sincronizacao };
        } catch (erro) {
            logger.error('Falha ao importar arquivo.', { arquivo: nome, erro });
            await mover(caminho, path.join(pastaBase, 'rejeitados'), { erro: erro.message });
            resumo = { arquivo: nome, status: 'falha', destino: 'rejeitados', erro: erro.message };
        }
        logger.info('Arquivo de importação processado.', { tipo, ...resumo });
        resultados.push(resumo);
    }
    return resultados;
}

// Usado pelos jobs: se outra importação estiver rodando, pula esta execução.
async function processarPastaComTrava(tipo, pastaBase) {
    const { executado, resultado } = await executarComTrava(TRAVA_IMPORTACAO, () => processarPasta(tipo, pastaBase));
    return executado ? resultado : { ignorado: 'outra importação em andamento' };
}

// Última importação real (não simulada) que gravou dados.
async function ultimaSincronizacao(tipo = null) {
    const ultima = await SincronizacaoLog.findOne({
        where: {
            simulado: false,
            status: { [Op.in]: ['sucesso', 'parcial'] },
            ...(tipo && { tipo })
        },
        order: [['finalizado_em', 'DESC'], ['id_sincronizacao', 'DESC']],
        attributes: ['id_sincronizacao', 'tipo', 'origem', 'status', 'finalizado_em']
    });
    return ultima;
}

module.exports = {
    importarUpload,
    executarImportacao,
    processarPasta,
    processarPastaComTrava,
    ultimaSincronizacao,
    decodificarArquivo,
    TRAVA_IMPORTACAO
};
