const { Op } = require('sequelize');
const { Carrinho, Favorito, Produto } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { disponibilidade, faixaEstoque, lerLimiteFaixa } = require('../servicos/estoque');
const { apresentarProduto, INCLUDES: INCLUDES_PRODUTO } = require('./produtoControlador');

const MAXIMO_ITENS = 200;
const MAXIMO_QUANTIDADE = 100000;

/**
 * Valida o corpo de PUT /carrinho: { itens: [{ id_produto, quantidade }] }, de 0 a 200 itens, sem repetir produto.
 * Confere se cada produto existe e está ativo e se a quantidade é múltipla da embalagem (multiplo_venda).
 * Não olha o estoque: quem confere a disponibilidade é o checkout.
 */
async function validarItens(corpo) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'O corpo da requisição deve ser um objeto.');
    }
    const erros = [];
    for (const campo of Object.keys(corpo)) {
        if (campo !== 'itens') erros.push({ campo, mensagem: `Campo não permitido: ${campo}.` });
    }
    if (!Array.isArray(corpo.itens) || corpo.itens.length > MAXIMO_ITENS) {
        erros.push({ campo: 'itens', mensagem: `Envie { "itens": [...] } com até ${MAXIMO_ITENS} itens.` });
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }

    const itens = [];
    const vistos = new Set();
    corpo.itens.forEach((item, indice) => {
        const campo = `itens[${indice}]`;
        const idProduto = item && item.id_produto;
        const quantidade = item && item.quantidade;
        if (!item || typeof item !== 'object' || !Number.isSafeInteger(idProduto) || idProduto <= 0 ||
            !Number.isSafeInteger(quantidade) || quantidade <= 0 || quantidade > MAXIMO_QUANTIDADE) {
            erros.push({ campo, mensagem: 'Cada item precisa de id_produto e quantidade inteiros positivos.' });
        } else if (vistos.has(idProduto)) {
            erros.push({ campo, mensagem: `O produto ${idProduto} aparece mais de uma vez.` });
        } else {
            vistos.add(idProduto);
            itens.push({ id_produto: idProduto, quantidade });
        }
    });

    if (itens.length > 0) {
        const produtos = await Produto.findAll({
            where: { id_produto: { [Op.in]: itens.map((item) => item.id_produto) } },
            attributes: ['id_produto', 'sku', 'ativo', 'multiplo_venda']
        });
        const porId = new Map(produtos.map((produto) => [produto.id_produto, produto]));
        for (const item of itens) {
            const produto = porId.get(item.id_produto);
            const campo = `itens[${corpo.itens.findIndex((original) => original && original.id_produto === item.id_produto)}]`;
            if (!produto || !produto.ativo) {
                erros.push({ campo, mensagem: `Produto ${item.id_produto} inexistente ou inativo.` });
            } else if (item.quantidade % Math.max(produto.multiplo_venda, 1) !== 0) {
                erros.push({ campo, mensagem: `A quantidade de ${produto.sku} deve ser múltipla de ${produto.multiplo_venda}.` });
            }
        }
    }
    if (erros.length > 0) throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    return itens;
}

/**
 * Monta a resposta do carrinho com os dados atuais do produto, sem o estoque exato.
 * Produtos que deixaram de existir saem da lista; os inativos ficam marcados (ativo: false, indisponivel).
 */
