const { Op, QueryTypes } = require('sequelize');
const sequelize = require('../db/conn');
const { Produto, CarrinhoContato, Usuario } = require('../models');
const { somenteDigitos, normalizarCnpj } = require('../lib/cnpj');
const { apresentarCliente } = require('../lib/apresentacao');
const configuracoes = require('./configuracoes');

const DIA = 24 * 60 * 60 * 1000;

/**
 * Carrinho abandonado: tem itens, está parado há pelo menos N dias (configuração "carrinho_abandonado_dias",
 * padrão 2) e o cliente (ativo) não fez pedido depois da última atualização do carrinho.
 * "Contatado": a equipe registrou um contato depois da última atualização do carrinho (um carrinho mexido de novo
 * e abandonado outra vez volta a ficar sem contato).
 */
function montarCondicoes({ dias, busca, contatado }) {
    const replacements = { corte: new Date(Date.now() - dias * DIA) };
    const condicoes = [
        'JSON_LENGTH(c.itens) > 0',
        'c.atualizado_em <= :corte',
        "u.tipo = 'cliente' AND u.ativo = 1",
        'NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.id_cliente = c.id_usuario AND p.data_pedido > c.atualizado_em)'
    ];
    const contatoPosterior = 'EXISTS (SELECT 1 FROM carrinho_contatos k WHERE k.id_usuario = c.id_usuario AND k.criado_em >= c.atualizado_em)';
    if (contatado === true) condicoes.push(contatoPosterior);
    if (contatado === false) condicoes.push(`NOT ${contatoPosterior}`);
    if (busca) {
        replacements.busca = `%${busca.replace(/[\\%_]/g, (caractere) => `\\${caractere}`)}%`;
        const ou = ['u.nome LIKE :busca', 'u.razao_social LIKE :busca', 'u.email LIKE :busca'];
        const cnpjBusca = normalizarCnpj(busca);
        if (cnpjBusca.length >= 2) {
            replacements.cnpjBusca = `%${cnpjBusca}%`;
            ou.push('u.cnpj LIKE :cnpjBusca');
        }
        condicoes.push(`(${ou.join(' OR ')})`);
    }
    return { where: condicoes.join(' AND '), replacements };
}

const FROM = 'FROM carrinhos c JOIN usuarios u ON u.id_usuario = c.id_usuario';

async function diasDeCorte(dias) {
    return dias || configuracoes.obterNumero('carrinho_abandonado_dias');
}

// Quantidade de carrinhos abandonados (usada no contador do painel).
async function contarAbandonados({ dias, busca, contatado } = {}) {
    const { where, replacements } = montarCondicoes({ dias: await diasDeCorte(dias), busca, contatado });
    const [linha] = await sequelize.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${where}`, { replacements, type: QueryTypes.SELECT });
    return Number(linha.total);
}

// Mensagem pronta e educada para a equipe enviar pelo WhatsApp. Sem valores em reais.
function mensagemWhatsapp(nome) {
    return `Olá, ${nome}! Aqui é da Mantiqueira Distribuidora. Vimos que você deixou alguns itens no carrinho. ` +
        'Podemos ajudar a finalizar o seu pedido?';
}

// Telefone gravado com DDD (10 ou 11 dígitos), com ou sem o 55: devolve https://wa.me/55DDDNUMERO?text=...
function linkWhatsapp(telefone, nome) {
    let digitos = somenteDigitos(telefone);
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) digitos = digitos.slice(2);
    if (digitos.length < 10 || digitos.length > 11) return null;
    return `https://wa.me/55${digitos}?text=${encodeURIComponent(mensagemWhatsapp(nome))}`;
}

// Último contato da equipe depois da última atualização do carrinho de cada cliente: Map(id_usuario => contato).
async function contatosRecentes(carrinhos) {
    if (carrinhos.length === 0) return new Map();
    const contatos = await CarrinhoContato.findAll({
        where: { id_usuario: { [Op.in]: carrinhos.map((carrinho) => carrinho.id_usuario) } },
        include: [{ model: Usuario, as: 'funcionario', attributes: ['id_usuario', 'nome'], required: false }],
        order: [['criado_em', 'DESC'], ['id_contato', 'DESC']]
    });
    const porUsuario = new Map();
    for (const carrinho of carrinhos) {
        const contato = contatos.find((item) => item.id_usuario === carrinho.id_usuario && item.criado_em >= carrinho.atualizado_em);
        if (contato) porUsuario.set(carrinho.id_usuario, contato);
    }
    return porUsuario;
}

