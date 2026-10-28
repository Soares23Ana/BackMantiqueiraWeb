const fs = require('node:fs/promises');
const path = require('node:path');
const { Op, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const sequelize = require('../db/conn');
const { Produto, Categoria, Marca, MovimentacaoEstoque, Usuario } = require('../models');
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');
const { ehEquipe } = require('../lib/perfis');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { escaparLike, termosDeBusca } = require('../lib/texto');
const { validarDadosProduto } = require('../helpers/validacaoProduto');
const { alterarEstoque, disponibilidade } = require('../servicos/estoque');
const { registrarEvento } = require('../servicos/eventos');

const PASTA_UPLOADS = path.join(__dirname, '..', 'publico', 'uploads');
const DISPONIBILIDADES = ['disponivel', 'ultimas_unidades', 'indisponivel', 'em_estoque'];
const ORDENACOES_PUBLICAS = ['relevancia', 'nome', 'nome_desc', 'recentes'];
const ORDENACOES_EQUIPE = [...ORDENACOES_PUBLICAS, 'estoque', 'estoque_desc'];

const INCLUDES = [
    { model: Categoria, as: 'categoria', attributes: ['id_categoria', 'nome', 'slug'] },
    { model: Marca, as: 'marca', attributes: ['id_marca', 'nome', 'slug'] }
];

// O que cada perfil vê: visitante não vê estoque exato; só a equipe vê preço e dados de gestão.
function apresentarProduto(produto, usuario) {
    const dados = {
        id_produto: produto.id_produto,
        sku: produto.sku,
        nome: produto.nome,
        descricao: produto.descricao,
        destaques: produto.destaques || [],
        imagem_url: produto.imagem_url,
        categoria: produto.categoria
            ? { id_categoria: produto.categoria.id_categoria, nome: produto.categoria.nome, slug: produto.categoria.slug }
            : null,
        marca: produto.marca
            ? { id_marca: produto.marca.id_marca, nome: produto.marca.nome, slug: produto.marca.slug }
            : null,
        multiplo_venda: produto.multiplo_venda,
        disponibilidade: disponibilidade(produto)
    };
    if (usuario) {
        dados.estoque = produto.quantidade_estoque;
    }
    if (ehEquipe(usuario)) {
        Object.assign(dados, {
            preco: produto.preco === null ? null : Number(produto.preco),
            estoque_minimo: produto.estoque_minimo,
            ativo: produto.ativo,
            id_fornecedor: produto.id_fornecedor,
            criado_em: produto.criado_em,
            atualizado_em: produto.atualizado_em
        });
    }
    return dados;
}

function listaDoParametro(valor) {
    if (valor === undefined || valor === '') return [];
    if (typeof valor !== 'string') {
        throw new ErroApi(400, 'FILTRO_INVALIDO', 'Os filtros devem ser texto (vários valores separados por vírgula).');
    }
    return valor.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

// "q" é apelido de "busca"; se vierem os dois, vale "busca".
function lerBusca(query) {
    const valor = query.busca !== undefined ? query.busca : query.q;
    return typeof valor === 'string' ? valor.trim() : '';
}

function lerFiltros(query, usuario) {
    const busca = lerBusca(query);
    if (busca.length > 100) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', 'A busca deve ter no máximo 100 caracteres.');
    }
    const disponibilidadeFiltro = query.disponibilidade || null;
    if (disponibilidadeFiltro && !DISPONIBILIDADES.includes(disponibilidadeFiltro)) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', `disponibilidade deve ser: ${DISPONIBILIDADES.join(', ')}.`);
    }
    const ordenacoes = ehEquipe(usuario) ? ORDENACOES_EQUIPE : ORDENACOES_PUBLICAS;
    const termos = termosDeBusca(busca);
    const ordenar = query.ordenar || (termos.length > 0 ? 'relevancia' : 'nome');
    if (!ordenacoes.includes(ordenar)) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', `ordenar deve ser: ${ordenacoes.join(', ')}.`);
    }
    // Apenas a equipe pode listar produtos desativados.
    const incluirInativos = ehEquipe(usuario) && query.incluir_inativos === 'true';
    return {
        termos,
        categorias: listaDoParametro(query.categoria),
        marcas: listaDoParametro(query.marca),
        disponibilidade: disponibilidadeFiltro,
        ordenar,
        incluirInativos
    };
}

