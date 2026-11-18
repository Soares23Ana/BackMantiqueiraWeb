const { Op } = require('sequelize');
const { Usuario, SolicitacaoRedefinicao } = require('../models');
const { cnpjValido, formatarCnpj, normalizarCnpj } = require('../lib/cnpj');
const logger = require('../lib/logger');

const MENSAGEM_PUBLICA = 'Pedido recebido. Se o CNPJ estiver cadastrado, a equipe vai entrar em contato em breve.';

/**
 * Registra o pedido de nova senha de um cliente ativo pelo CNPJ. Quem chama sempre recebe a mesma resposta,
 * exista o CNPJ ou não, para a rota não revelar quais CNPJs estão cadastrados. Um cliente tem no máximo um
 * pedido pendente: pedidos repetidos não criam linhas novas. Devolve true se criou um pedido novo.
 */
async function registrar(cnpjInformado) {
    const cnpj = normalizarCnpj(cnpjInformado);
    if (!cnpjValido(cnpj)) return false;
    const cliente = await Usuario.findOne({ where: { cnpj, tipo: 'cliente', ativo: true }, attributes: ['id_usuario'] });
    if (!cliente) return false;
    const pendente = await SolicitacaoRedefinicao.findOne({
        where: { id_usuario: cliente.id_usuario, atendido_em: null },
        attributes: ['id_solicitacao']
    });
    if (pendente) return false;
    await SolicitacaoRedefinicao.create({ id_usuario: cliente.id_usuario });
    logger.info('Pedido de nova senha registrado.', { id_cliente: cliente.id_usuario });
    return true;
}

// Pedidos pendentes, do mais antigo para o mais novo (quem espera há mais tempo aparece primeiro).
async function listarPendentes() {
    const pedidos = await SolicitacaoRedefinicao.findAll({
        where: { atendido_em: null },
        order: [['criado_em', 'ASC'], ['id_solicitacao', 'ASC']]
    });
    if (pedidos.length === 0) return [];
    const clientes = await Usuario.findAll({
        where: { id_usuario: { [Op.in]: pedidos.map((p) => p.id_usuario) } },
        attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj', 'telefone', 'email', 'ativo']
    });
    const porId = new Map(clientes.map((c) => [c.id_usuario, c]));
    return pedidos.map((pedido) => {
        const c = porId.get(pedido.id_usuario);
        return {
            id_solicitacao: pedido.id_solicitacao,
            solicitado_em: pedido.criado_em,
            cliente: c ? {
                id_usuario: c.id_usuario,
                nome_exibicao: c.razao_social || c.nome,
                cnpj: c.cnpj ? formatarCnpj(c.cnpj) : null,
                telefone: c.telefone,
                email: c.email,
                ativo: c.ativo
            } : null
        };
    });
}

function contarPendentes() {
    return SolicitacaoRedefinicao.count({ where: { atendido_em: null } });
}

// Dá o pedido do cliente como atendido (link gerado, senha temporária definida ou senha trocada pelo cliente).
function marcarAtendidas(idUsuario, atendidoPor = null, transacao = undefined) {
    return SolicitacaoRedefinicao.update(
        { atendido_em: new Date(), atendido_por: atendidoPor },
        { where: { id_usuario: idUsuario, atendido_em: null }, transaction: transacao }
    );
}

module.exports = { MENSAGEM_PUBLICA, registrar, listarPendentes, contarPendentes, marcarAtendidas };
