const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const config = require('../config/ambiente');
const { ErroApi } = require('../lib/erros');
const logger = require('../lib/logger');
const { cnpjValido, formatarCnpj, normalizarCnpj } = require('../lib/cnpj');
const { Usuario, PedidoRedefinicaoSenha } = require('../models');
const { registrarAuditoria } = require('./auditoria');

const MENSAGEM_PUBLICA = 'Se o CNPJ estiver cadastrado, a equipe da Mantiqueira vai entrar em contato pelo WhatsApp para enviar o link.';
const DIAS_PARA_EXPIRAR = 7;      // pedido pendente há mais de 7 dias vira "expirado"
const DIAS_RETENCAO = 30;         // pedido resolvido (atendido, dispensado ou expirado) há mais de 30 dias é apagado
const TEMPO_MINIMO_RESPOSTA_MS = 250;

const DIA_MS = 24 * 60 * 60 * 1000;
const dormir = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Texto do corpo { documento }: o CNPJ com ou sem pontuação. Devolve o CNPJ normalizado ou null se o formato for inválido. */
function documentoValido(documento) {
    if (typeof documento !== 'string' || !documento.trim() || documento.length > 30) return null;
    const cnpj = normalizarCnpj(documento);
    return cnpjValido(cnpj) ? cnpj : null;
}

/**
 * Registra o pedido de nova senha de um CLIENTE ATIVO pelo CNPJ. Equipe, gestor, cliente inativo e CNPJ inexistente
 * não geram pedido e não se distinguem de fora: quem chama sempre recebe a mesma resposta. Um cliente tem no máximo
 * um pedido pendente: pedido repetido só renova o criado_em do pendente. Devolve "criado", "renovado" ou null.
 */
async function registrar(cnpj) {
    const cliente = await Usuario.findOne({ where: { cnpj, tipo: 'cliente', ativo: true }, attributes: ['id_usuario'] });
    if (!cliente) return null;
    const agora = new Date();
    const [renovados] = await PedidoRedefinicaoSenha.update(
        { criado_em: agora, atualizado_em: agora },
        { where: { id_usuario: cliente.id_usuario, status: 'pendente' } }
    );
    if (renovados > 0) return 'renovado';
    try {
        const pedido = await PedidoRedefinicaoSenha.create({ id_usuario: cliente.id_usuario, status: 'pendente', criado_em: agora, atualizado_em: agora });
        await registrarAuditoria({
            usuario: null, acao: 'pedido_senha.criado', entidade: 'cliente', idEntidade: cliente.id_usuario, detalhe: { id_pedido: pedido.id_pedido }
        });
        return 'criado';
    } catch (erro) {
        // Dois pedidos simultâneos do mesmo cliente: o índice único barra o segundo, que só renova o primeiro.
        if (erro.name === 'SequelizeUniqueConstraintError') return 'renovado';
        throw erro;
    }
}

/**
 * Atende o pedido público: a resposta demora no mínimo ~250 ms, exista o CNPJ ou não (a diferença de tempo entre
 * "achou e gravou" e "não achou" não pode revelar nada). Nos testes não há espera.
 */
async function solicitar(cnpj) {
    const inicio = Date.now();
    try {
        await registrar(cnpj);
    } finally {
        const espera = config.teste ? 0 : TEMPO_MINIMO_RESPOSTA_MS - (Date.now() - inicio);
        if (espera > 0) await dormir(espera);
    }
}

function clienteDoPedido(c) {
    return c ? {
        id_usuario: c.id_usuario,
        nome_exibicao: c.razao_social || c.nome,
        razao_social: c.razao_social,
        nome: c.nome,
        cnpj: c.cnpj ? formatarCnpj(c.cnpj) : null,
        telefone: c.telefone,
        ativo: c.ativo
    } : null;
}

/** Lista paginada, do pedido mais antigo para o mais novo. Nunca devolve token nem link. */
async function listar({ status, limite, offset }) {
    const where = status ? { status } : {};
    const { rows, count } = await PedidoRedefinicaoSenha.findAndCountAll({
        where,
        order: [['criado_em', 'ASC'], ['id_pedido', 'ASC']],
        limit: limite,
        offset
    });
    const clientes = rows.length > 0
        ? await Usuario.findAll({
            where: { id_usuario: { [Op.in]: rows.map((p) => p.id_usuario) } },
            attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj', 'telefone', 'ativo']
        })
        : [];
    const porId = new Map(clientes.map((c) => [c.id_usuario, c]));
    return {
        total: count,
        pedidos: rows.map((p) => ({
            id_pedido: p.id_pedido,
            status: p.status,
            criado_em: p.criado_em,
            atendido_em: p.atendido_em,
            cliente: clienteDoPedido(porId.get(p.id_usuario))
        }))
    };
}

function contarPendentes() {
    return PedidoRedefinicaoSenha.count({ where: { status: 'pendente' } });
}

// Dá o pedido pendente do cliente como atendido (link gerado pela rota antiga, senha temporária ou senha trocada).
function marcarAtendidos(idUsuario, atendidoPor = null, transacao = undefined) {
    const agora = new Date();
    return PedidoRedefinicaoSenha.update(
        { status: 'atendido', atendido_em: agora, atendido_por: atendidoPor, atualizado_em: agora },
        { where: { id_usuario: idUsuario, status: 'pendente' }, transaction: transacao }
    );
}

/**
 * Telefone cadastrado → só dígitos com DDI 55 (formato do wa.me). Aceita DDD + 8 ou 9 dígitos, com ou sem 55 e
 * com zero na frente. Se não der para normalizar, devolve null.
 */
