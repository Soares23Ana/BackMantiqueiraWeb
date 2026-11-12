const fs = require('node:fs');
const { Op } = require('sequelize');
const config = require('../config/ambiente');
const sequelize = require('../db/conn');
const { Produto, Categoria, Marca } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerMatriz, normalizarNomeColuna, decodificarArquivo } = require('../lib/planilha');
const { lerCsvMatriz } = require('../lib/csv');
const { gerarNomeExibicao, carregarDicionario } = require('../lib/nomeProduto');
const { gerarSlug } = require('../lib/texto');
const { validarDadosProduto } = require('../helpers/validacaoProduto');
const { alterarEstoque } = require('./estoque');

// Mesmo formato do seeds/catalogo_inicial.csv. Só "sku" é obrigatória; colunas ausentes não são alteradas.
const COLUNAS = [
    'sku', 'nome', 'categoria', 'subcategoria', 'marca', 'descricao', 'destaques', 'imagem_url',
    'ativo', 'estoque_minimo', 'multiplo_venda', 'preco', 'estoque'
];
// Cabeçalhos do portfólio (CSV ou Excel), sem diferenciar maiúsculas nem acentos. "PRODUTO" é o nome do portfólio
// (nome_erp): dele sai o nome de exibição, a menos que a planilha tenha a própria coluna "nome".
const COLUNAS_ACEITAS = [...COLUNAS, 'nome_erp', 'categoria_erp'];
const APELIDOS = {
    codigo: 'sku',
    cod: 'sku',
    produto: 'nome_erp',
    fabricante: 'marca',
    // A categoria do portfólio passa pelo mapa seeds/mapa_categorias.csv (categoria e subcategoria do site).
    'categoria - cad. erp': 'categoria_erp',
    quantidade: 'estoque',
    saldo: 'estoque'
};
const VERDADEIRO = ['sim', 's', 'true', '1', 'ativo'];
const FALSO = ['nao', 'não', 'n', 'false', '0', 'inativo'];
const MAXIMO_ERROS = 500;
const CAMPOS_COMPARADOS = [
    'nome', 'nome_erp', 'descricao', 'destaques', 'imagem_url', 'id_categoria', 'id_marca',
    'preco', 'estoque_minimo', 'multiplo_venda', 'ativo'
];

// Converte os textos de uma linha do CSV nos tipos esperados por validarDadosProduto.
function converterLinha(valores, cabecalho, dicionario) {
    const erros = [];
    const corpo = {};
    const tem = (coluna) => cabecalho.includes(coluna);

    corpo.sku = valores.sku;
    if (tem('nome')) corpo.nome = valores.nome;
    // Nome do portfólio: guarda o original e, sem coluna "nome", gera o nome de exibição dele.
    let nomeErp;
    let nomeGerado = false;
    let pendentes = [];
    if (tem('nome_erp')) {
        nomeErp = valores.nome_erp || null;
        if (nomeErp && nomeErp.length > 255) {
            erros.push({ campo: 'nome_erp', mensagem: 'O nome do portfólio deve ter no máximo 255 caracteres.' });
        } else if (nomeErp && !tem('nome')) {
            const gerado = gerarNomeExibicao(nomeErp, dicionario);
            corpo.nome = gerado.nome;
            nomeGerado = true;
            pendentes = gerado.pendentes;
        }
    }
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
    for (const coluna of ['categoria', 'subcategoria', 'marca']) {
        if (!tem(coluna)) continue;
        if (valores[coluna].length > 100) {
            erros.push({ campo: coluna, mensagem: `O campo ${coluna} deve ter no máximo 100 caracteres.` });
        } else if (valores[coluna] && !gerarSlug(valores[coluna])) {
            erros.push({ campo: coluna, mensagem: `O campo ${coluna} precisa ter letras ou números.` });
        }
        nomesTaxonomia[coluna] = valores[coluna] || null;
    }
    if (tem('categoria_erp')) {
        if (valores.categoria_erp.length > 255) {
            erros.push({ campo: 'categoria_erp', mensagem: 'A categoria do portfólio deve ter no máximo 255 caracteres.' });
        }
        nomesTaxonomia.categoria_erp = valores.categoria_erp || null;
    }
    if (nomesTaxonomia.subcategoria && !nomesTaxonomia.categoria) {
        erros.push({ campo: 'subcategoria', mensagem: 'A subcategoria exige a categoria.' });
    }

    let dados = {};
    try {
        dados = validarDadosProduto(corpo, { parcial: true });
    } catch (erro) {
        if (!(erro instanceof ErroApi)) throw erro;
        erros.push(...erro.detalhes);
    }
    return { dados, estoque, nomesTaxonomia, nomeErp, nomeGerado, pendentes, erros };
}

