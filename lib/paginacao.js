const { ErroApi } = require('./erros');

function lerPaginacao(query, { limitePadrao = 20, limiteMaximo = 100 } = {}) {
    const pagina = query.pagina === undefined ? 1 : Number(query.pagina);
    const limite = query.limite === undefined ? limitePadrao : Number(query.limite);
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100000 ||
        !Number.isSafeInteger(limite) || limite < 1 || limite > limiteMaximo) {
        throw new ErroApi(400, 'PAGINACAO_INVALIDA',
            `Parâmetros de paginação inválidos (pagina >= 1, limite entre 1 e ${limiteMaximo}).`);
    }
    return { pagina, limite, offset: (pagina - 1) * limite };
}

function montarPaginacao(total, { pagina, limite }) {
    return { total, pagina, limite, total_paginas: Math.ceil(total / limite) };
}

module.exports = { lerPaginacao, montarPaginacao };