/**
 * Lista paginada de carrinhos abandonados, do mais recente para o mais antigo.
 * Filtros: dias (substitui a configuração), busca (nome, razão social, e-mail, CNPJ) e contatado (true|false).
 */
async function listarAbandonados({ dias, busca, contatado, limite, offset }) {
    const diasUsados = await diasDeCorte(dias);
    const { where, replacements } = montarCondicoes({ dias: diasUsados, busca, contatado });
    const [linhas, total] = await Promise.all([
        sequelize.query(`
            SELECT c.id_carrinho, c.id_usuario, c.itens, c.atualizado_em,
                   u.nome, u.razao_social, u.cnpj, u.telefone, u.email
            ${FROM} WHERE ${where}
            ORDER BY c.atualizado_em DESC, c.id_carrinho DESC LIMIT :limite OFFSET :offset`,
        { replacements: { ...replacements, limite, offset }, type: QueryTypes.SELECT }),
        sequelize.query(`SELECT COUNT(*) AS total ${FROM} WHERE ${where}`, { replacements, type: QueryTypes.SELECT })
    ]);

    const itens = linhas.map((linha) => ({ ...linha, itens: typeof linha.itens === 'string' ? JSON.parse(linha.itens) : linha.itens }));
    const idsProdutos = [...new Set(itens.flatMap((carrinho) => carrinho.itens.map((item) => item.id_produto)))];
    const produtos = idsProdutos.length === 0 ? [] : await Produto.findAll({
        where: { id_produto: { [Op.in]: idsProdutos } },
        attributes: ['id_produto', 'sku', 'nome']
    });
    const produtoPorId = new Map(produtos.map((produto) => [produto.id_produto, produto]));
    const contatos = await contatosRecentes(itens);

    const agora = Date.now();
    return {
        carrinhos: itens.map((carrinho) => {
            const cliente = apresentarCliente({
                id_usuario: carrinho.id_usuario,
                nome: carrinho.nome,
                razao_social: carrinho.razao_social,
                cnpj: carrinho.cnpj,
                telefone: carrinho.telefone,
                email: carrinho.email
            });
            const contato = contatos.get(carrinho.id_usuario);
            return {
                id_carrinho: carrinho.id_carrinho,
                cliente: {
                    id_usuario: cliente.id_usuario,
                    cnpj: cliente.cnpj,
                    nome_exibicao: cliente.nome_exibicao,
                    telefone: cliente.telefone,
                    email: cliente.email
                },
                ultimo_movimento_em: carrinho.atualizado_em,
                dias_parado: Math.floor((agora - new Date(carrinho.atualizado_em).getTime()) / DIA),
                total_unidades: carrinho.itens.reduce((soma, item) => soma + item.quantidade, 0),
                itens: carrinho.itens
                    .filter((item) => produtoPorId.has(item.id_produto))
                    .map((item) => {
                        const produto = produtoPorId.get(item.id_produto);
                        return { id_produto: item.id_produto, sku: produto.sku, nome: produto.nome, quantidade: item.quantidade };
                    }),
                contatado_em: contato ? contato.criado_em : null,
                contatado_por: contato && contato.funcionario
                    ? { id_usuario: contato.funcionario.id_usuario, nome: contato.funcionario.nome }
                    : null,
                link_whatsapp: linkWhatsapp(carrinho.telefone, cliente.nome_exibicao)
            };
        }),
        total: Number(total[0].total),
        dias: diasUsados
    };
}

// O cliente tem um carrinho abandonado agora (pela configuração de dias)?
async function temCarrinhoAbandonado(idCliente) {
    const { where, replacements } = montarCondicoes({ dias: await diasDeCorte() });
    const [linha] = await sequelize.query(
        `SELECT COUNT(*) AS total ${FROM} WHERE ${where} AND c.id_usuario = :idCliente`,
        { replacements: { ...replacements, idCliente }, type: QueryTypes.SELECT }
    );
    return Number(linha.total) > 0;
}

module.exports = { listarAbandonados, contarAbandonados, temCarrinhoAbandonado, linkWhatsapp, mensagemWhatsapp };