const COL = (coluna) => `\`Produto\`.\`${coluna}\``;
const CONDICOES_DISPONIBILIDADE = {
    indisponivel: `${COL('quantidade_estoque')} < GREATEST(${COL('multiplo_venda')}, 1)`,
    em_estoque: `${COL('quantidade_estoque')} >= GREATEST(${COL('multiplo_venda')}, 1)`,
    ultimas_unidades: `${COL('quantidade_estoque')} >= GREATEST(${COL('multiplo_venda')}, 1) AND ${COL('quantidade_estoque')} <= ${COL('estoque_minimo')}`,
    disponivel: `${COL('quantidade_estoque')} >= GREATEST(${COL('multiplo_venda')}, 1) AND ${COL('quantidade_estoque')} > ${COL('estoque_minimo')}`
};

// Filtro por id ("3") ou slug ("higiene-e-beleza"); aceita vários separados por vírgula.
function condicaoTaxonomia(valores, coluna, associacao) {
    const ids = valores.filter((valor) => /^\d+$/.test(valor)).map(Number);
    const slugs = valores.filter((valor) => !/^\d+$/.test(valor));
    const opcoes = [];
    if (ids.length) opcoes.push({ [coluna]: { [Op.in]: ids } });
    if (slugs.length) opcoes.push({ [`$${associacao}.slug$`]: { [Op.in]: slugs } });
    return { [Op.or]: opcoes };
}

// Monta o WHERE. "ignorar" deixa um filtro de fora (usado nas contagens de /filtros).
function montarWhere(filtros, ignorar = null) {
    const condicoes = [];
    if (!filtros.incluirInativos) condicoes.push({ ativo: true });

    // Cada termo precisa aparecer em algum campo. A collation ai_ci ignora acentos e maiúsculas.
    for (const termo of filtros.termos) {
        const padrao = `%${escaparLike(termo)}%`;
        condicoes.push({
            [Op.or]: [
                { nome: { [Op.like]: padrao } },
                { sku: { [Op.like]: padrao } },
                { descricao: { [Op.like]: padrao } },
                { '$marca.nome$': { [Op.like]: padrao } },
                { '$categoria.nome$': { [Op.like]: padrao } }
            ]
        });
    }
    if (filtros.categorias.length && ignorar !== 'categoria') {
        condicoes.push(condicaoTaxonomia(filtros.categorias, 'id_categoria', 'categoria'));
    }
    if (filtros.marcas.length && ignorar !== 'marca') {
        condicoes.push(condicaoTaxonomia(filtros.marcas, 'id_marca', 'marca'));
    }
    if (filtros.disponibilidade && ignorar !== 'disponibilidade') {
        condicoes.push(sequelize.literal(CONDICOES_DISPONIBILIDADE[filtros.disponibilidade]));
    }
    return { [Op.and]: condicoes };
}

// Relevância: nome que começa com a busca, depois nome que contém todos os termos, depois o resto.
function ordemRelevancia(termos) {
    const inicio = sequelize.escape(`${escaparLike(termos.join(' '))}%`);
    const primeiro = sequelize.escape(`${escaparLike(termos[0])}%`);
    const todosNoNome = termos
        .map((termo) => `${COL('nome')} LIKE ${sequelize.escape(`%${escaparLike(termo)}%`)}`)
        .join(' AND ');
    return sequelize.literal(`CASE
        WHEN ${COL('nome')} LIKE ${inicio} THEN 0
        WHEN ${COL('nome')} LIKE ${primeiro} THEN 1
        WHEN ${todosNoNome} THEN 2
        ELSE 3 END`);
}

