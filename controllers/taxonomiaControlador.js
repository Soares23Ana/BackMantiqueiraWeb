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
function criarControladorTaxonomia(Modelo, { rotulo, artigo, chave: chaveResposta, comOrdem = false }) {
    const chave = Modelo.primaryKeyAttribute;
    const campos = comOrdem ? ['nome', 'slug', 'ordem', 'ativo'] : ['nome', 'slug', 'ativo'];
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
        return res.status(200).json({ [tabela]: registros });
    }

    async function criar(req, res) {
        const dados = validar(req.body, { parcial: false });
        const registro = await gravar(() => Modelo.create(dados));
        return res.status(201).json({ mensagem: `${rotulo} criad${artigo}.`, [chaveResposta]: registro });
    }

    async function atualizar(req, res) {
        const registro = await Modelo.findByPk(req.params.id);
        if (!registro) throw naoEncontrado();
        const dados = validar(req.body, { parcial: true });
        await gravar(() => registro.update(dados));
        return res.status(200).json({ mensagem: `${rotulo} atualizad${artigo}.`, [chaveResposta]: registro });
    }

    // Só exclui se nenhum produto usar; caso contrário, sugere desativar.
    async function excluir(req, res) {
        const registro = await Modelo.findByPk(req.params.id);
        if (!registro) throw naoEncontrado();
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
