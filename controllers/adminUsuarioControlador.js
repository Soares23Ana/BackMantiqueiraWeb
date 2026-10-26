const bcrypt = require('bcrypt');
const { Op, UniqueConstraintError } = require('sequelize');
const sequelize = require('../db/conn');
const { Usuario } = require('../models');
const { ErroApi } = require('../lib/erros');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { validarUsuarioEquipe } = require('../helpers/validacaoUsuario');
const { CUSTO_BCRYPT } = require('./usuarioControlador');

const ATRIBUTOS = [
    'id_usuario', 'nome', 'email', 'tipo', 'pode_gerenciar_equipe', 'cargo', 'telefone',
    'razao_social', 'cnpj', 'ativo', 'criado_em'
];

function emailDuplicado(erro) {
    if (erro instanceof UniqueConstraintError) {
        throw new ErroApi(409, 'EMAIL_JA_CADASTRADO', 'Este e-mail já está cadastrado.',
            [{ campo: 'email', mensagem: 'Este e-mail já está cadastrado.' }]);
    }
    throw erro;
}

// POST /admin/usuarios: cria um usuário da equipe (sem CNPJ).
async function criar(req, res) {
    const dados = validarUsuarioEquipe(req.body);
    const senha = await bcrypt.hash(dados.senha, CUSTO_BCRYPT);
    let usuario;
    try {
        usuario = await Usuario.create({ ...dados, senha, tipo: 'equipe', cnpj: null });
    } catch (erro) {
        emailDuplicado(erro);
    }
    const criado = await Usuario.findByPk(usuario.id_usuario, { attributes: ATRIBUTOS });
    return res.status(201).json({ mensagem: 'Usuário da equipe criado.', usuario: criado });
}

// GET /admin/usuarios?tipo=equipe&ativo=false&busca=...&pagina=1
async function listar(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 50, limiteMaximo: 200 });
    const where = {};
    if (req.query.tipo) {
        if (!['cliente', 'equipe'].includes(req.query.tipo)) {
            throw new ErroApi(400, 'FILTRO_INVALIDO', 'tipo deve ser cliente ou equipe.');
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
 * PATCH /admin/usuarios/:id: edita dados, senha, cargo, pode_gerenciar_equipe ou ativo.
 * Para clientes, só "ativo" pode ser alterado aqui (o restante é feito em /clientes/:id).
 * Ninguém desativa a si mesmo, e a marca pode_gerenciar_equipe não pode sair do último usuário
 * ativo que a tem (a equipe ficaria sem ninguém para gerenciar usuários).
 */
async function atualizar(req, res) {
    const dados = validarUsuarioEquipe(req.body, { parcial: true });
    if (dados.senha) {
        dados.senha = await bcrypt.hash(dados.senha, CUSTO_BCRYPT);
    }

    const idUsuario = await sequelize.transaction(async (transacao) => {
        const usuario = await Usuario.findByPk(req.params.id, { transaction: transacao, lock: transacao.LOCK.UPDATE });
        if (!usuario) {
            throw new ErroApi(404, 'USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado.');
        }
        if (usuario.tipo === 'cliente' && Object.keys(dados).some((campo) => campo !== 'ativo')) {
            throw new ErroApi(422, 'VALIDACAO', 'Para clientes, use PUT /clientes/:id. Aqui só é possível alterar "ativo".');
        }
        if (usuario.id_usuario === req.usuario.id && dados.ativo === false) {
            throw new ErroApi(409, 'OPERACAO_NAO_PERMITIDA', 'Você não pode desativar a sua própria conta.');
        }

        const perdeMarca = usuario.pode_gerenciar_equipe && usuario.ativo &&
            (dados.pode_gerenciar_equipe === false || dados.ativo === false);
        if (perdeMarca) {
            // Bloqueia os demais com a marca para duas remoções simultâneas não zerarem a gestão.
            const outros = await Usuario.count({
                where: {
                    tipo: 'equipe',
                    ativo: true,
                    pode_gerenciar_equipe: true,
                    id_usuario: { [Op.ne]: usuario.id_usuario }
                },
                transaction: transacao,
                lock: transacao.LOCK.UPDATE
            });
            if (outros === 0) {
                throw new ErroApi(409, 'OPERACAO_NAO_PERMITIDA',
                    'Este é o último usuário ativo que pode gerenciar a equipe. Dê essa permissão a outra pessoa antes.');
            }
        }

        try {
            await usuario.update(dados, { transaction: transacao });
        } catch (erro) {
            emailDuplicado(erro);
        }
        return usuario.id_usuario;
    });

    const atualizado = await Usuario.findByPk(idUsuario, { attributes: ATRIBUTOS });
    return res.status(200).json({ mensagem: 'Usuário atualizado.', usuario: atualizado });
}

module.exports = { criar, listar, atualizar };
