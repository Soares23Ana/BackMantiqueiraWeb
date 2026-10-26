const { ErroApi } = require('../lib/erros');
const { ehCaminhoOuUrlSegura } = require('../lib/texto');

const PADRAO_SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const CAMPOS_PRODUTO = [
    'sku',
    'nome',
    'descricao',
    'destaques',
    'imagem_url',
    'id_categoria',
    'id_marca',
    'id_fornecedor',
    'preco',
    'estoque_minimo',
    'multiplo_venda',
    'ativo'
];
const OBRIGATORIOS = ['sku', 'nome'];

function texto(valor, campo, maximo, erros, { obrigatorio = false } = {}) {
    if (valor === null || (typeof valor === 'string' && !valor.trim())) {
        if (obrigatorio) erros.push({ campo, mensagem: `O campo ${campo} é obrigatório.` });
        return null;
    }
    if (typeof valor !== 'string') {
        erros.push({ campo, mensagem: `O campo ${campo} deve ser texto.` });
        return undefined;
    }
    const limpo = valor.trim();
    if (limpo.length > maximo) {
        erros.push({ campo, mensagem: `O campo ${campo} deve ter no máximo ${maximo} caracteres.` });
    }
    return limpo;
}

function inteiro(valor, campo, minimo, erros, { anulavel = false } = {}) {
    if (valor === null && anulavel) return null;
    const numero = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
    if (!Number.isSafeInteger(numero) || numero < minimo || numero > 1000000000) {
        erros.push({ campo, mensagem: `O campo ${campo} deve ser um número inteiro maior ou igual a ${minimo}.` });
        return undefined;
    }
    return numero;
}

/**
 * Valida o corpo de criação/edição de produto. Com parcial=true (PATCH e importação), só os campos enviados
 * são validados. Lança ErroApi 422 com a lista de todos os campos inválidos em detalhes.
 */
function validarDadosProduto(corpo, { parcial = false, permitirEstoque = false } = {}) {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'O corpo da requisição deve ser um objeto.');
    }
    const erros = [];
    const dados = {};
    const permitidos = permitirEstoque ? [...CAMPOS_PRODUTO, 'quantidade_estoque'] : CAMPOS_PRODUTO;

    for (const campo of Object.keys(corpo)) {
        if (campo === 'quantidade_estoque' && !permitirEstoque) {
            erros.push({ campo, mensagem: 'O estoque é alterado por PATCH /produtos/:id/estoque, com observação.' });
        } else if (!permitidos.includes(campo)) {
            erros.push({ campo, mensagem: `Campo não permitido: ${campo}.` });
        }
    }
    if (!parcial) {
        for (const campo of OBRIGATORIOS) {
            if (corpo[campo] === undefined) erros.push({ campo, mensagem: `O campo ${campo} é obrigatório.` });
        }
    }
    const enviado = (campo) => corpo[campo] !== undefined;

    if (enviado('sku')) {
        const sku = texto(corpo.sku, 'sku', 40, erros, { obrigatorio: true });
        if (sku && !PADRAO_SKU.test(sku)) {
            erros.push({ campo: 'sku', mensagem: 'O SKU deve conter apenas letras, números, ponto, hífen ou sublinhado.' });
        }
        dados.sku = sku;
    }
    if (enviado('nome')) dados.nome = texto(corpo.nome, 'nome', 150, erros, { obrigatorio: true });
    if (enviado('descricao')) dados.descricao = texto(corpo.descricao, 'descricao', 5000, erros);

    if (enviado('destaques')) {
        if (corpo.destaques === null) {
            dados.destaques = null;
        } else if (!Array.isArray(corpo.destaques) || corpo.destaques.length > 10 ||
            corpo.destaques.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > 150)) {
            erros.push({ campo: 'destaques', mensagem: 'Os destaques devem ser uma lista de até 10 textos com até 150 caracteres.' });
        } else {
            dados.destaques = corpo.destaques.map((item) => item.trim());
            if (dados.destaques.length === 0) dados.destaques = null;
        }
    }

    if (enviado('imagem_url')) {
        const imagem = texto(corpo.imagem_url, 'imagem_url', 2048, erros);
        if (imagem && !ehCaminhoOuUrlSegura(imagem)) {
            erros.push({ campo: 'imagem_url', mensagem: 'A imagem deve ser um caminho interno (ex.: /img/x.webp) ou URL HTTP/HTTPS.' });
        }
        dados.imagem_url = imagem;
    }

    for (const campo of ['id_categoria', 'id_marca', 'id_fornecedor']) {
        if (enviado(campo)) dados[campo] = inteiro(corpo[campo], campo, 1, erros, { anulavel: true });
    }

    if (enviado('preco')) {
        if (corpo.preco === null || corpo.preco === '') {
            dados.preco = null;
        } else {
            const preco = typeof corpo.preco === 'string' ? Number(corpo.preco.replace(',', '.')) : corpo.preco;
            if (typeof preco !== 'number' || !Number.isFinite(preco) || preco < 0 || preco > 99999999.99) {
                erros.push({ campo: 'preco', mensagem: 'O preço deve ser um número maior ou igual a zero.' });
            } else {
                dados.preco = Math.round(preco * 100) / 100;
            }
        }
    }

    if (enviado('estoque_minimo')) dados.estoque_minimo = inteiro(corpo.estoque_minimo, 'estoque_minimo', 0, erros);
    if (enviado('multiplo_venda')) dados.multiplo_venda = inteiro(corpo.multiplo_venda, 'multiplo_venda', 1, erros);
    if (permitirEstoque && enviado('quantidade_estoque')) {
        dados.quantidade_estoque = inteiro(corpo.quantidade_estoque, 'quantidade_estoque', 0, erros);
    }

    if (enviado('ativo')) {
        if (typeof corpo.ativo !== 'boolean') {
            erros.push({ campo: 'ativo', mensagem: 'O campo ativo deve ser true ou false.' });
        } else {
            dados.ativo = corpo.ativo;
        }
    }

    if (parcial && Object.keys(corpo).length === 0) {
        erros.push({ campo: null, mensagem: 'Informe ao menos um campo para atualizar.' });
    }
    if (erros.length > 0) {
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }
    return dados;
}

module.exports = { validarDadosProduto, PADRAO_SKU };
