const { UniqueConstraintError } = require('sequelize');
const sequelize = require('../db/conn');
const { Produto } = require('../models');
const { ErroApi } = require('../lib/erros');
const { ehEquipe } = require('../lib/perfis');
const { gerarSlug } = require('../lib/texto');

/**
 * Categorias e marcas têm o mesmo comportamento: nome, slug (gerado do nome), ativo e, nas categorias, ordem.
 * Esta fábrica cria os controladores para os dois modelos.
 */
function criarControladorTaxonomia(Modelo, { rotulo, artigo, chave: chaveResposta, comOrdem = false, comHierarquia = false }) {
    const chave = Modelo.primaryKeyAttribute;
    const campos = [...(comOrdem ? ['nome', 'slug', 'ordem', 'ativo'] : ['nome', 'slug', 'ativo']), ...(comHierarquia ? ['id_pai'] : [])];
    const naoEncontrado = () => new ErroApi(404, 'NAO_ENCONTRADO', `${rotulo} não encontrad${artigo}.`);

    function validar(corpo, { parcial }) {
        if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
            throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'O corpo da requisição deve ser um objeto.');
        }
        const erros = [];
        const dados = {};
        for (const campo of Object.keys(corpo)) {
            if (!campos.includes(campo)) erros.push({ campo, mensagem: `Campo não permitido: ${campo}.` });
        }
        if (!parcial || corpo.nome !== undefined) {
            const nome = typeof corpo.nome === 'string' ? corpo.nome.trim() : '';
            if (!nome || nome.length > 100) {
                erros.push({ campo: 'nome', mensagem: 'O nome é obrigatório (até 100 caracteres).' });
            }
            dados.nome = nome;
        }
        if (corpo.slug !== undefined) {
            const slug = typeof corpo.slug === 'string' ? gerarSlug(corpo.slug) : '';
            if (!slug) erros.push({ campo: 'slug', mensagem: 'Slug inválido.' });
            dados.slug = slug;
        } else if (!parcial && dados.nome) {
            dados.slug = gerarSlug(dados.nome);
            if (!dados.slug) erros.push({ campo: 'nome', mensagem: 'O nome precisa ter letras ou números.' });
        }
        if (comOrdem && corpo.ordem !== undefined) {
            if (!Number.isSafeInteger(corpo.ordem)) erros.push({ campo: 'ordem', mensagem: 'A ordem deve ser um número inteiro.' });
            dados.ordem = corpo.ordem;
        }
        if (comHierarquia && corpo.id_pai !== undefined) {
            if (corpo.id_pai !== null && (!Number.isSafeInteger(corpo.id_pai) || corpo.id_pai <= 0)) {
                erros.push({ campo: 'id_pai', mensagem: 'O id_pai deve ser o id de uma categoria principal ou null.' });
            }
            dados.id_pai = corpo.id_pai;
        }
        if (corpo.ativo !== undefined) {
            if (typeof corpo.ativo !== 'boolean') erros.push({ campo: 'ativo', mensagem: 'O campo ativo deve ser true ou false.' });
            dados.ativo = corpo.ativo;
        }
        if (parcial && Object.keys(corpo).length === 0) {
            erros.push({ campo: null, mensagem: 'Informe ao menos um campo para atualizar.' });
        }
        if (erros.length > 0) throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
        return dados;
    }

    async function gravar(acao) {
        try {
            return await acao();
        } catch (erro) {
            if (erro instanceof UniqueConstraintError) {
                if (comHierarquia && String(erro.parent && erro.parent.sqlMessage).includes('uk_categorias_pai_nome')) {
                    throw new ErroApi(409, 'NOME_DUPLICADO', 'Já existe uma categoria com este nome neste nível (mesmo pai).',
                        [{ campo: 'nome', mensagem: 'Nome já cadastrado neste nível.' }]);
                }
                throw new ErroApi(409, 'SLUG_DUPLICADO', `Já existe ${artigo === 'a' ? 'uma' : 'um'} ${rotulo.toLowerCase()} com este slug.`,
                    [{ campo: 'slug', mensagem: 'Slug já cadastrado.' }]);
            }
            throw erro;
        }
    }

    // GET /: lista com o total de produtos ativos. A equipe pode pedir ?incluir_inativos=true.
    async function listar(req, res) {
        const incluirInativos = ehEquipe(req.usuario) && req.query.incluir_inativos === 'true';
        const tabela = Modelo.getTableName();
        const registros = await Modelo.findAll({
            where: incluirInativos ? {} : { ativo: true },
            attributes: {
                include: [[
                    sequelize.literal(`(SELECT COUNT(*) FROM produtos p WHERE p.${chave} = \`${Modelo.name}\`.${chave} AND p.ativo = TRUE)`),
                    'total_produtos'
                ]]
            },
            order: comOrdem ? [['ordem', 'ASC'], ['nome', 'ASC']] : [['nome', 'ASC']]
        });
        if (!comHierarquia || req.query.plano === 'true') {
            return res.status(200).json({ [tabela]: registros });
        }
        // Árvore: categorias principais com as subcategorias dentro; o total da principal soma as subcategorias.
        const itens = registros.map((registro) => ({ ...registro.toJSON(), total_produtos: Number(registro.get('total_produtos')) }));
        const filhas = new Map();
        for (const item of itens.filter((categoria) => categoria.id_pai !== null)) {
            filhas.set(item.id_pai, [...(filhas.get(item.id_pai) || []), item]);
        }
        const principais = itens.filter((categoria) => categoria.id_pai === null).map((categoria) => {
            const subcategorias = filhas.get(categoria.id_categoria) || [];
            return {
                ...categoria,
                total_produtos: categoria.total_produtos + subcategorias.reduce((soma, sub) => soma + sub.total_produtos, 0),
                subcategorias
            };
        });
        return res.status(200).json({ [tabela]: principais });
    }

    // Categoria pai: precisa existir, ser principal (só há 2 níveis) e a categoria com subcategorias não vira subcategoria.
    async function validarPai(idPai, registroAtual) {
        if (idPai === null || idPai === undefined) return;
        const erro = (mensagem) => new ErroApi(422, 'VALIDACAO', mensagem, [{ campo: 'id_pai', mensagem }]);
        if (registroAtual && Number(registroAtual[chave]) === idPai) throw erro('Uma categoria não pode ser pai dela mesma.');
        const pai = await Modelo.findByPk(idPai);
        if (!pai) throw erro('Categoria pai não encontrada.');
        if (pai.id_pai !== null) throw erro('Só há dois níveis: a categoria pai precisa ser uma categoria principal.');
        if (registroAtual && await Modelo.count({ where: { id_pai: registroAtual[chave] } }) > 0) {
            throw erro('Esta categoria tem subcategorias e não pode virar subcategoria.');
        }
    }

    // Slug gerado do nome; em colisão (o slug é único no geral), tenta "pai-nome" e depois um número.
    async function slugUnico(nome, idPai) {
        const base = gerarSlug(nome);
        const candidatos = [base];
        if (idPai) {
            const pai = await Modelo.findByPk(idPai);
            if (pai) candidatos.push(`${pai.slug}-${base}`.slice(0, 120));
        }
        for (const candidato of candidatos) {
            if (!(await Modelo.findOne({ where: { slug: candidato }, attributes: [chave] }))) return candidato;
        }
        for (let n = 2; ; n += 1) {
            const candidato = `${candidatos[candidatos.length - 1].slice(0, 115)}-${n}`;
            if (!(await Modelo.findOne({ where: { slug: candidato }, attributes: [chave] }))) return candidato;
        }
    }

    async function criar(req, res) {
        const dados = validar(req.body, { parcial: false });
        if (comHierarquia) {
            await validarPai(dados.id_pai);
            // Sem slug informado, subcategorias com o mesmo nome em pais diferentes ganham slugs distintos.
            if (req.body.slug === undefined) dados.slug = await slugUnico(dados.nome, dados.id_pai);
        }
        const registro = await gravar(() => Modelo.create(dados));
        return res.status(201).json({ mensagem: `${rotulo} criad${artigo}.`, [chaveResposta]: registro });
    }

    async function atualizar(req, res) {
        const registro = await Modelo.findByPk(req.params.id);
        if (!registro) throw naoEncontrado();
        const dados = validar(req.body, { parcial: true });
        if (comHierarquia && dados.id_pai !== undefined) await validarPai(dados.id_pai, registro);
        await gravar(() => registro.update(dados));
        return res.status(200).json({ mensagem: `${rotulo} atualizad${artigo}.`, [chaveResposta]: registro });
    }

    // Só exclui se nenhum produto usar; caso contrário, sugere desativar.
    async function excluir(req, res) {
        const registro = await Modelo.findByPk(req.params.id);
        if (!registro) throw naoEncontrado();
        if (comHierarquia) {
            const subcategorias = await Modelo.count({ where: { id_pai: registro[chave] } });
            if (subcategorias > 0) {
                throw new ErroApi(409, 'EM_USO', `Esta categoria tem ${subcategorias} subcategoria(s). Exclua ou mova as subcategorias antes.`, { subcategorias });
            }
        }
        const emUso = await Produto.count({ where: { [chave]: registro[chave] } });
        if (emUso > 0) {
            throw new ErroApi(409, 'EM_USO',
                `Est${artigo === 'a' ? 'a' : 'e'} ${rotulo.toLowerCase()} tem ${emUso} produto(s). Desative com PATCH { "ativo": false }.`,
                { produtos: emUso });
        }
        await registro.destroy();
        return res.status(200).json({ mensagem: `${rotulo} excluíd${artigo}.` });
    }

    return { listar, criar, atualizar, excluir };
}

module.exports = { criarControladorTaxonomia };
