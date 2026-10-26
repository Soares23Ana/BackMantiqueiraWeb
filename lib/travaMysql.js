const sequelize = require('../db/conn');

/**
 * Executa "funcao" segurando uma trava nomeada do MySQL (GET_LOCK). Com várias instâncias da API
 * (ou um job e um upload ao mesmo tempo), só uma executa por vez.
 * A trava pertence a uma conexão, então uma conexão do pool fica reservada até o fim.
 * Retorna { executado: false } se a trava não foi obtida dentro de esperaSegundos.
 */
async function executarComTrava(nome, funcao, { esperaSegundos = 0 } = {}) {
    const conexao = await sequelize.connectionManager.getConnection({ type: 'write' });
    try {
        const [[{ obtida }]] = await conexao.promise().query('SELECT GET_LOCK(?, ?) AS obtida', [nome, esperaSegundos]);
        if (obtida !== 1) {
            return { executado: false };
        }
        try {
            return { executado: true, resultado: await funcao() };
        } finally {
            await conexao.promise().query('SELECT RELEASE_LOCK(?)', [nome]);
        }
    } finally {
        sequelize.connectionManager.releaseConnection(conexao);
    }
}

module.exports = { executarComTrava };
