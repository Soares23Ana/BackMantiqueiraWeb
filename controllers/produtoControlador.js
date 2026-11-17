const { Op, UniqueConstraintError, ForeignKeyConstraintError } = require('sequelize');
const sequelize = require('../db/conn');
const { Produto, Categoria, Marca, MovimentacaoEstoque, Usuario } = require('../models');
const { removerArquivo } = require('../lib/uploads');
const { aplicarImagensEmLote } = require('../servicos/imagensEmLote');
const { aplicarImagemProduto } = require('../servicos/imagemProduto');
const { baixarImagem, urlParaAuditoria } = require('../servicos/baixarImagem');
const { ErroApi } = require('../lib/erros');
const { ehEquipe } = require('../lib/perfis');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { escaparLike, termosDeBusca } = require('../lib/texto');
const { validarDadosProduto } = require('../helpers/validacaoProduto');
const { alterarEstoque, disponibilidade, faixaEstoque, lerLimiteFaixa } = require('../servicos/estoque');
const { registrarEvento } = require('../servicos/eventos');
const { registrarAuditoria, instantaneo } = require('../servicos/auditoria');

const DISPONIBILIDADES = ['disponivel', 'ultimas_unidades', 'indisponivel', 'em_estoque'];
const ORDENACOES_PUBLICAS = ['relevancia', 'nome', 'nome_desc', 'recentes'];
const ORDENACOES_EQUIPE = [...ORDENACOES_PUBLICAS, 'estoque', 'estoque_desc'];

// Campos do produto que vão para a auditoria (sem preço).
const CAMPOS_AUDITORIA = ['sku', 'nome', 'descricao', 'destaques', 'imagem_url', 'id_categoria', 'id_marca', 'id_fornecedor',
    'estoque_minimo', 'multiplo_venda', 'ativo'];

// O produto aponta para a subcategoria quando houver, senão para a categoria; o "pai" resolve o nível principal.
const INCLUDE_CATEGORIA = {
    model: Categoria,
    as: 'categoria',
    attributes: ['id_categoria', 'nome', 'slug', 'id_pai'],
    include: [{ model: Categoria, as: 'pai', attributes: ['id_categoria', 'nome', 'slug'] }]
};
const INCLUDES = [
    INCLUDE_CATEGORIA,
    { model: Marca, as: 'marca', attributes: ['id_marca', 'nome', 'slug'] }
];
// Mesmos joins, sem colunas: para as consultas de contagem (GROUP BY) dos filtros.
const INCLUDES_CONTAGEM = [
    { model: Categoria, as: 'categoria', attributes: [], include: [{ model: Categoria, as: 'pai', attributes: [] }] },
    { model: Marca, as: 'marca', attributes: [] }
];

const resumoCategoria = (categoria) => ({ id_categoria: categoria.id_categoria, nome: categoria.nome, slug: categoria.slug });

// "categoria" é sempre o nível principal e "subcategoria" o segundo nível (ou null).
function separarCategorias(categoria) {
    if (!categoria) return { categoria: null, subcategoria: null };
    if (categoria.pai) return { categoria: resumoCategoria(categoria.pai), subcategoria: resumoCategoria(categoria) };
    return { categoria: resumoCategoria(categoria), subcategoria: null };
}