/**
 * Transforma a matriz lida (CSV ou Excel) em tabela: o cabeçalho é a primeira linha não vazia; os nomes das colunas
 * passam pelos apelidos (CÓDIGO => sku, FABRICANTE => marca...) e as colunas desconhecidas são ignoradas.
 * Devolve { cabecalho (nomes canônicos), registros, colunasIgnoradas (nomes como vieram na planilha) }.
 */
function montarTabela(linhas) {
    const [cabecalhoLinha, ...dados] = linhas;
    if (!cabecalhoLinha) return { cabecalho: [], registros: [], colunasIgnoradas: [] };
    const canonicas = [];
    const colunasIgnoradas = [];
    const usadas = new Set();
    cabecalhoLinha.celulas.forEach((original) => {
        const normalizado = normalizarNomeColuna(original);
        const canonica = COLUNAS_ACEITAS.includes(normalizado) ? normalizado : (APELIDOS[normalizado] || null);
        if (!canonica || usadas.has(canonica)) {
            canonicas.push(null);
            if (original.trim() && !colunasIgnoradas.includes(original.trim())) colunasIgnoradas.push(original.trim());
            return;
        }
        usadas.add(canonica);
        canonicas.push(canonica);
    });
    const cabecalho = canonicas.filter(Boolean);
    const registros = dados.map((linha) => ({
        linha: linha.linha,
        // Mais células preenchidas que colunas no cabeçalho.
        excedente: linha.celulas.slice(cabecalhoLinha.celulas.length).some((celula) => celula !== ''),
        valores: Object.fromEntries(cabecalho.map((coluna) => [coluna, linha.celulas[canonicas.indexOf(coluna)] ?? ''])),
        errosCelula: (linha.erros || []).map((item) => ({ campo: canonicas[item.coluna] || null, erro: item.erro }))
    }));
    return { cabecalho, registros, colunasIgnoradas };
}

function iguais(campo, atual, novo) {
    if (campo === 'destaques') return JSON.stringify(atual ?? null) === JSON.stringify(novo ?? null);
    if (campo === 'preco') return (atual === null ? null : Number(atual)) === (novo === null ? null : Number(novo));
    return (atual ?? null) === (novo ?? null);
}

/**
 * Mapa da categoria do portfólio: seeds/mapa_categorias.csv (categoria_erp;categoria;subcategoria), sem diferenciar
 * maiúsculas nem acentos. "origem" pode ser o texto do CSV (testes); sem ele, lê o arquivo configurado.
 * Devolve { mapa: Map(categoria_erp normalizada => { categoria, subcategoria }), encontrado }.
 */
function carregarMapaCategorias(origem) {
    let texto = origem;
    if (texto === undefined) {
        try {
            texto = decodificarArquivo(fs.readFileSync(config.importacao.mapaCategorias));
        } catch {
            return { mapa: new Map(), encontrado: false };
        }
    }
    const [cabecalho, ...linhas] = lerCsvMatriz(texto);
    const mapa = new Map();
    if (!cabecalho) return { mapa, encontrado: true };
    const indice = (nome) => cabecalho.celulas.findIndex((celula) => normalizarNomeColuna(celula) === nome);
    const [iErp, iCategoria, iSub] = [indice('categoria_erp'), indice('categoria'), indice('subcategoria')];
    for (const { celulas } of linhas) {
        const categoria = iCategoria >= 0 ? celulas[iCategoria] : '';
        if (iErp >= 0 && celulas[iErp] && categoria) {
            mapa.set(normalizarNomeColuna(celulas[iErp]), { categoria, subcategoria: (iSub >= 0 && celulas[iSub]) || null });
        }
    }
    return { mapa, encontrado: true };
}

