const bcrypt = require('bcrypt');
const { Op, UniqueConstraintError } = require('sequelize');
const sequelize = require('../db/conn');
const { Usuario, Endereco } = require('../models');
const { ErroApi } = require('../lib/erros');
const { formatarCnpj } = require('../lib/cnpj');
const {
    validarEndereco,
    validarPerfilProprio,
    validarTrocaSenha,
    lancarSeHouverErros
} = require('../helpers/validacaoUsuario');
const { CUSTO_BCRYPT } = require('./usuarioControlador');

const LIMITE_ENDERECOS = 20;

async function carregarConta(idUsuario) {
    const usuario = await Usuario.findByPk(idUsuario, {
        attributes: ['id_usuario', 'nome', 'email', 'telefone', 'tipo', 'razao_social', 'cnpj', 'cargo', 'criado_em'],
        include: [{ model: Endereco, as: 'enderecos', attributes: { exclude: ['id_usuario'] } }],
        order: [[{ model: Endereco, as: 'enderecos' }, 'principal', 'DESC'], [{ model: Endereco, as: 'enderecos' }, 'id_endereco', 'ASC']]
    });
    const conta = usuario.toJSON();
    conta.cnpj = conta.cnpj ? formatarCnpj(conta.cnpj) : null;
    return conta;
}

// GET /minha-conta
async function obter(req, res) {
    return res.status(200).json({ conta: await carregarConta(req.usuario.id) });
}

// PATCH /minha-conta { nome?, email?, telefone? }. CNPJ e razão social só podem ser alterados pela equipe.
async function atualizar(req, res) {
    const dados = validarPerfilProprio(req.body);
    try {
        await Usuario.update(dados, { where: { id_usuario: req.usuario.id } });
    } catch (erro) {
        if (erro instanceof UniqueConstraintError) {
            throw new ErroApi(409, 'EMAIL_JA_CADASTRADO', 'Este e-mail já está cadastrado.',
                [{ campo: 'email', mensagem: 'Este e-mail já está cadastrado.' }]);
        }
        throw erro;
    }
    return res.status(200).json({ mensagem: 'Dados atualizados.', conta: await carregarConta(req.usuario.id) });
}

// PATCH /minha-conta/senha { senha_atual, nova_senha }
async function trocarSenha(req, res) {
    const { senhaAtual, novaSenha } = validarTrocaSenha(req.body);
    const usuario = await Usuario.findByPk(req.usuario.id, { attributes: ['id_usuario', 'senha'] });
    if (!(await bcrypt.compare(senhaAtual, usuario.senha))) {
        throw new ErroApi(422, 'VALIDACAO', 'A senha atual não confere.', [{ campo: 'senha_atual', mensagem: 'A senha atual não confere.' }]);
    }
    await usuario.update({ senha: await bcrypt.hash(novaSenha, CUSTO_BCRYPT) });
    return res.status(200).json({ mensagem: 'Senha alterada.' });
}

async function buscarEnderecoProprio(req, transacao) {
    const endereco = await Endereco.findOne({
        where: { id_endereco: Number(req.params.id_endereco) || 0, id_usuario: req.usuario.id },
        transaction: transacao,
        lock: transacao ? transacao.LOCK.UPDATE : undefined
    });
    if (!endereco) {
        throw new ErroApi(404, 'ENDERECO_NAO_ENCONTRADO', 'Endereço não encontrado.');
    }
    return endereco;
}

// Só um endereço principal por cliente: marcar um desmarca os outros.
async function desmarcarOutrosPrincipais(idUsuario, idEndereco, transacao) {
    await Endereco.update(
        { principal: false },
        { where: { id_usuario: idUsuario, id_endereco: { [Op.ne]: idEndereco } }, transaction: transacao }
    );
}

// GET /minha-conta/enderecos
async function listarEnderecos(req, res) {
    const enderecos = await Endereco.findAll({
        where: { id_usuario: req.usuario.id },
        attributes: { exclude: ['id_usuario'] },
        order: [['principal', 'DESC'], ['id_endereco', 'ASC']]
    });
    return res.status(200).json({ enderecos });
}

// POST /minha-conta/enderecos
async function adicionarEndereco(req, res) {
    const { dados, erros } = validarEndereco(req.body);
    lancarSeHouverErros(erros);
    const endereco = await sequelize.transaction(async (transacao) => {
        // Bloqueia a linha do usuário para dois cadastros simultâneos não passarem do limite.
        await Usuario.findByPk(req.usuario.id, { transaction: transacao, lock: transacao.LOCK.UPDATE });
        const total = await Endereco.count({ where: { id_usuario: req.usuario.id }, transaction: transacao });
        if (total >= LIMITE_ENDERECOS) {
            throw new ErroApi(409, 'LIMITE_ENDERECOS', `Limite de ${LIMITE_ENDERECOS} endereços atingido.`);
        }
        // O primeiro endereço é sempre o principal.
        const principal = total === 0 ? true : dados.principal === true;
        const novo = await Endereco.create(
            { ...dados, principal, id_usuario: req.usuario.id },
            { transaction: transacao }
        );
        if (principal) await desmarcarOutrosPrincipais(req.usuario.id, novo.id_endereco, transacao);
        return novo;
    });
    return res.status(201).json({ mensagem: 'Endereço adicionado.', endereco });
}

// PATCH /minha-conta/enderecos/:id_endereco
async function atualizarEndereco(req, res) {
    const { dados, erros } = validarEndereco(req.body, { parcial: true });
    lancarSeHouverErros(erros);
    if (dados.principal === false) {
        throw new ErroApi(422, 'VALIDACAO', 'Para trocar o principal, marque outro endereço como principal.');
    }
    const endereco = await sequelize.transaction(async (transacao) => {
        const existente = await buscarEnderecoProprio(req, transacao);
        await existente.update(dados, { transaction: transacao });
        if (dados.principal) await desmarcarOutrosPrincipais(req.usuario.id, existente.id_endereco, transacao);
        return existente;
    });
    return res.status(200).json({ mensagem: 'Endereço atualizado.', endereco });
}

// DELETE /minha-conta/enderecos/:id_endereco. O cliente precisa manter ao menos um endereço.
async function removerEndereco(req, res) {
    await sequelize.transaction(async (transacao) => {
        const endereco = await buscarEnderecoProprio(req, transacao);
        const total = await Endereco.count({ where: { id_usuario: req.usuario.id }, transaction: transacao });
        if (total <= 1) {
            throw new ErroApi(409, 'ULTIMO_ENDERECO', 'Mantenha ao menos um endereço de entrega.');
        }
        await endereco.destroy({ transaction: transacao });
        // Se o principal foi removido, o mais antigo restante assume.
        if (endereco.principal) {
            const proximo = await Endereco.findOne({
                where: { id_usuario: req.usuario.id },
                order: [['id_endereco', 'ASC']],
                transaction: transacao
            });
            await proximo.update({ principal: true }, { transaction: transacao });
        }
    });
    return res.status(200).json({ mensagem: 'Endereço removido.' });
}

module.exports = {
    obter,
    atualizar,
    trocarSenha,
    listarEnderecos,
    adicionarEndereco,
    atualizarEndereco,
    removerEndereco
};