// O que cada perfil vê: só a equipe vê o estoque exato, o preço e os dados de gestão.
// Visitante e cliente recebem a disponibilidade e a faixa de estoque (limiteFaixa vem de lerLimiteFaixa()).
function apresentarProduto(produto, usuario, limiteFaixa) {
    const dados = {
        id_produto: produto.id_produto,
        sku: produto.sku,
        nome: produto.nome,
        descricao: produto.descricao,
        destaques: produto.destaques || [],
        imagem_url: produto.imagem_url,
        ...separarCategorias(produto.categoria),
        marca: produto.marca
            ? { id_marca: produto.marca.id_marca, nome: produto.marca.nome, slug: produto.marca.slug }
            : null,
        multiplo_venda: produto.multiplo_venda,
        disponibilidade: disponibilidade(produto),
        faixa_estoque: faixaEstoque(produto, limiteFaixa)
    };
    if (ehEquipe(usuario)) {
        Object.assign(dados, {
            estoque: produto.quantidade_estoque,
            nome_erp: produto.nome_erp,
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

// ?campanha={slug}: um único slug.
function lerCampanha(valor) {
    if (valor === undefined || valor === '') return null;
    if (typeof valor !== 'string' || valor.length > 140) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', 'campanha deve ser o slug de uma campanha.');
    }
    return valor.trim();
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
        subcategorias: listaDoParametro(query.subcategoria),
        marcas: listaDoParametro(query.marca),
        campanha: lerCampanha(query.campanha),
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

// ?categoria=: o produto da categoria ou de qualquer subcategoria dela (por id ou slug).
function condicaoCategorias(valores) {
    const ids = valores.filter((valor) => /^\d+$/.test(valor)).map(Number);
    const slugs = valores.filter((valor) => !/^\d+$/.test(valor));
    const opcoes = [];
    if (ids.length) opcoes.push({ id_categoria: { [Op.in]: ids } }, { '$categoria.id_pai$': { [Op.in]: ids } });
    if (slugs.length) opcoes.push({ '$categoria.slug$': { [Op.in]: slugs } }, { '$categoria.pai.slug$': { [Op.in]: slugs } });
    return { [Op.or]: opcoes };
}

// ?subcategoria=: só produtos da subcategoria informada (segundo nível).
function condicaoSubcategorias(valores) {
    const ids = valores.filter((valor) => /^\d+$/.test(valor)).map(Number);
    const slugs = valores.filter((valor) => !/^\d+$/.test(valor));
    const opcoes = [];
    if (ids.length) opcoes.push({ id_categoria: { [Op.in]: ids } });
    if (slugs.length) opcoes.push({ '$categoria.slug$': { [Op.in]: slugs } });
    return { [Op.and]: [{ [Op.or]: opcoes }, { '$categoria.id_pai$': { [Op.ne]: null } }] };
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
                { '$categoria.nome$': { [Op.like]: padrao } },
                { '$categoria.pai.nome$': { [Op.like]: padrao } }
            ]
        });
    }
    if (filtros.categorias.length && ignorar !== 'categoria') {
        condicoes.push(condicaoCategorias(filtros.categorias));
    }
    if (filtros.subcategorias.length && ignorar !== 'categoria') {
        condicoes.push(condicaoSubcategorias(filtros.subcategorias));
    }
    if (filtros.marcas.length && ignorar !== 'marca') {
        condicoes.push(condicaoTaxonomia(filtros.marcas, 'id_marca', 'marca'));
    }
    if (filtros.campanha && ignorar !== 'campanha') {
        // Só campanhas ativas (dentro do período); slug desconhecido ou encerrado não lista nada.
        const agora = sequelize.escape(new Date());
        condicoes.push(sequelize.literal(`${COL('id_produto')} IN (
            SELECT cp.id_produto FROM campanhas_produtos cp JOIN campanhas c ON c.id_campanha = cp.id_campanha
            WHERE c.slug = ${sequelize.escape(filtros.campanha)} AND c.inicio_em <= ${agora} AND c.fim_em > ${agora})`));
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

    const limiteFaixa = await lerLimiteFaixa();
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
        produtos: rows.map((produto) => apresentarProduto(produto, req.usuario, limiteFaixa)),
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
    const filtros = { termos, categorias: [], subcategorias: [], marcas: [], campanha: null, disponibilidade: null, incluirInativos: false };

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
            include: INCLUDES_CONTAGEM,
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

    // Árvore de categorias: cada principal traz o total (dela e das subcategorias) e a lista de subcategorias.
    const contarCategorias = async () => {
        const linhas = await Produto.findAll({
            where: montarWhere(filtros, 'categoria'),
            include: INCLUDES_CONTAGEM,
            attributes: [
                [sequelize.col('categoria.id_categoria'), 'id_categoria'],
                [sequelize.col('categoria.nome'), 'nome'],
                [sequelize.col('categoria.slug'), 'slug'],
                [sequelize.col('categoria.id_pai'), 'id_pai'],
                [sequelize.col('categoria->pai.nome'), 'pai_nome'],
                [sequelize.col('categoria->pai.slug'), 'pai_slug'],
                [sequelize.fn('COUNT', sequelize.col('Produto.id_produto')), 'total']
            ],
            group: ['categoria.id_categoria', 'categoria.nome', 'categoria.slug', 'categoria.id_pai', 'categoria->pai.nome', 'categoria->pai.slug'],
            raw: true
        });
        const principais = new Map();
        const principal = (id, nome, slug) => {
            if (!principais.has(id)) principais.set(id, { id_categoria: id, nome, slug, total: 0, subcategorias: [] });
            return principais.get(id);
        };
        for (const linha of linhas) {
            if (linha.id_categoria === null) continue;
            const total = Number(linha.total);
            if (linha.id_pai === null) {
                principal(linha.id_categoria, linha.nome, linha.slug).total += total;
            } else {
                const pai = principal(linha.id_pai, linha.pai_nome, linha.pai_slug);
                pai.total += total;
                pai.subcategorias.push({ id_categoria: linha.id_categoria, nome: linha.nome, slug: linha.slug, total });
            }
        }
        const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
        return [...principais.values()].sort(porNome).map((item) => ({ ...item, subcategorias: item.subcategorias.sort(porNome) }));
    };

    const somaDisponibilidade = (estado) => sequelize.literal(`SUM(CASE WHEN ${CONDICOES_DISPONIBILIDADE[estado]} THEN 1 ELSE 0 END)`);
    const [categorias, marcas, [totais]] = await Promise.all([
        contarCategorias(),
        contarPor('marca', 'id_marca'),
        Produto.findAll({
            where: montarWhere(filtros, 'disponibilidade'),
            include: INCLUDES_CONTAGEM,
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

// Aceita o id numérico ou o SKU. SKU só com dígitos (o código do portfólio, ex.: 1391) também é aceito: o número é
// procurado primeiro como id e, se não houver produto com esse id, como SKU.
async function buscarProduto(idOuSku, opcoes = {}) {
    const valor = String(idOuSku);
    if (/^\d+$/.test(valor)) {
        const porId = await Produto.findOne({ where: { id_produto: Number(valor) }, include: INCLUDES, ...opcoes });
        if (porId) return porId;
    }
    return Produto.findOne({ where: { sku: valor }, include: INCLUDES, ...opcoes });
}

// GET /produtos/:id (id ou SKU). Produto desativado só aparece para a equipe.
async function obter(req, res) {
    const produto = await buscarProduto(req.params.id);
    if (!produto || (!produto.ativo && !ehEquipe(req.usuario))) {
        throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
    }
    return res.status(200).json({ produto: apresentarProduto(produto, req.usuario, await lerLimiteFaixa()) });
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
        await registrarAuditoria({
            usuario: req.usuario,
            acao: 'produto.criar',
            entidade: 'produto',
            idEntidade: produto.id_produto,
            depois: { ...instantaneo(completo, CAMPOS_AUDITORIA), quantidade_estoque: completo.quantidade_estoque }
        });
        return res.status(201).json({
            mensagem: 'Produto cadastrado com sucesso.',
            id_produto: produto.id_produto,
            produto: apresentarProduto(completo, req.usuario, await lerLimiteFaixa())
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
        let antes;
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
                antes = instantaneo(produto, CAMPOS_AUDITORIA);
                await produto.update(valores, { transaction: transacao });
                idProduto = produto.id_produto;
            });
        } catch (erro) {
            tratarErroDeGravacao(erro);
        }
        const produto = await buscarProduto(idProduto);
        const depois = instantaneo(produto, CAMPOS_AUDITORIA);
        const soAtivo = antes.ativo !== depois.ativo && Object.keys(depois).every((campo) => campo === 'ativo' || JSON.stringify(antes[campo]) === JSON.stringify(depois[campo]));
        await registrarAuditoria({
            usuario: req.usuario,
            acao: soAtivo ? (depois.ativo ? 'produto.ativar' : 'produto.desativar') : 'produto.editar',
            entidade: 'produto',
            idEntidade: idProduto,
            antes,
            depois
        });
        return res.status(200).json({ mensagem: 'Produto atualizado.', produto: apresentarProduto(produto, req.usuario, await lerLimiteFaixa()) });
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

    if (resultado.movimentacao) {
        await registrarAuditoria({
            usuario: req.usuario,
            acao: 'produto.estoque',
            entidade: 'produto',
            idEntidade: resultado.produto.id_produto,
            antes: { quantidade_estoque: resultado.movimentacao.estoque_anterior },
            depois: { quantidade_estoque: resultado.movimentacao.estoque_novo },
            detalhe: { observacao }
        });
    }
    return res.status(200).json({
        mensagem: resultado.movimentacao ? 'Estoque atualizado.' : 'O estoque já estava com esse valor.',
        produto: apresentarProduto(resultado.produto, req.usuario, await lerLimiteFaixa()),
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
        await registrarAuditoria({
            usuario: req.usuario,
            acao: 'produto.desativar',
            entidade: 'produto',
            idEntidade: produto.id_produto,
            antes: { ativo: true },
            depois: { ativo: false }
        });
    }
    return res.status(200).json({ mensagem: 'Produto desativado.', produto: apresentarProduto(produto, req.usuario, await lerLimiteFaixa()) });
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
    await aplicarImagemProduto({ produto, nomeArquivo: req.file.filename, usuario: req.usuario });
    return res.status(200).json({ mensagem: 'Imagem atualizada.', produto: apresentarProduto(produto, req.usuario, await lerLimiteFaixa()) });
}

// POST /produtos/imagens/lote (equipe, multipart: "arquivo" = .zip, "substituir" = sim|nao). O nome de cada foto, sem a
// extensão, é o SKU do produto no banco. Devolve o relatório do que foi aplicado e do que foi ignorado.
async function enviarImagensEmLote(req, res) {
    if (!req.file) {
        throw new ErroApi(422, 'VALIDACAO', 'O arquivo .zip é obrigatório (campo "arquivo").');
    }
    const bruto = req.body && req.body.substituir;
    const texto = bruto === undefined || bruto === '' ? 'nao' : String(bruto).trim().toLowerCase();
    if (!['sim', 'nao'].includes(texto)) {
        throw new ErroApi(422, 'VALIDACAO', 'substituir deve ser "sim" ou "nao".');
    }
    const relatorio = await aplicarImagensEmLote({ caminhoZip: req.file.path, substituir: texto === 'sim', usuario: req.usuario });
    return res.status(200).json({ mensagem: 'Envio em lote concluído.', relatorio });
}

// POST /produtos/:id/imagem/link { url } (equipe). O servidor baixa a imagem, valida e guarda uma cópia em UPLOADS_DIR,
// com a mesma substituição, auditoria e exclusão da imagem anterior do upload comum.
async function enviarImagemPorLink(req, res) {
    const produto = await buscarProduto(req.params.id);
    if (!produto) {
        throw new ErroApi(404, 'PRODUTO_NAO_ENCONTRADO', 'Produto não encontrado.');
    }
    const url = req.body && req.body.url;
    const baixada = await baixarImagem(url);
    await aplicarImagemProduto({
        produto,
        nomeArquivo: baixada.nomeArquivo,
        usuario: req.usuario,
        // Só o endereço sem query string: links assinados podem conter tokens.
        detalhe: { origem_url: urlParaAuditoria(url) }
    });
    return res.status(200).json({ mensagem: 'Imagem atualizada.', produto: apresentarProduto(produto, req.usuario, await lerLimiteFaixa()) });
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
    enviarImagemPorLink,
    enviarImagensEmLote,
    apresentarProduto,
    INCLUDES
};