function montarOrdem(filtros) {
    switch (filtros.ordenar) {
        case 'relevancia':
            return filtros.termos.length > 0
                ? [[ordemRelevancia(filtros.termos), 'ASC'], ['nome', 'ASC']]
                : [['nome', 'ASC']];
        case 'nome_desc': return [['nome', 'DESC']];
        case 'recentes': return [['criado_em', 'DESC'], ['id_produto', 'DESC']];
        case 'estoque': return [['quantidade_estoque', 'ASC'], ['nome', 'ASC']];
        case 'estoque_desc': return [['quantidade_estoque', 'DESC'], ['nome', 'ASC']];
        default: return [['nome', 'ASC'], ['id_produto', 'ASC']];
    }
}

// GET /produtos (público): busca, filtros, ordenação e paginação.
async function listar(req, res) {
    const filtros = lerFiltros(req.query, req.usuario);
    const paginacao = lerPaginacao(req.query, { limitePadrao: 24, limiteMaximo: 100 });

    const { rows, count } = await Produto.findAndCountAll({
        where: montarWhere(filtros),
        include: INCLUDES,
        order: montarOrdem(filtros),
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    // Métrica de busca: só a primeira página (trocar de página não é nova busca) e não para a equipe.
    if (filtros.termos.length > 0 && paginacao.pagina === 1 && !ehEquipe(req.usuario)) {
        await registrarEvento({
            tipo: count > 0 ? 'busca' : 'busca_sem_resultado',
            termo: filtros.termos.join(' ').toLowerCase().slice(0, 100),
            resultados: count,
            id_usuario: req.usuario ? req.usuario.id : null
        });
    }
    return res.status(200).json({
        produtos: rows.map((produto) => apresentarProduto(produto, req.usuario)),
        paginacao: montarPaginacao(count, paginacao)
    });
}

// GET /produtos/sugestoes?busca= ou ?q= (autocomplete)
async function sugestoes(req, res) {
    const busca = lerBusca(req.query);
    const termos = termosDeBusca(busca.slice(0, 100));
    if (busca.length < 2 || termos.length === 0) {
        return res.status(200).json({ produtos: [], categorias: [], marcas: [] });
    }
    const padrao = `%${escaparLike(busca)}%`;
    const filtros = { termos, categorias: [], marcas: [], disponibilidade: null, incluirInativos: false };

    const [produtos, categorias, marcas] = await Promise.all([
        Produto.findAll({
            where: montarWhere(filtros),
            include: INCLUDES,
            order: montarOrdem({ ...filtros, ordenar: 'relevancia' }),
            limit: 8
        }),
        Categoria.findAll({
            where: { ativo: true, nome: { [Op.like]: padrao } },
            attributes: ['id_categoria', 'nome', 'slug'],
            order: [['nome', 'ASC']],
            limit: 3
        }),
        Marca.findAll({
            where: { ativo: true, nome: { [Op.like]: padrao } },
            attributes: ['id_marca', 'nome', 'slug'],
            order: [['nome', 'ASC']],
            limit: 3
        })
    ]);
    return res.status(200).json({
        produtos: produtos.map((produto) => ({
            id_produto: produto.id_produto,
            sku: produto.sku,
            nome: produto.nome,
            imagem_url: produto.imagem_url,
            marca: produto.marca ? produto.marca.nome : null
        })),
        categorias,
        marcas
    });
}

/**
 * GET /produtos/filtros: categorias, marcas e disponibilidade com contagem para os filtros da vitrine.
 * Cada contagem considera os outros filtros ativos (ex.: com uma marca escolhida, mostra quantos
 * produtos dessa marca existem em cada categoria).
 */
async function filtrosDisponiveis(req, res) {
    const filtros = lerFiltros(req.query, req.usuario);

    const contarPor = async (associacao, chave) => {
        const linhas = await Produto.findAll({
            where: montarWhere(filtros, associacao),
            include: INCLUDES.map((include) => ({ ...include, attributes: [] })),
            attributes: [
                [sequelize.col(`${associacao}.${chave}`), chave],
                [sequelize.col(`${associacao}.nome`), 'nome'],
                [sequelize.col(`${associacao}.slug`), 'slug'],
                [sequelize.fn('COUNT', sequelize.col('Produto.id_produto')), 'total']
            ],
            group: [`${associacao}.${chave}`, `${associacao}.nome`, `${associacao}.slug`],
            raw: true
        });
        return linhas
            .filter((linha) => linha[chave] !== null)
            .map((linha) => ({ ...linha, total: Number(linha.total) }))
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    };

    const somaDisponibilidade = (estado) => sequelize.literal(`SUM(CASE WHEN ${CONDICOES_DISPONIBILIDADE[estado]} THEN 1 ELSE 0 END)`);
    const [categorias, marcas, [totais]] = await Promise.all([
        contarPor('categoria', 'id_categoria'),
        contarPor('marca', 'id_marca'),
        Produto.findAll({
            where: montarWhere(filtros, 'disponibilidade'),
            include: INCLUDES.map((include) => ({ ...include, attributes: [] })),
            attributes: [
                [somaDisponibilidade('disponivel'), 'disponivel'],
                [somaDisponibilidade('ultimas_unidades'), 'ultimas_unidades'],
                [somaDisponibilidade('indisponivel'), 'indisponivel']
            ],
            raw: true
        })
    ]);
    const disponibilidadeContagem = Object.fromEntries(
        ['disponivel', 'ultimas_unidades', 'indisponivel'].map((estado) => [estado, Number(totais[estado] || 0)])
    );
    disponibilidadeContagem.em_estoque = disponibilidadeContagem.disponivel + disponibilidadeContagem.ultimas_unidades;

    return res.status(200).json({ categorias, marcas, disponibilidade: disponibilidadeContagem });
}

// Aceita o id numérico ou o SKU.
async function buscarProduto(idOuSku, opcoes = {}) {
    const where = /^\d+$/.test(String(idOuSku)) ? { id_produto: Number(idOuSku) } : { sku: String(idOuSku) };
    return Produto.findOne({ where, include: INCLUDES, ...opcoes });
}

// GET /produtos/:id (id ou SKU). Produto desativado só aparece para a equipe.
async function obter(req, res) {
    const produto = await buscarProduto(req.params.id);
    if (!produto || (!produto.ativo && !ehEquipe(req.usuario))) {
        throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
    }
    return res.status(200).json({ produto: apresentarProduto(produto, req.usuario) });
}

async function validarReferencias(dados, transacao) {
    const verificacoes = [
        ['id_categoria', Categoria, 'Categoria não encontrada.'],
        ['id_marca', Marca, 'Marca não encontrada.']
    ];
    const erros = [];
    for (const [campo, Modelo, mensagem] of verificacoes) {
        if (dados[campo] && !(await Modelo.findByPk(dados[campo], { transaction: transacao }))) {
            erros.push({ campo, mensagem });
        }
    }
    if (erros.length > 0) {
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }
}

function tratarErroDeGravacao(erro) {
    if (erro instanceof UniqueConstraintError) {
        throw new ErroApi(409, 'SKU_DUPLICADO', 'Já existe um produto com este SKU.', [{ campo: 'sku', mensagem: 'SKU já cadastrado.' }]);
    }
    if (erro instanceof ForeignKeyConstraintError) {
        throw new ErroApi(422, 'VALIDACAO', 'Fornecedor, categoria ou marca inexistente.');
    }
    throw erro;
}

// POST /produtos (gestão). Aceita quantidade_estoque inicial, registrada como movimentação.
async function cadastrar(req, res) {
    const dados = validarDadosProduto(req.body, { permitirEstoque: true });
    const { quantidade_estoque: estoqueInicial = 0, ...campos } = dados;

    try {
        const produto = await sequelize.transaction(async (transacao) => {
            await validarReferencias(campos, transacao);
            const novo = await Produto.create({ ...campos, quantidade_estoque: 0 }, { transaction: transacao });
            await alterarEstoque(novo, estoqueInicial, {
                tipo: 'ajuste',
                observacao: 'Estoque inicial no cadastro do produto.',
                idUsuario: req.usuario.id,
                transacao
            });
            return novo;
        });
        const completo = await buscarProduto(produto.id_produto);
        return res.status(201).json({
            mensagem: 'Produto cadastrado com sucesso.',
            id_produto: produto.id_produto,
            produto: apresentarProduto(completo, req.usuario)
        });
    } catch (erro) {
        return tratarErroDeGravacao(erro);
    }
}

// PUT (substitui todos os campos editáveis) e PATCH (só os enviados) em /produtos/:id.
function atualizar({ parcial }) {
    return async (req, res) => {
        const dados = validarDadosProduto(req.body, { parcial });
        let idProduto;
        try {
            await sequelize.transaction(async (transacao) => {
                const produto = await buscarProduto(req.params.id, { transaction: transacao, lock: transacao.LOCK.UPDATE });
                if (!produto) {
                    throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
                }
                await validarReferencias(dados, transacao);
                // No PUT, campos opcionais omitidos voltam ao padrão.
                const valores = parcial ? dados : {
                    descricao: null,
                    destaques: null,
                    imagem_url: null,
                    id_categoria: null,
                    id_marca: null,
                    id_fornecedor: null,
                    preco: null,
                    estoque_minimo: 10,
                    multiplo_venda: 1,
                    ativo: true,
                    ...dados
                };
                await produto.update(valores, { transaction: transacao });
                idProduto = produto.id_produto;
            });
        } catch (erro) {
            tratarErroDeGravacao(erro);
        }
        const produto = await buscarProduto(idProduto);
        return res.status(200).json({ mensagem: 'Produto atualizado.', produto: apresentarProduto(produto, req.usuario) });
    };
}

/**
 * PATCH /produtos/:id/estoque. Envie { quantidade: N } para definir o valor
 * ou { ajuste: +N/-N } para somar/subtrair, sempre com { observacao }.
 */
async function ajustarEstoque(req, res) {
    const corpo = req.body || {};
    const erros = [];
    const temQuantidade = corpo.quantidade !== undefined;
    const temAjuste = corpo.ajuste !== undefined;
    if (temQuantidade === temAjuste) {
        erros.push({ campo: 'quantidade', mensagem: 'Informe "quantidade" (novo valor) ou "ajuste" (variação), apenas um deles.' });
    }
    if (temQuantidade && (!Number.isSafeInteger(corpo.quantidade) || corpo.quantidade < 0)) {
        erros.push({ campo: 'quantidade', mensagem: 'A quantidade deve ser um inteiro maior ou igual a zero.' });
    }
    if (temAjuste && (!Number.isSafeInteger(corpo.ajuste) || corpo.ajuste === 0)) {
        erros.push({ campo: 'ajuste', mensagem: 'O ajuste deve ser um inteiro diferente de zero.' });
    }
    const observacao = typeof corpo.observacao === 'string' ? corpo.observacao.trim() : '';
    if (observacao.length < 3 || observacao.length > 500) {
        erros.push({ campo: 'observacao', mensagem: 'A observação é obrigatória (3 a 500 caracteres).' });
    }
    const extras = Object.keys(corpo).filter((campo) => !['quantidade', 'ajuste', 'observacao'].includes(campo));
    if (extras.length > 0) {
        erros.push({ campo: extras[0], mensagem: `Campo não permitido: ${extras[0]}.` });
    }
    if (erros.length > 0) {
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }

    const resultado = await sequelize.transaction(async (transacao) => {
        const produto = await buscarProduto(req.params.id, { transaction: transacao, lock: transacao.LOCK.UPDATE });
        if (!produto) {
            throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
        }
        const novoEstoque = temQuantidade ? corpo.quantidade : produto.quantidade_estoque + corpo.ajuste;
        const movimentacao = await alterarEstoque(produto, novoEstoque, {
            tipo: 'ajuste',
            observacao,
            idUsuario: req.usuario.id,
            transacao
        });
        return { produto, movimentacao };
    });

    return res.status(200).json({
        mensagem: resultado.movimentacao ? 'Estoque atualizado.' : 'O estoque já estava com esse valor.',
        produto: apresentarProduto(resultado.produto, req.usuario),
        movimentacao: resultado.movimentacao
    });
}

// GET /produtos/:id/movimentacoes (equipe): histórico de estoque, mais recente primeiro.
async function listarMovimentacoes(req, res) {
    const produto = await buscarProduto(req.params.id);
    if (!produto) {
        throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
    }
    const paginacao = lerPaginacao(req.query, { limitePadrao: 50, limiteMaximo: 200 });
    const { rows, count } = await MovimentacaoEstoque.findAndCountAll({
        where: { id_produto: produto.id_produto },
        include: [{ model: Usuario, as: 'usuario', attributes: ['id_usuario', 'nome'] }],
        order: [['criado_em', 'DESC'], ['id_movimentacao', 'DESC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    return res.status(200).json({ movimentacoes: rows, paginacao: montarPaginacao(count, paginacao) });
}

// DELETE /produtos/:id: desativação (soft delete). Para reativar, PATCH { "ativo": true }.
async function desativar(req, res) {
    const produto = await buscarProduto(req.params.id);
    if (!produto) {
        throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
    }
    if (produto.ativo) {
        await produto.update({ ativo: false });
    }
    return res.status(200).json({ mensagem: 'Produto desativado.', produto: apresentarProduto(produto, req.usuario) });
}

async function removerArquivo(caminho) {
    try {
        await fs.unlink(caminho);
    } catch (erro) {
        if (erro.code !== 'ENOENT') logger.error('Erro ao remover imagem de produto.', { erro });
    }
}

// POST /produtos/:id/imagem (multipart, campo "imagem"). Substitui a imagem e apaga o upload anterior.
async function enviarImagem(req, res) {
    if (!req.file) {
        throw new ErroApi(422, 'VALIDACAO', 'O arquivo de imagem é obrigatório (campo "imagem").');
    }
    const produto = await buscarProduto(req.params.id);
    if (!produto) {
        await removerArquivo(req.file.path);
        throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
    }
    const anterior = produto.imagem_url;
    try {
        await produto.update({ imagem_url: `/arquivos/uploads/${req.file.filename}` });
    } catch (erro) {
        await removerArquivo(req.file.path);
        throw erro;
    }
    // Só apaga arquivos gerados pelo upload (nome UUID); imagens do front (/img/...) não ficam no servidor.
    // O padrão estrito impede que um imagem_url com ".." apague arquivos fora da pasta de uploads.
    const upload = anterior && anterior.match(/^\/arquivos\/uploads\/([0-9a-f-]{36}\.(?:jpg|png|webp|gif))$/);
    if (upload) {
        await removerArquivo(path.join(PASTA_UPLOADS, upload[1]));
    }
    return res.status(200).json({ mensagem: 'Imagem atualizada.', produto: apresentarProduto(produto, req.usuario) });
}

module.exports = {
    listar,
    sugestoes,
    filtrosDisponiveis,
    obter,
    cadastrar,
    atualizarCompleto: atualizar({ parcial: false }),
    atualizarParcial: atualizar({ parcial: true }),
    ajustarEstoque,
    listarMovimentacoes,
    desativar,
    enviarImagem,
    apresentarProduto
};