/**
 * Categorias em dois níveis: acha a categoria pelo nome dentro do mesmo pai (principal: id_pai nulo) e cria se
 * não existir. O slug é único no geral: em colisão tenta "slug-do-pai-slug" e depois um número.
 */
function criarResolvedorCategorias(existentes, transacao, contador) {
    const chaveDe = (nome, idPai) => `${idPai || 0}|${gerarSlug(nome)}`;
    const porChave = new Map(existentes.map((categoria) => [chaveDe(categoria.nome, categoria.id_pai), categoria]));
    const slugs = new Set(existentes.map((categoria) => categoria.slug));
    const porId = new Map(existentes.map((categoria) => [categoria.id_categoria, categoria]));
    return async function resolver(nome, idPai = null) {
        const chave = chaveDe(nome, idPai);
        if (!porChave.has(chave)) {
            const base = gerarSlug(nome);
            const candidatos = [base];
            if (idPai) candidatos.push(`${porId.get(idPai).slug}-${base}`.slice(0, 120));
            let slug = candidatos.find((candidato) => !slugs.has(candidato));
            for (let n = 2; !slug; n += 1) {
                const tentativa = `${candidatos[candidatos.length - 1].slice(0, 115)}-${n}`;
                if (!slugs.has(tentativa)) slug = tentativa;
            }
            const registro = await Categoria.create({ nome, slug, id_pai: idPai }, { transaction: transacao });
            porChave.set(chave, registro);
            porId.set(registro.id_categoria, registro);
            slugs.add(slug);
            contador.total += 1;
        }
        return porChave.get(chave).id_categoria;
    };
}

