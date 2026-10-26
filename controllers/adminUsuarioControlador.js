const bcrypt = require('bcrypt');
const { Op, UniqueConstraintError } = require('sequelize');
const { Usuario } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { validarUsuarioEquipe, TIPOS_EQUIPE } = require('../helpers/validacaoUsuario');
const { CUSTO_BCRYPT } = require('./usuarioControlador');

const ATRIBUTOS = ['id_usuario', 'nome', 'email', 'tipo', 'cargo', 'telefone', 'razao_social', 'cnpj', 'ativo', 'criado_em'];

function emailDuplicado(erro) {
    if (erro instanceof UniqueConstraintError) {
        throw new ErroApi(409, 'EMAIL_JA_CADASTRADO', 'Este e-mail já está cadastrado.',
            [{ campo: 'email', mensagem: 'Este e-mail já está cadastrado.' }]);
    }
    throw erro;
}

// POST /admin/usuarios: só o admin cria a equipe. Equipe não tem CNPJ.
async function criar(req, res) {
    const dados = validarUsuarioEquipe(req.body);
    const senha = await bcrypt.hash(dados.senha, CUSTO_BCRYPT);
    let usuario;
    try {
        usuario = await Usuario.create({ ...dados, senha, cnpj: null });
    } catch (erro) {
        emailDuplicado(erro);
    }
    const criado = await Usuario.findByPk(usuario.id_usuario, { attributes: ATRIBUTOS });
    return res.status(201).json({ mensagem: 'Usuário da equipe criado.', usuario: criado });
}

// GET /admin/usuarios?tipo=gerente&ativo=false&busca=...&pagina=1
async function listar(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 50, limiteMaximo: 200 });
    const where = {};
    if (req.query.tipo) {
        if (![...TIPOS_EQUIPE, 'cliente'].includes(req.query.tipo)) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', 'tipo deve ser cliente, funcionario, gerente ou admin.');
        }
        where.tipo = req.query.tipo;
    }
    if (req.query.ativo !== undefined) {
        if (!['true', 'false'].includes(req.query.ativo)) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', 'ativo deve ser true ou false.');
        }
        where.ativo = req.query.ativo === 'true';
    }
    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 100) : '';
    if (busca) {
        where[Op.or] = [
            { nome: { [Op.like]: `%${busca}%` } },
            { email: { [Op.like]: `%${busca}%` } }
        ];
    }
    const { rows, count } = await Usuario.findAndCountAll({
        where,
        attributes: ATRIBUTOS,
        order: [['nome', 'ASC']],
        limit: paginacao.limite,
        offset: paginacao.offset
    });
    return res.status(200).json({ usuarios: rows, paginacao: montarPaginacao(count, paginacao) });
}

/**
 * PATCH /admin/usuarios/:id: edita dados, perfil, senha ou ativo de qualquer usuário.
 * Para clientes, só "ativo" pode ser alterado aqui (o restante é feito em /clientes/:id).
 * O admin não pode se desativar nem tirar o próprio perfil de admin (evita ficar sem acesso).
 */
async function atualizar(req, res) {
    const usuario = await Usuario.findByPk(req.params.id);
    if (!usuario) {
        throw new ErroApi(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
    }
    const dados = validarUsuarioEquipe(req.body, { parcial: true });
    if (usuario.tipo === 'cliente' && Object.keys(dados).some((campo) => campo !== 'ativo')) {
        throw new ErroApi(422, 'VALIDACAO', 'Para clientes, use PUT /clientes/:id. Aqui só é possível alterar "ativo".');
    }
    if (usuario.id_usuario === req.usuario.id && (dados.ativo === false || (dados.tipo && dados.tipo !== 'admin'))) {
        throw new ErroApi(409, 'OPERACAO_NAO_PERMITIDA', 'O admin não pode desativar a própria conta nem remover o próprio perfil de admin.');
    }
    if (dados.senha) {
        dados.senha = await bcrypt.hash(dados.senha, CUSTO_BCRYPT);
    }
    try {
        await usuario.update(dados);
    } catch (erro) {
        emailDuplicado(erro);
    }
    const atualizado = await Usuario.findByPk(usuario.id_usuario, { attributes: ATRIBUTOS });
    return res.status(200).json({ mensagem: 'Usuário atualizado.', usuario: atualizado });
}

module.exports = { criar, listar, atualizar };
