const { MovimentacaoEstoque } = require('../models');
const { ErroApi } = require('../lib/erros');

/**
 * Altera o estoque de um produto já bloqueado (SELECT ... FOR UPDATE) na transação e registra a movimentação.
 * Nunca deixa o estoque negativo. Retorna a movimentação criada, ou null se o valor não mudou.
 */
async function alterarEstoque(produto, novoEstoque, { tipo, observacao = null, idUsuario = null, idPedido = null, transacao }) {
    if (!transacao) {
        throw new Error('alterarEstoque exige uma transação.');
    }
    if (!Number.isSafeInteger(novoEstoque) || novoEstoque < 0) {
        throw new ErroApi(409, 'ESTOQUE_INSUFICIENTE', `O estoque de ${produto.nome} não pode ficar negativo.`, {
            id_produto: produto.id_produto,
            estoque_atual: produto.quantidade_estoque
        });
    }
    const anterior = produto.quantidade_estoque;
    if (anterior === novoEstoque) {
        return null;
    }
    await produto.update({ quantidade_estoque: novoEstoque }, { transaction: transacao });
    return MovimentacaoEstoque.create({
        id_produto: produto.id_produto,
        tipo,
        quantidade: novoEstoque - anterior,
        estoque_anterior: anterior,
        estoque_novo: novoEstoque,
        observacao,
        id_usuario: idUsuario,
        id_pedido: idPedido
    }, { transaction: transacao });
}

// "disponivel" | "ultimas_unidades" | "indisponivel", sem revelar a quantidade exata.
function disponibilidade({ quantidade_estoque: estoque, estoque_minimo: minimo, multiplo_venda: multiplo }) {
    if (estoque < Math.max(multiplo, 1)) return 'indisponivel';
    if (estoque <= minimo) return 'ultimas_unidades';
    return 'disponivel';
}

const ROTULOS_FAIXA = {
    indisponivel: 'Indisponível',
    ultimas_unidades: 'Últimas unidades',
    disponivel: 'Disponível'
};

// Faixa mostrada a visitantes e clientes no lugar do estoque exato: { codigo, rotulo }.
// "acima_do_limite" vale quando o produto está disponível e o estoque passa de "limiteAlto".
function faixaEstoque(produto, limiteAlto) {
    const situacao = disponibilidade(produto);
    if (situacao === 'disponivel' && produto.quantidade_estoque > limiteAlto) {
        return { codigo: 'acima_do_limite', rotulo: `Mais de ${limiteAlto} disponíveis` };
    }
    return { codigo: situacao, rotulo: ROTULOS_FAIXA[situacao] };
}

// Configuração "estoque_faixa_alta" (padrão 50).
async function lerLimiteFaixa() {
    return require('./configuracoes').obterNumero('estoque_faixa_alta');
}

module.exports = { alterarEstoque, disponibilidade, faixaEstoque, lerLimiteFaixa };
