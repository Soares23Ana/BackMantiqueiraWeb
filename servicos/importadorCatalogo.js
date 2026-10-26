const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Produto, Categoria, Marca } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerCsv } = require('../lib/csv');
const { gerarSlug } = require('../lib/texto');
const { validarDadosProduto } = require('../helpers/validacaoProduto');
const { alterarEstoque } = require('./estoque');

// Mesmo formato do seeds/catalogo_inicial.csv. Só "sku" é obrigatória; colunas ausentes não são alteradas.
const COLUNAS = [
    'sku', 'nome', 'categoria', 'marca', 'descricao', 'destaques', 'imagem_url',
    'ativo', 'estoque_minimo', 'multiplo_venda', 'preco', 'estoque'
];
const VERDADEIRO = ['sim', 's', 'true', '1', 'ativo'];
const FALSO = ['nao', 'não', 'n', 'false', '0', 'inativo'];
const MAXIMO_ERROS = 500;
const CAMPOS_COMPARADOS = [
    'nome', 'descricao', 'destaques', 'imagem_url', 'id_categoria', 'id_marca',
    'preco', 'estoque_minimo', 'multiplo_venda', 'ativo'
];

// Converte os textos de uma linha do CSV nos tipos esperados por validarDadosProduto.
function converterLinha(valores, cabecalho) {
    const erros = [];
    const corpo = {};
    const tem = (coluna) => cabecalho.includes(coluna);

    corpo.sku = valores.sku;
    if (tem('nome')) corpo.nome = valores.nome;
    if (tem('descricao')) corpo.descricao = valores.descricao || null;
    if (tem('destaques')) {
        corpo.destaques = valores.destaques
            ? valores.destaques.split('|').map((item) => item.trim()).filter(Boolean)
            : null;
    }
    if (tem('imagem_url')) corpo.imagem_url = valores.imagem_url || null;
    if (tem('ativo') && valores.ativo) {
        const ativo = valores.ativo.toLowerCase();
        if (VERDADEIRO.includes(ativo)) corpo.ativo = true;
        else if (FALSO.includes(ativo)) corpo.ativo = false;
        else erros.push({ campo: 'ativo', mensagem: 'Use "sim" ou "nao" na coluna ativo.' });
    }
    for (const coluna of ['estoque_minimo', 'multiplo_venda']) {
        if (tem(coluna) && valores[coluna]) corpo[coluna] = valores[coluna];
    }
    if (tem('preco')) corpo.preco = valores.preco || null;

    let estoque;
    if (tem('estoque') && valores.estoque !== '') {
        estoque = Number(valores.estoque);
        if (!Number.isSafeInteger(estoque) || estoque < 0) {
            erros.push({ campo: 'estoque', mensagem: 'O estoque deve ser um número inteiro maior ou igual a zero.' });
        }
    }

    const nomesTaxonomia = {};
    for (const coluna of ['categoria', 'marca']) {
        if (!tem(coluna)) continue;
        if (valores[coluna].length > 100) {
            erros.push({ campo: coluna, mensagem: `O campo ${coluna} deve ter no máximo 100 caracteres.` });
        } else if (valores[coluna] && !gerarSlug(valores[coluna])) {
            erros.push({ campo: coluna, mensagem: `O campo ${coluna} precisa ter letras ou números.` });
        }
        nomesTaxonomia[coluna] = valores[coluna] || null;
    }

    let dados = {};
    try {
        dados = validarDadosProduto(corpo, { parcial: true });
    } catch (erro) {
        if (!(erro instanceof ErroApi)) throw erro;
        erros.push(...erro.detalhes);
    }
    return { dados, estoque, nomesTaxonomia, erros };
}

function iguais(campo, atual, novo) {
    if (campo === 'destaques') return JSON.stringify(atual ?? null) === JSON.stringify(novo ?? null);
    if (campo === 'preco') return (atual === null ? null : Number(atual)) === (novo === null ? null : Number(novo));
    return (atual ?? null) === (novo ?? null);
}