// Busca a marca pelo slug do nome e cria se não existir.
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
async function importarCatalogo(entrada, {
    simular = false,
    desativarAusentes = false,
    somenteEstoque = false,
    idUsuario = null,
    origem = 'importação',
    formato,
    dicionario = carregarDicionario(),
    mapaCategoriasOrigem
} = {}) {
    const { linhas, formato: formatoLido } = await lerMatriz(entrada, { formato });
    const csv = montarTabela(linhas);
    const { registros } = csv;
    if (!csv.cabecalho.includes('sku')) {
        throw new ErroApi(422, 'CSV_INVALIDO', 'O arquivo precisa de uma coluna "sku" (ou "código").');
    }
    if (somenteEstoque && !csv.cabecalho.includes('estoque')) {
        throw new ErroApi(422, 'CSV_INVALIDO', 'O arquivo de estoque precisa de uma coluna "estoque".');
    }
    const cabecalho = somenteEstoque
        ? csv.cabecalho.filter((coluna) => coluna === 'sku' || coluna === 'estoque')
        : csv.cabecalho;

    const relatorio = {
        simulado: simular,
        formato: formatoLido,
        linhas: registros.length,
        criados: 0,
        atualizados: 0,
        inalterados: 0,
        desativados: 0,
        com_erro: 0,
        categorias_criadas: 0,
        marcas_criadas: 0,
        movimentacoes_estoque: 0,
        abreviacoes_pendentes: [],
        categorias_sem_mapa: [],
        colunas_ignoradas: [],
        erros: [],
        avisos: []
    };
    // Colunas desconhecidas (ex.: "CÓDIGO DE BARRAS") ou fora do uso atual (ex.: "nome" no job de estoque): ignoradas, sem erro.
    const colunasIgnoradas = [
        ...csv.colunasIgnoradas,
        ...csv.cabecalho.filter((coluna) => !cabecalho.includes(coluna))
    ];
    relatorio.colunas_ignoradas = colunasIgnoradas;
    if (colunasIgnoradas.length > 0) {
        relatorio.avisos.push(`Colunas ignoradas: ${colunasIgnoradas.join(', ')}.`);
    }
    const pendentes = new Map();
    const semMapa = new Map();
    const contadorCategorias = { total: 0 };
    const mapaCategorias = csv.cabecalho.includes('categoria_erp') ? carregarMapaCategorias(mapaCategoriasOrigem) : { mapa: new Map(), encontrado: true };
    if (!mapaCategorias.encontrado) {
        relatorio.avisos.push('Mapa de categorias não encontrado (seeds/mapa_categorias.csv): as categorias do portfólio ficaram sem mapa.');
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
        const convertido = converterLinha(registro.valores, cabecalho, dicionario);
        for (const { campo, erro } of registro.errosCelula) {
            convertido.erros.push({ campo, mensagem: `Célula com erro (${erro}).` });
        }
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
            for (const abreviacao of convertido.pendentes) {
                const atual = pendentes.get(abreviacao) || { abreviacao, ocorrencias: 0, exemplo: convertido.nomeErp };
                atual.ocorrencias += 1;
                pendentes.set(abreviacao, atual);
            }
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
        const resolverCategoria = criarResolvedorCategorias(await Categoria.findAll({ transaction: transacao }), transacao, contadorCategorias);
        const marcas = new Map((await Marca.findAll({ transaction: transacao })).map((m) => [m.slug, m]));
        const contadorMarcas = { total: 0 };

        for (const item of validas) {
            const dados = { ...item.dados };
            // O produto aponta para a subcategoria quando houver, senão para a categoria.
            const nomes = item.nomesTaxonomia;
            if ('categoria' in nomes || 'subcategoria' in nomes) {
                if (!nomes.categoria) {
                    dados.id_categoria = null;
                } else {
                    const idCategoria = await resolverCategoria(nomes.categoria, null);
                    dados.id_categoria = nomes.subcategoria ? await resolverCategoria(nomes.subcategoria, idCategoria) : idCategoria;
                }
            } else if (nomes.categoria_erp) {
                const destino = mapaCategorias.mapa.get(normalizarNomeColuna(nomes.categoria_erp));
                if (destino) {
                    const idCategoria = await resolverCategoria(destino.categoria, null);
                    dados.id_categoria = destino.subcategoria ? await resolverCategoria(destino.subcategoria, idCategoria) : idCategoria;
                } else {
                    // Sem mapa: o produto novo fica sem categoria (o existente mantém a atual) e nenhuma categoria é criada.
                    const atual = semMapa.get(nomes.categoria_erp) || { categoria_erp: nomes.categoria_erp, ocorrencias: 0 };
                    atual.ocorrencias += 1;
                    semMapa.set(nomes.categoria_erp, atual);
                }
            }
            if ('marca' in item.nomesTaxonomia) {
                dados.id_marca = await resolverTaxonomia(Marca, marcas, item.nomesTaxonomia.marca, transacao, contadorMarcas);
            }

            let produto = porSku.get(dados.sku.toUpperCase());
            let alterado = false;
            if (!produto) {
                if (somenteEstoque) {
                    registrarErros(item.linha, dados.sku, [{ campo: 'sku', mensagem: 'SKU não cadastrado. O arquivo de estoque não cria produtos.' }]);
                    continue;
                }
                if (!dados.nome) {
                    registrarErros(item.linha, dados.sku, [{ campo: 'nome', mensagem: 'Produto novo exige o nome.' }]);
                    continue;
                }
                produto = await Produto.create({
                    ...dados,
                    ...(item.nomeErp !== undefined && { nome_erp: item.nomeErp }),
                    quantidade_estoque: 0
                }, { transaction: transacao });
                porSku.set(dados.sku.toUpperCase(), produto);
                relatorio.criados += 1;
            } else {
                const { sku, ...campos } = dados;
                if (item.nomeErp !== undefined) campos.nome_erp = item.nomeErp;
                // O nome de exibição gerado só substitui o atual se este ainda for o gerado do nome do portfólio anterior
                // (ou seja, ninguém editou o nome à mão).
                if (item.nomeGerado && !(produto.nome_erp && gerarNomeExibicao(produto.nome_erp, dicionario).nome === produto.nome)) {
                    delete campos.nome;
                }
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

        relatorio.abreviacoes_pendentes = [...pendentes.values()].sort((a, b) => b.ocorrencias - a.ocorrencias || a.abreviacao.localeCompare(b.abreviacao));
        relatorio.categorias_sem_mapa = [...semMapa.values()].sort((a, b) => b.ocorrencias - a.ocorrencias || a.categoria_erp.localeCompare(b.categoria_erp));
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
