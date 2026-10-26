const { SincronizacaoLog, Usuario } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { importarUpload } = require('../servicos/sincronizacao');

const TIPOS = ['importacao_manual', 'carga_completa', 'estoque'];

function lerBooleano(valor, campo) {
    if (valor === undefined || valor === '') return false;
    if (valor === 'true' || valor === true) return true;
    if (valor === 'false' || valor === false) return false;
    throw new ErroApi(422, 'VALIDACAO', `${campo} deve ser true ou false.`);
}

/**
 * POST /produtos/importar (multipart, campo "arquivo"). Mesmo formato do seeds/catalogo_inicial.csv.
 * simular=true mostra o resultado sem gravar; carga_completa=true também desativa produtos ausentes.
 */
async function importar(req, res) {
    if (!req.file) {
        throw new ErroApi(422, 'VALIDACAO', 'Envie o arquivo CSV no campo "arquivo".');
    }
    const opcoes = { ...req.query, ...req.body };
    const { log, relatorio } = await importarUpload({
        buffer: req.file.buffer,
        nomeArquivo: req.file.originalname,
        simular: lerBooleano(opcoes.simular, 'simular'),
        cargaCompleta: lerBooleano(opcoes.carga_completa, 'carga_completa'),
        idUsuario: req.usuario.id
    });
    return res.status(200).json({
        mensagem: relatorio.simulado ? 'Simulação concluída. Nada foi gravado.' : 'Importação concluída.',
        id_sincronizacao: log.id_sincronizacao,
        status: log.status,
        relatorio
    });
}

// GET /produtos/importacoes?tipo=&pagina=: histórico de importações (upload e jobs).
async function listar(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 20, limiteMaximo: 100 });
    const where = {};
    if (req.query.tipo) {
        if (!TIPOS.includes(req.query.tipo)) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', `tipo deve ser: ${TIPOS.join(', ')}.`);
        }
        where.tipo = req.query.tipo;
    }
    const { rows, count } = await SincronizacaoLog.findAndCountAll({
        where,
        attributes: { exclude: ['relatorio'] },
        include: [{ model: Usuario, as: 'usuario', attributes: ['id_usuario', 'nome'] }],
        order: [['iniciado_em', 'DESC'], ['id_sincronizacao', 'DESC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    return res.status(200).json({ importacoes: rows, paginacao: montarPaginacao(count, paginacao) });
}

// GET /produtos/importacoes/:id: uma importação com o relatório de erros linha a linha.
async function obter(req, res) {
    const log = await SincronizacaoLog.findByPk(Number(req.params.id) || 0, {
        include: [{ model: Usuario, as: 'usuario', attributes: ['id_usuario', 'nome'] }]
    });
    if (!log) {
        throw new ErroApi(404, 'NAO_ENCONTRADO', 'Importação não encontrada.');
    }
    return res.status(200).json({ importacao: log });
}

module.exports = { importar, listar, obter };