async function apresentarCarrinho(carrinho) {
    const itensGuardados = carrinho ? carrinho.itens : [];
    const produtos = itensGuardados.length === 0 ? [] : await Produto.findAll({
        where: { id_produto: { [Op.in]: itensGuardados.map((item) => item.id_produto) } }
    });
    const porId = new Map(produtos.map((produto) => [produto.id_produto, produto]));
    const limite = await lerLimiteFaixa();
    const itens = itensGuardados.filter((item) => porId.has(item.id_produto)).map((item) => {
        const produto = porId.get(item.id_produto);
        return {
            id_produto: produto.id_produto,
            sku: produto.sku,
            nome: produto.nome,
            imagem_url: produto.imagem_url,
            quantidade: item.quantidade,
            multiplo_venda: Math.max(produto.multiplo_venda, 1),
            ativo: produto.ativo,
            disponibilidade: produto.ativo ? disponibilidade(produto) : 'indisponivel',
            faixa_estoque: produto.ativo ? faixaEstoque(produto, limite) : { codigo: 'indisponivel', rotulo: 'Indisponível' }
        };
    });
    return {
        itens,
        total_itens: itens.reduce((soma, item) => soma + item.quantidade, 0),
        atualizado_em: carrinho ? carrinho.atualizado_em : null
    };
}

// GET /carrinho (cliente)
async function obterCarrinho(req, res) {
    const carrinho = await Carrinho.findOne({ where: { id_usuario: req.usuario.id } });
    return res.status(200).json(await apresentarCarrinho(carrinho));
}

// PUT /carrinho (cliente): substitui o carrinho inteiro.
async function substituirCarrinho(req, res) {
    const itens = await validarItens(req.body);
    // Gravação explícita da data: salvar a mesma lista também conta como atividade do cliente.
    await Carrinho.upsert({ id_usuario: req.usuario.id, itens, atualizado_em: new Date() });
    const carrinho = await Carrinho.findOne({ where: { id_usuario: req.usuario.id } });
    return res.status(200).json(await apresentarCarrinho(carrinho));
}

// DELETE /carrinho (cliente): esvazia o carrinho (idempotente).
async function limparCarrinho(req, res) {
    await Carrinho.destroy({ where: { id_usuario: req.usuario.id } });
    return res.status(200).json({ mensagem: 'Carrinho esvaziado.', ...(await apresentarCarrinho(null)) });
}

// Favoritos ---------------------------------------------------------------------------------------

function lerIdProduto(valor) {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'Identificador de produto inválido.');
    }
    return id;
}

// GET /favoritos (cliente): no formato da vitrine, do mais recente para o mais antigo. Produtos inativos não aparecem.
async function listarFavoritos(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 24, limiteMaximo: 100 });
    const { rows, count } = await Favorito.findAndCountAll({
        where: { id_usuario: req.usuario.id },
        include: [{
            model: Produto,
            as: 'produto',
            required: true,
            where: { ativo: true },
            include: INCLUDES_PRODUTO
        }],
        order: [['criado_em', 'DESC'], ['id_produto', 'DESC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    const limite = await lerLimiteFaixa();
    return res.status(200).json({
        produtos: rows.map((favorito) => apresentarProduto(favorito.produto, req.usuario, limite)),
        paginacao: montarPaginacao(count, paginacao)
    });
}

// PUT /favoritos/:id_produto (cliente): idempotente.
async function adicionarFavorito(req, res) {
    const idProduto = lerIdProduto(req.params.id_produto);
    const produto = await Produto.findByPk(idProduto, { attributes: ['id_produto', 'ativo'] });
    if (!produto || !produto.ativo) {
        throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
    }
    await Favorito.findOrCreate({ where: { id_usuario: req.usuario.id, id_produto: idProduto } });
    return res.status(200).json({ mensagem: 'Produto nos favoritos.', id_produto: idProduto, favorito: true });
}

// DELETE /favoritos/:id_produto (cliente): idempotente.
async function removerFavorito(req, res) {
    const idProduto = lerIdProduto(req.params.id_produto);
    await Favorito.destroy({ where: { id_usuario: req.usuario.id, id_produto: idProduto } });
    return res.status(200).json({ mensagem: 'Produto fora dos favoritos.', id_produto: idProduto, favorito: false });
}

module.exports = {
    obterCarrinho, substituirCarrinho, limparCarrinho, listarFavoritos, adicionarFavorito, removerFavorito
};
