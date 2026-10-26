const { randomUUID } = require('node:crypto');
const logger = require('../lib/logger');
const { corpoErro } = require('../lib/erros');

const ID_VALIDO = /^[\w-]{8,64}$/;

// Gera (ou reaproveita, se vier do Nginx/front) um id por requisição e registra o resultado ao final.
function identificarRequisicao(req, res, next) {
    const recebido = req.get('X-Request-Id');
    req.id = recebido && ID_VALIDO.test(recebido) ? recebido : randomUUID();
    res.set('X-Request-Id', req.id);

    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
        const campos = {
            metodo: req.method,
            // Somente o caminho: a query string pode carregar dados que não devem ir para o log.
            rota: req.originalUrl.split('?')[0],
            status: res.statusCode,
            duracao_ms: Number((process.hrtime.bigint() - inicio) / 1000000n),
            ...(req.usuario && { usuario_id: req.usuario.id })
        };
        if (campos.rota === '/saude') {
            logger.debug('requisição', campos);
        } else if (res.statusCode >= 500) {
            logger.error('requisição', campos);
        } else {
            logger.info('requisição', campos);
        }
    });

    logger.contexto.run({ request_id: req.id }, next);
}

// Garante o formato { sucesso:false, mensagem, codigo, detalhes? } em qualquer resposta de erro,
// inclusive nas que os controladores ainda devolvem como { mensagem }.
function padronizarErros(req, res, next) {
    const json = res.json.bind(res);
    res.json = (corpo) => {
        if (res.statusCode >= 400 && corpo && typeof corpo === 'object' && !Array.isArray(corpo)) {
            return json(corpoErro(res.statusCode, corpo));
        }
        return json(corpo);
    };
    next();
}

module.exports = { identificarRequisicao, padronizarErros };
