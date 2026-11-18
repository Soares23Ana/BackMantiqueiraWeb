const { createHash, randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const config = require('../config/ambiente');
const { ErroApi } = require('../lib/erros');
const { Usuario, RedefinicaoSenha } = require('../models');
const { agoraParaTrocaDeSenha } = require('../models/Usuario');
const { criarValidador, exigirObjeto, lancarSeHouverErros } = require('../helpers/validacaoUsuario');
const { registrarAuditoria } = require('./auditoria');
const solicitacoes = require('./solicitacoesRedefinicao');
const logger = require('../lib/logger');

// 32 bytes aleatórios em base64url dão sempre 43 caracteres.
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DIAS_RETENCAO = 7;
const MENSAGEM_TOKEN_INVALIDO = 'Link inválido ou expirado. Peça um novo link à equipe.';

const tokenInvalido = () => new ErroApi(422, 'TOKEN_INVALIDO', MENSAGEM_TOKEN_INVALIDO);
const hashDoToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Gera um link de uso único para o usuário (só o hash do token vai para o banco) e invalida os pendentes.
 * tipoEsperado: "cliente" ou "equipe". Devolve { token, expira_em }; o token em texto existe só nesta resposta.
 */
async function gerarLink({ idUsuario, tipoEsperado, criadoPor }) {
    const token = randomBytes(32).toString('base64url');
    const expiraEm = new Date(Date.now() + config.redefinicaoSenhaMinutos * 60 * 1000);
    const usuario = await sequelize.transaction(async (transacao) => {
        const alvo = Number.isSafeInteger(Number(idUsuario)) && Number(idUsuario) > 0
            ? await Usuario.findOne({
                where: { id_usuario: Number(idUsuario), tipo: tipoEsperado },
                attributes: ['id_usuario', 'ativo'],
                transaction: transacao,
                lock: transacao.LOCK.UPDATE
            })
            : null;
        if (!alvo) {
            throw new ErroApi(404, 'NAO_ENCONTRADO', tipoEsperado === 'cliente' ? 'Cliente não encontrado.' : 'Usuário da equipe não encontrado.');
        }
        if (!alvo.ativo) {
            throw new ErroApi(409, 'USUARIO_INATIVO', 'Este usuário está inativo. Reative-o antes de gerar um link.');
        }
        await RedefinicaoSenha.update(
            { usado_em: new Date() },
            { where: { id_usuario: alvo.id_usuario, usado_em: null }, transaction: transacao }
        );
        await RedefinicaoSenha.create(
            { id_usuario: alvo.id_usuario, token_hash: hashDoToken(token), expira_em: expiraEm, criado_por: criadoPor },
            { transaction: transacao }
        );
        // O pedido de nova senha do cliente (se houver) foi atendido: a equipe gerou o link.
        await solicitacoes.marcarAtendidas(alvo.id_usuario, criadoPor, transacao);
        return alvo;
    });
    return { id_usuario: usuario.id_usuario, token, expira_em: expiraEm };
}

// Valida o corpo de { token } e de { token, nova_senha }; o token só precisa ser texto (o formato é conferido depois).
function validarCorpo(corpo, { comSenha }) {
    exigirObjeto(corpo);
    const v = criarValidador();
    v.camposPermitidos(corpo, comSenha ? ['token', 'nova_senha'] : ['token']);
    if (typeof corpo.token !== 'string' || !corpo.token || corpo.token.length > 200) v.erro('token', 'Informe o token do link.');
    const novaSenha = comSenha ? v.senha(corpo.nova_senha, 'nova_senha') : undefined;
    lancarSeHouverErros(v.erros);
    return { token: corpo.token, novaSenha };
}

// Só confere se o link existe, não foi usado, não expirou e o usuário está ativo (nada é alterado).
async function tokenValido(token) {
    if (!FORMATO_TOKEN.test(token)) return false;
    const registro = await RedefinicaoSenha.findOne({ where: { token_hash: hashDoToken(token) } });
    if (!registro || registro.usado_em || registro.expira_em.getTime() <= Date.now()) return false;
    const usuario = await Usuario.findByPk(registro.id_usuario, { attributes: ['ativo'] });
    return Boolean(usuario && usuario.ativo);
}

/**
 * Troca a senha com o link. Na transação, a linha do token é bloqueada: de duas requisições simultâneas
 * com o mesmo token, só uma vence. Token inexistente, usado, expirado ou de usuário inativo: sempre TOKEN_INVALIDO.
 */
async function redefinirSenha({ token, novaSenha }) {
    // O custo do bcrypt é pago antes de saber se o token vale, para não segurar o bloqueio da linha.
    const hash = await bcrypt.hash(novaSenha, require('../controllers/usuarioControlador').CUSTO_BCRYPT);
    if (!FORMATO_TOKEN.test(token)) throw tokenInvalido();

    const idUsuario = await sequelize.transaction(async (transacao) => {
        const registro = await RedefinicaoSenha.findOne({
            where: { token_hash: hashDoToken(token) },
            transaction: transacao,
            lock: transacao.LOCK.UPDATE
        });
        if (!registro || registro.usado_em || registro.expira_em.getTime() <= Date.now()) throw tokenInvalido();
        const usuario = await Usuario.findByPk(registro.id_usuario, {
            attributes: ['id_usuario', 'ativo'],
            transaction: transacao,
            lock: transacao.LOCK.UPDATE
        });
        if (!usuario || !usuario.ativo) throw tokenInvalido();

        const agora = new Date();
        // senha_alterada_em derruba os JWT emitidos antes (mesmo helper da troca de senha).
        await usuario.update({ senha: hash, senha_alterada_em: agoraParaTrocaDeSenha() }, { transaction: transacao });
        await RedefinicaoSenha.update(
            { usado_em: agora },
            { where: { id_usuario: usuario.id_usuario, usado_em: null }, transaction: transacao }
        );
        await solicitacoes.marcarAtendidas(usuario.id_usuario, null, transacao);
        return usuario.id_usuario;
    });

    logger.info('Senha redefinida por link.', { id_usuario: idUsuario });
    // Quem age é o próprio usuário; nunca vai token nem hash para a trilha.
    await registrarAuditoria({
        usuario: { id: idUsuario },
        acao: 'usuario.senha_redefinida_por_link',
        entidade: 'usuario',
        idEntidade: idUsuario,
        detalhe: { credencial_redefinida: true }
    });
}

// Job de limpeza: apaga links expirados ou usados há mais de 7 dias, em lotes.
async function limparRedefinicoesAntigas({ tamanhoLote = 1000 } = {}) {
    const limite = new Date(Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000);
    let total = 0;
    for (;;) {
        const removidos = await RedefinicaoSenha.destroy({
            where: { [Op.or]: [{ expira_em: { [Op.lt]: limite } }, { usado_em: { [Op.lt]: limite } }] },
            limit: tamanhoLote
        });
        total += removidos;
        if (removidos < tamanhoLote) break;
    }
    return { removidos: total, anteriores_a: limite.toISOString() };
}

module.exports = {
    gerarLink, validarCorpo, tokenValido, redefinirSenha, limparRedefinicoesAntigas, hashDoToken, tokenInvalido
};
