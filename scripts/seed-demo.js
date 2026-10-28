// Dados de demonstração: contatos e aviso do site, banners, uma campanha ativa e pedidos do cliente de teste.
// Recusa-se a rodar em produção ou contra o RDS (mesma regra do seed:dev) e pode rodar quantas vezes quiser.
// Pré-requisitos: npm run seed:catalogo e npm run seed:dev.
// Uso: npm run seed:demo
const { verificarAmbienteSeguro, USUARIOS } = require('./seed-dev');

const CONFIGURACOES = {
    whatsapp: '5519999990000',
    telefone_contato: '1936330000',
    email_contato: 'atendimento@mantiqueira-exemplo.com.br',
    horario_atendimento: 'Segunda a sexta, das 8h às 18h. Sábado, das 8h às 12h.',
    aviso_topo: 'Entregamos em São João da Boa Vista e região.'
};

// Imagens da pasta public/img do front (as mesmas dos produtos do catálogo).
const BANNERS = [
    { titulo: 'Linha Granado Bebê', imagem_url: '/img/granado.webp', ordem: 1 },
    { titulo: 'Huggies: proteção para os pequenos', imagem_url: '/img/huggies.webp', ordem: 2 },
    { titulo: 'Hálito fresco com Colgate Plax', imagem_url: '/img/colgate-plax.webp', ordem: 3 }
];

// O selo é só um rótulo: campanhas não aplicam desconto.
const CAMPANHA = {
    titulo: 'Semana Granado',
    selo: 'Seleção Granado',
    skus: ['SKU-106', 'SKU-133', 'SKU-134', 'SKU-135', 'SKU-137']
};

// Um pedido por status. A chave de idempotência fixa impede que uma nova execução crie outro pedido.
const PEDIDOS = [
    { chave: 'seed-demo-aguardando', status: 'Aguardando Separação', itens: [['SKU-101', 6], ['SKU-108', 4]] },
    { chave: 'seed-demo-separacao', status: 'Em Separação', itens: [['SKU-111', 12]] },
    { chave: 'seed-demo-saiu', status: 'Saiu para Entrega', itens: [['SKU-113', 10], ['SKU-110', 5]] },
    { chave: 'seed-demo-entregue', status: 'Entregue', itens: [['SKU-101', 12], ['SKU-115', 3]] },
    { chave: 'seed-demo-cancelado', status: 'Cancelado', itens: [['SKU-108', 2]], motivo: 'Cliente pediu o cancelamento (demonstração).' }
];

async function semearConfiguracoes(log) {
    const servicoConfiguracoes = require('../servicos/configuracoes');
    for (const [chave, valor] of Object.entries(CONFIGURACOES)) {
        await servicoConfiguracoes.atualizar(chave, valor, null);
    }
    log(`configurações: ${Object.keys(CONFIGURACOES).join(', ')}`);
}

async function semearBanners(log) {
    const { Banner } = require('../models');
    for (const dados of BANNERS) {
        const [, criado] = await Banner.findOrCreate({ where: { titulo: dados.titulo }, defaults: { ...dados, ativo: true } });
        log(`${criado ? 'criado   ' : 'existente'} banner   ${dados.titulo}`);
    }
}

async function semearCampanha(log) {
    const { Campanha, CampanhaProduto, Produto } = require('../models');
    // A cada execução o período volta a cobrir hoje, para a campanha continuar ativa na demonstração.
    const inicio = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const fim = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [campanha, criada] = await Campanha.findOrCreate({
        where: { titulo: CAMPANHA.titulo },
        defaults: { selo: CAMPANHA.selo, inicio_em: inicio, fim_em: fim }
    });
    if (!criada) {
        await campanha.update({ selo: CAMPANHA.selo, inicio_em: inicio, fim_em: fim });
    }
    const produtos = await Produto.findAll({ where: { sku: CAMPANHA.skus }, attributes: ['id_produto', 'sku'] });
    for (const produto of produtos) {
        await CampanhaProduto.findOrCreate({ where: { id_campanha: campanha.id_campanha, id_produto: produto.id_produto } });
    }
    const faltando = CAMPANHA.skus.filter((sku) => !produtos.some((produto) => produto.sku === sku));
    log(`${criada ? 'criada   ' : 'existente'} campanha ${CAMPANHA.titulo} (${produtos.length} produtos${faltando.length ? `; sem ${faltando.join(', ')}` : ''})`);
}

async function semearPedidos(log) {
    const { Usuario, Produto } = require('../models');
    const servicoPedidos = require('../servicos/pedidos');
    const dadosCliente = USUARIOS.find((usuario) => usuario.tipo === 'cliente');
    const dadosEquipe = USUARIOS.find((usuario) => usuario.pode_gerenciar_equipe);
    const cliente = await Usuario.findOne({ where: { cnpj: dadosCliente.cnpj, tipo: 'cliente' } });
    const equipe = await Usuario.findOne({ where: { email: dadosEquipe.email, tipo: 'equipe' } });
    if (!cliente || !equipe) {
        log('pedidos: pulados. Rode antes "npm run seed:dev" (cliente e administrador de teste).');
        return;
    }
    const produtos = new Map((await Produto.findAll({ attributes: ['id_produto', 'sku'] })).map((p) => [p.sku, p.id_produto]));
    const usuarioEquipe = { id: equipe.id_usuario, tipo: 'equipe' };

    for (const definicao of PEDIDOS) {
        const itens = definicao.itens.map(([sku, quantidade]) => ({ id_produto: produtos.get(sku), quantidade }));
        if (itens.some((item) => !item.id_produto)) {
            log(`pedidos: "${definicao.status}" pulado. Rode antes "npm run seed:catalogo".`);
            continue;
        }
        const { pedido, repetido } = await servicoPedidos.criarPedido(cliente.id_usuario, { itens },
            { chaveIdempotencia: definicao.chave });
        // Leva o pedido até o status desejado (também completa uma execução anterior interrompida no meio).
        let atual = pedido;
        if (definicao.status === 'Cancelado') {
            if (atual.status !== 'Cancelado') {
                atual = await servicoPedidos.cancelarPedido(atual.id_pedido, usuarioEquipe, definicao.motivo);
            }
        } else {
            while (atual.status !== definicao.status && servicoPedidos.PROXIMO_STATUS[atual.status]) {
                atual = await servicoPedidos.avancarStatus(atual.id_pedido, servicoPedidos.PROXIMO_STATUS[atual.status], usuarioEquipe);
            }
        }
        log(`${repetido ? 'existente' : 'criado   '} pedido   #${atual.id_pedido} ${atual.status}`);
    }
}

async function semearDemo({ log = console.log } = {}) {
    await semearConfiguracoes(log);
    await semearBanners(log);
    await semearCampanha(log);
    await semearPedidos(log);
}

async function principal() {
    const motivo = verificarAmbienteSeguro();
    if (motivo) {
        console.error(`Recusado: ${motivo}`);
        process.exitCode = 1;
        return;
    }
    const sequelize = require('../db/conn');
    try {
        await semearDemo();
    } finally {
        await sequelize.close();
    }
}

if (require.main === module) {
    principal().catch((erro) => {
        console.error(erro.message);
        process.exitCode = 1;
    });
}

module.exports = { semearDemo, verificarAmbienteSeguro, CONFIGURACOES, BANNERS, CAMPANHA, PEDIDOS };