// Busca a categoria/marca pelo slug do nome e cria se não existir.
async function resolverTaxonomia(Modelo, cache, nome, transacao, contador) {
    if (!nome) return null;
    const slug = gerarSlug(nome);
    if (!cache.has(slug)) {
        const registro = await Modelo.create({ nome, slug }, { transaction: transacao });
        cache.set(slug, registro);
        contador.total += 1;
    }
    return cache.get(slug)[Modelo.primaryKeyAttribute];
}

/**
 * Importa produtos de um CSV, fazendo upsert por SKU.
 * - Cada linha é validada separadamente; linhas com erro são puladas e listadas no relatório.
 * - simular: executa tudo e desfaz no final, devolvendo o mesmo relatório.
 * - desativarAusentes: produtos ativos cujo SKU não aparece no arquivo são desativados (carga completa).
 * - somenteEstoque: aplica só as colunas sku e estoque (job de estoque); as demais são ignoradas.
 * - Mudanças de estoque geram movimentações do tipo "importacao".
 */
async function importarCatalogo(conteudo, {
    simular = false,
    desativarAusentes = false,
    somenteEstoque = false,
    idUsuario = null,
    origem = 'importação'
} = {}) {
    let csv;
    try {
        csv = lerCsv(conteudo);
    } catch (erro) {
        throw new ErroApi(422, 'CSV_INVALIDO', `Não foi possível ler o CSV: ${erro.message}`);
    }
    const { registros } = csv;
    if (!csv.cabecalho.includes('sku')) {
        throw new ErroApi(422, 'CSV_INVALIDO', 'O CSV precisa de uma coluna "sku".');
    }
    if (somenteEstoque && !csv.cabecalho.includes('estoque')) {
        throw new ErroApi(422, 'CSV_INVALIDO', 'O arquivo de estoque precisa de uma coluna "estoque".');
    }
    const cabecalho = somenteEstoque
        ? csv.cabecalho.filter((coluna) => coluna === 'sku' || coluna === 'estoque')
        : csv.cabecalho;

    const relatorio = {
        simulado: simular,
        linhas: registros.length,
        criados: 0,
        atualizados: 0,
        inalterados: 0,
        desativados: 0,
        com_erro: 0,
        categorias_criadas: 0,
        marcas_criadas: 0,
        movimentacoes_estoque: 0,
        erros: [],
        avisos: []
    };
    // Colunas desconhecidas ou fora do uso atual (ex.: "nome" no job de estoque).
    const colunasIgnoradas = csv.cabecalho.filter((coluna) =>
        coluna && !(cabecalho.includes(coluna) && COLUNAS.includes(coluna)));
    if (colunasIgnoradas.length > 0) {
        relatorio.avisos.push(`Colunas ignoradas: ${colunasIgnoradas.join(', ')}.`);
    }
    const registrarErros = (linha, sku, erros) => {
        relatorio.com_erro += 1;
        for (const erro of erros) {
            if (relatorio.erros.length < MAXIMO_ERROS) relatorio.erros.push({ linha, sku: sku || null, ...erro });
        }
    };

    // Valida todas as linhas antes de abrir a transação.
    const skusNoArquivo = new Set();
    const validas = [];
    for (const registro of registros) {
        const sku = registro.valores.sku;
        const convertido = converterLinha(registro.valores, cabecalho);
        if (registro.excedente) {
            convertido.erros.push({ campo: null, mensagem: 'A linha tem mais colunas que o cabeçalho.' });
        }
        const chave = sku && sku.toUpperCase();
        if (chave && skusNoArquivo.has(chave)) {
            convertido.erros.push({ campo: 'sku', mensagem: 'SKU repetido no arquivo.' });
        }
        if (chave) skusNoArquivo.add(chave);
        if (convertido.erros.length > 0) {
            registrarErros(registro.linha, sku, convertido.erros);
        } else {
            validas.push({ linha: registro.linha, ...convertido });
        }
    }

    const transacao = await sequelize.transaction();
    try {
        const existentes = validas.length === 0 ? [] : await Produto.findAll({
            where: { sku: { [Op.in]: validas.map((item) => item.dados.sku) } },
            transaction: transacao,
            lock: transacao.LOCK.UPDATE
        });
        const porSku = new Map(existentes.map((produto) => [produto.sku.toUpperCase(), produto]));
        const categorias = new Map((await Categoria.findAll({ transaction: transacao })).map((c) => [c.slug, c]));
        const marcas = new Map((await Marca.findAll({ transaction: transacao })).map((m) => [m.slug, m]));
        const contadorCategorias = { total: 0 };
        const contadorMarcas = { total: 0 };

        for (const item of validas) {
            const dados = { ...item.dados };
            if ('categoria' in item.nomesTaxonomia) {
                dados.id_categoria = await resolverTaxonomia(Categoria, categorias, item.nomesTaxonomia.categoria, transacao, contadorCategorias);
            }
            if ('marca' in item.nomesTaxonomia) {
                dados.id_marca = await resolverTaxonomia(Marca, marcas, item.nomesTaxonomia.marca, transacao, contadorMarcas);
            }

            let produto = porSku.get(dados.sku.toUpperCase());
            let alterado = false;
            if (!produto) {
                if (!dados.nome) {
                    registrarErros(item.linha, dados.sku, [{ campo: 'nome', mensagem: 'Produto novo exige o nome.' }]);
                    continue;
                }
                produto = await Produto.create({ ...dados, quantidade_estoque: 0 }, { transaction: transacao });
                porSku.set(dados.sku.toUpperCase(), produto);
                relatorio.criados += 1;
            } else {
                const { sku, ...campos } = dados;
                const mudancas = Object.fromEntries(
                    Object.entries(campos).filter(([campo, valor]) =>
                        CAMPOS_COMPARADOS.includes(campo) && !iguais(campo, produto[campo], valor))
                );
                if (Object.keys(mudancas).length > 0) {
                    await produto.update(mudancas, { transaction: transacao });
                    alterado = true;
                }
            }

            if (item.estoque !== undefined) {
                const movimentacao = await alterarEstoque(produto, item.estoque, {
                    tipo: 'importacao',
                    observacao: `Importação de catálogo (${origem}), linha ${item.linha}.`,
                    idUsuario,
                    transacao
                });
                if (movimentacao) {
                    relatorio.movimentacoes_estoque += 1;
                    alterado = true;
                }
            }
            if (existentes.includes(produto)) {
                if (alterado) relatorio.atualizados += 1;
                else relatorio.inalterados += 1;
            }
        }

        // Proteção: um arquivo vazio, truncado ou com erros desativaria produtos que só "sumiram" por falha
        // no arquivo. Nesses casos, ninguém é desativado e o relatório avisa.
        const arquivoIntegro = relatorio.linhas > 0 && relatorio.com_erro === 0;
        if (desativarAusentes && !arquivoIntegro) {
            relatorio.avisos.push('Nenhum produto foi desativado: a carga completa só desativa ausentes quando o arquivo não tem erros.');
        }
        if (desativarAusentes && arquivoIntegro) {
            const ativos = await Produto.findAll({
                where: { ativo: true },
                attributes: ['id_produto', 'sku'],
                transaction: transacao
            });
            const ausentes = ativos.filter((produto) => !skusNoArquivo.has(produto.sku.toUpperCase()));
            if (ausentes.length > 0) {
                await Produto.update(
                    { ativo: false },
                    { where: { id_produto: ausentes.map((p) => p.id_produto) }, transaction: transacao }
                );
            }
            relatorio.desativados = ausentes.length;
        }

        relatorio.categorias_criadas = contadorCategorias.total;
        relatorio.marcas_criadas = contadorMarcas.total;
        if (simular) await transacao.rollback();
        else await transacao.commit();
        return relatorio;
    } catch (erro) {
        await transacao.rollback();
        throw erro;
    }
}

module.exports = { importarCatalogo, COLUNAS };