function telefoneWhatsapp(telefone) {
    let digitos = String(telefone ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
    if (digitos.length !== 10 && digitos.length !== 11) return null;
    if (/^(\d)\1+$/.test(digitos) || digitos.startsWith('0') || digitos.slice(0, 2) < '11') return null;
    return `55${digitos}`;
}

function montarMensagem({ nome, link, minutos }) {
    const primeiroNome = String(nome ?? '').trim().split(/\s+/)[0] || 'tudo bem';
    return `Olá, ${primeiroNome}! Aqui é a equipe da Mantiqueira Distribuidora. Segue o link para você criar uma nova senha: ${link}\n`
        + `O link vale por ${minutos} minutos e só pode ser usado uma vez. Se você não pediu, é só ignorar esta mensagem.`;
}

async function buscarPendente(idPedido, transacao) {
    const id = Number(idPedido);
    const pedido = Number.isSafeInteger(id) && id > 0
        ? await PedidoRedefinicaoSenha.findByPk(id, { transaction: transacao, lock: transacao.LOCK.UPDATE })
        : null;
    if (!pedido) throw new ErroApi(404, 'NAO_ENCONTRADO', 'Pedido não encontrado.');
    if (pedido.status !== 'pendente') {
        throw new ErroApi(409, 'PEDIDO_NAO_PENDENTE', 'Este pedido já foi atendido, dispensado ou expirou.', [{ campo: 'status', mensagem: pedido.status }]);
    }
    return pedido;
}

/**
 * Atende o pedido: numa só transação gera o link (o serviço de redefinição invalida os links pendentes do cliente) e
 * marca o pedido como atendido. O link é montado com urlBase; o token só existe nesta resposta (no link).
 */
async function enviarLink({ idPedido, equipe, urlBase }) {
    const { gerarLink } = require('./redefinicaoSenha');
    const resultado = await sequelize.transaction(async (transacao) => {
        const pedido = await buscarPendente(idPedido, transacao);
        const cliente = await Usuario.findByPk(pedido.id_usuario, { attributes: ['id_usuario', 'nome', 'razao_social', 'telefone'], transaction: transacao });
        const { token, expira_em: expiraEm } = await gerarLink({
            idUsuario: pedido.id_usuario, tipoEsperado: 'cliente', criadoPor: equipe.id, transacao, marcarPedidos: false
        });
        const agora = new Date();
        await pedido.update({ status: 'atendido', atendido_em: agora, atendido_por: equipe.id, atualizado_em: agora }, { transaction: transacao });
        return { pedido, cliente, token, expiraEm };
    });

    const link = `${urlBase}/redefinir-senha?token=${resultado.token}`;
    const telefone = telefoneWhatsapp(resultado.cliente.telefone);
    const nome = resultado.cliente.razao_social || resultado.cliente.nome;
    logger.info('Link enviado a partir de um pedido de nova senha.', { id_pedido: resultado.pedido.id_pedido, por: equipe.id });
    // A trilha guarda só a validade: nunca o token nem o link.
    await registrarAuditoria({
        usuario: equipe, acao: 'pedido_senha.link_enviado', entidade: 'cliente', idEntidade: resultado.pedido.id_usuario,
        detalhe: { id_pedido: resultado.pedido.id_pedido, expira_em: resultado.expiraEm }
    });
    return {
        link,
        expira_em: resultado.expiraEm,
        telefone_whatsapp: telefone,
        mensagem: montarMensagem({ nome, link, minutos: config.redefinicaoSenhaMinutos }),
        ...(telefone ? {} : { aviso: 'O telefone cadastrado não parece válido para o WhatsApp. Entre em contato com o cliente de outro jeito e envie o link.' })
    };
}

async function dispensar({ idPedido, equipe }) {
    const pedido = await sequelize.transaction(async (transacao) => {
        const alvo = await buscarPendente(idPedido, transacao);
        const agora = new Date();
        await alvo.update({ status: 'dispensado', atendido_em: agora, atendido_por: equipe.id, atualizado_em: agora }, { transaction: transacao });
        return alvo;
    });
    await registrarAuditoria({
        usuario: equipe, acao: 'pedido_senha.dispensado', entidade: 'cliente', idEntidade: pedido.id_usuario, detalhe: { id_pedido: pedido.id_pedido }
    });
    return pedido;
}

// Limpeza diária: pendentes com mais de 7 dias viram "expirado"; resolvidos com mais de 30 dias são apagados, em lotes.
async function limparPedidosAntigos({ tamanhoLote = 1000 } = {}) {
    const limiteExpirar = new Date(Date.now() - DIAS_PARA_EXPIRAR * DIA_MS);
    const limiteApagar = new Date(Date.now() - DIAS_RETENCAO * DIA_MS);
    const agora = new Date();
    const [expirados] = await PedidoRedefinicaoSenha.update(
        { status: 'expirado', atualizado_em: agora },
        { where: { status: 'pendente', criado_em: { [Op.lt]: limiteExpirar } } }
    );
    let removidos = 0;
    for (;;) {
        const lote = await PedidoRedefinicaoSenha.destroy({
            where: { status: { [Op.ne]: 'pendente' }, atualizado_em: { [Op.lt]: limiteApagar } },
            limit: tamanhoLote
        });
        removidos += lote;
        if (lote < tamanhoLote) break;
    }
    return { pedidos_expirados: expirados, pedidos_removidos: removidos, expirados_antes_de: limiteExpirar.toISOString(), removidos_antes_de: limiteApagar.toISOString() };
}

module.exports = {
    MENSAGEM_PUBLICA, documentoValido, solicitar, registrar, listar, contarPendentes, marcarAtendidos,
    telefoneWhatsapp, montarMensagem, enviarLink, dispensar, limparPedidosAntigos
};
