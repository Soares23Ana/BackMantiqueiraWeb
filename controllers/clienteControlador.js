const { Op, UniqueConstraintError } = require('sequelize');
const { cnpjValido, somenteDigitos } = require('../lib/cnpj');
const { lerPaginacao, montarPaginacao } = require('../lib/paginacao');
const { apresentarCliente } = require('../lib/apresentacao');
const sequelize = require('../db/conn');
const { Endereco, ItemPedido, Pedido, Produto, Usuario } = require('../models');
const logger = require('../lib/logger');
const bcrypt = require('bcrypt');
const { ErroApi } = require('../lib/erros');
const { CUSTO_BCRYPT } = require('./usuarioControlador');
const { agoraParaTrocaDeSenha } = require('../models/Usuario');

const CAMPOS_ENDERECO = [
    'cep',
    'logradouro',
    'numero',
    'complemento',
    'bairro',
    'cidade',
    'estado',
    'referencia',
    'principal'
];
const LIMITES_ENDERECO = {
    cep: 9,
    logradouro: 150,
    numero: 20,
    complemento: 100,
    bairro: 100,
    cidade: 100,
    estado: 2,
    referencia: 200
};

function obterIdCliente(valor) {
    const id = Number(valor);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizarEnderecos(enderecos) {
    if (!Array.isArray(enderecos) || enderecos.length === 0 || enderecos.length > 50) {
        return { erro: 'Informe de 1 a 50 endereços.' };
    }

    const normalizados = [];
    for (const endereco of enderecos) {
        if (!endereco || typeof endereco !== 'object' || Array.isArray(endereco)) {
            return { erro: 'Cada endereço deve ser um objeto válido.' };
        }
        const camposNaoPermitidos = Object.keys(endereco).filter(
            (campo) => campo !== 'id_endereco' && !CAMPOS_ENDERECO.includes(campo)
        );
        if (camposNaoPermitidos.length > 0) {
            return { erro: `Campo de endereço não permitido: ${camposNaoPermitidos[0]}.` };
        }
        const ehNovoEndereco = endereco.id_endereco === undefined;
        for (const campo of ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado']) {
            if (ehNovoEndereco && (typeof endereco[campo] !== 'string' || !endereco[campo].trim())) {
                return { erro: `O campo ${campo} é obrigatório em cada endereço novo.` };
            }
        }
        for (const campo of Object.keys(LIMITES_ENDERECO)) {
            const valor = endereco[campo];
            if (valor === undefined || valor === null) continue;
            if (typeof valor !== 'string' || valor.length > LIMITES_ENDERECO[campo]) {
                return { erro: `O campo ${campo} deve ser texto com até ${LIMITES_ENDERECO[campo]} caracteres.` };
            }
            if (['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado'].includes(campo) && !valor.trim()) {
                return { erro: `O campo ${campo} não pode ficar vazio.` };
            }
        }
        if (Object.keys(endereco).length === (ehNovoEndereco ? 0 : 1)) {
            return { erro: 'Informe ao menos um campo para atualizar o endereço.' };
        }
        if (endereco.principal !== undefined && typeof endereco.principal !== 'boolean') {
            return { erro: 'O campo principal do endereço deve ser booleano.' };
        }
        if (endereco.id_endereco !== undefined &&
            (!Number.isSafeInteger(Number(endereco.id_endereco)) || Number(endereco.id_endereco) <= 0)) {
            return { erro: 'Identificador de endereço inválido.' };
        }
        normalizados.push(Object.fromEntries(
            CAMPOS_ENDERECO
                .filter((campo) => endereco[campo] !== undefined)
                .map((campo) => [campo, typeof endereco[campo] === 'string'
                    ? endereco[campo].trim()
                    : endereco[campo]])
        ));
        normalizados[normalizados.length - 1].id_endereco = endereco.id_endereco === undefined
            ? null
            : Number(endereco.id_endereco);
    }
    return { enderecos: normalizados };
}

// Cidade do endereço principal (o mesmo critério do checkout) e pedidos não cancelados do cliente.
const CIDADE_PRINCIPAL_SQL = `SELECT e.cidade FROM enderecos e WHERE e.id_usuario = Usuario.id_usuario
    ORDER BY e.principal DESC, e.id_endereco ASC LIMIT 1`;
const TOTAL_PEDIDOS_SQL = `SELECT COUNT(*) FROM pedidos p WHERE p.id_cliente = Usuario.id_usuario AND p.status <> 'Cancelado'`;
const ORDENACOES_CLIENTES = {
    nome: [['nome', 'ASC'], ['id_usuario', 'ASC']],
    mais_pedidos: [[sequelize.literal('total_pedidos'), 'DESC'], ['nome', 'ASC'], ['id_usuario', 'ASC']]
};

/**
 * GET /clientes (equipe): busca em nome, razão social, e-mail, CNPJ e cidade do endereço principal.
 * ordenar=nome (padrão) ou mais_pedidos (quem tem mais pedidos não cancelados primeiro).
 */
async function listarClientes(req, res) {
    const paginacao = lerPaginacao(req.query, { limitePadrao: 20, limiteMaximo: 100 });

    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
    if (busca.length > 100) {
        return res.status(400).json({ mensagem: 'A busca deve ter no máximo 100 caracteres.' });
    }
    const ordenar = req.query.ordenar || 'nome';
    if (!ORDENACOES_CLIENTES[ordenar]) {
        throw new ErroApi(400, 'FILTRO_INVALIDO', `ordenar deve ser: ${Object.keys(ORDENACOES_CLIENTES).join(', ')}.`);
    }
    const where = { tipo: 'cliente' };
    if (busca) {
        // O CNPJ é gravado só com dígitos; "11.222.333" também encontra "11222333...".
        const digitos = somenteDigitos(busca);
        where[Op.or] = [
            { nome: { [Op.like]: `%${busca}%` } },
            { razao_social: { [Op.like]: `%${busca}%` } },
            { email: { [Op.like]: `%${busca}%` } },
            sequelize.where(sequelize.literal(`(${CIDADE_PRINCIPAL_SQL})`), { [Op.like]: `%${busca}%` }),
            ...(digitos.length >= 2 ? [{ cnpj: { [Op.like]: `%${digitos}%` } }] : [])
        ];
    }
    // Clientes que não conseguem entrar pelo CNPJ (sem CNPJ ou com CNPJ pendente da migração 004).
    if (req.query.sem_cnpj === 'true') {
        where.cnpj = null;
    }

    try {
        const resultado = await Usuario.findAndCountAll({
            where,
            attributes: [
                'id_usuario', 'nome', 'razao_social', 'cnpj', 'cnpj_original', 'email', 'telefone', 'ativo', 'criado_em',
                [sequelize.literal(`(${CIDADE_PRINCIPAL_SQL})`), 'cidade'],
                [sequelize.literal(`(${TOTAL_PEDIDOS_SQL})`), 'total_pedidos']
            ],
            limit: paginacao.limite,
            offset: paginacao.offset,
            order: ORDENACOES_CLIENTES[ordenar]
        });
        return res.status(200).json({
            clientes: resultado.rows.map((cliente) => {
                const dados = apresentarCliente(cliente);
                return { ...dados, total_pedidos: Number(dados.total_pedidos) };
            }),
            paginacao: montarPaginacao(resultado.count, paginacao)
        });
    } catch (erro) {
        logger.error('Erro ao listar clientes.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao listar clientes.' });
    }
}

async function obterDetalhesCliente(req, res) {
    const idCliente = obterIdCliente(req.params.id);
    if (!idCliente) {
        return res.status(400).json({ mensagem: 'Identificador de cliente inválido.' });
    }

    try {
        const cliente = await Usuario.findOne({
            where: { id_usuario: idCliente, tipo: 'cliente' },
            attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj', 'email', 'telefone', 'ativo', 'criado_em'],
            include: [
                { model: Endereco, as: 'enderecos', attributes: { exclude: ['id_usuario'] } },
                {
                    model: Pedido,
                    as: 'pedidosComoCliente',
                    attributes: { exclude: ['chave_idempotencia'] },
                    separate: true,
                    order: [['data_pedido', 'DESC']],
                    include: [{
                        model: ItemPedido,
                        as: 'itens',
                        attributes: ['id_pedido', 'id_produto', 'quantidade'],
                        include: [{
                            model: Produto,
                            as: 'produto',
                            attributes: ['id_produto', 'nome']
                        }]
                    }]
                }
            ]
        });
        if (!cliente) {
            return res.status(404).json({ mensagem: 'Cliente não encontrado.' });
        }

        const clienteJson = cliente.toJSON();
        const quantidadePorProduto = new Map();
        for (const pedido of clienteJson.pedidosComoCliente) {
            if (pedido.status === 'Cancelado') continue;
            for (const item of pedido.itens) {
                const idProduto = item.id_produto;
                const atual = quantidadePorProduto.get(idProduto) || {
                    id_produto: idProduto,
                    nome: item.produto ? item.produto.nome : null,
                    quantidade_solicitada: 0
                };
                atual.quantidade_solicitada += item.quantidade;
                quantidadePorProduto.set(idProduto, atual);
            }
        }
        const produtosMaisSolicitados = [...quantidadePorProduto.values()]
            .sort((a, b) => b.quantidade_solicitada - a.quantidade_solicitada ||
                (a.nome || '').localeCompare(b.nome || ''));

        return res.status(200).json({
            cliente: apresentarCliente({
                id_usuario: clienteJson.id_usuario,
                nome: clienteJson.nome,
                razao_social: clienteJson.razao_social,
                cnpj: clienteJson.cnpj,
                email: clienteJson.email,
                telefone: clienteJson.telefone,
                ativo: clienteJson.ativo,
                criado_em: clienteJson.criado_em,
                enderecos: clienteJson.enderecos
            }),
            historico_pedidos: clienteJson.pedidosComoCliente,
            produtos_mais_solicitados: produtosMaisSolicitados
        });
    } catch (erro) {
        logger.error('Erro ao obter detalhes do cliente.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao obter detalhes do cliente.' });
    }
}

async function atualizarCliente(req, res) {
    const idCliente = obterIdCliente(req.params.id);
    if (!idCliente) {
        return res.status(400).json({ mensagem: 'Identificador de cliente inválido.' });
    }

    const dados = req.body || {};
    if (typeof dados !== 'object' || Array.isArray(dados)) {
        return res.status(400).json({ mensagem: 'O corpo da requisição deve ser um objeto.' });
    }
    const camposPermitidos = ['razao_social', 'cnpj', 'telefone', 'enderecos', 'ativo'];
    const camposNaoPermitidos = Object.keys(dados).filter((campo) => !camposPermitidos.includes(campo));
    if (camposNaoPermitidos.length > 0) {
        return res.status(400).json({ mensagem: `Campo não permitido: ${camposNaoPermitidos[0]}.` });
    }
    if (Object.keys(dados).length === 0) {
        return res.status(400).json({ mensagem: 'Informe ao menos um dado operacional para atualizar.' });
    }

    const dadosCliente = {};
    const limitesCliente = { razao_social: 150, cnpj: 18, telefone: 20 };
    for (const campo of ['razao_social', 'cnpj', 'telefone']) {
        if (dados[campo] !== undefined) {
            if (dados[campo] !== null && typeof dados[campo] !== 'string') {
                return res.status(400).json({ mensagem: `O campo ${campo} deve ser texto ou nulo.` });
            }
            const valor = typeof dados[campo] === 'string' ? dados[campo].trim() : null;
            if (valor && valor.length > limitesCliente[campo]) {
                return res.status(400).json({
                    mensagem: `O campo ${campo} deve ter no máximo ${limitesCliente[campo]} caracteres.`
                });
            }
            dadosCliente[campo] = valor || null;
        }
    }
    // O CNPJ é a credencial de login do cliente: precisa ser válido e é gravado só com dígitos.
    if (dados.cnpj !== undefined) {
        const cnpj = somenteDigitos(dados.cnpj);
        if (!cnpjValido(cnpj)) {
            return res.status(422).json({
                mensagem: 'CNPJ inválido.',
                codigo: 'VALIDACAO',
                detalhes: [{ campo: 'cnpj', mensagem: 'CNPJ inválido.' }]
            });
        }
        dadosCliente.cnpj = cnpj;
        // Corrigido o CNPJ, a pendência da migração deixa de existir.
        dadosCliente.cnpj_original = null;
    }
    if (dados.ativo !== undefined) {
        if (typeof dados.ativo !== 'boolean') {
            return res.status(400).json({ mensagem: 'O campo ativo deve ser true ou false.' });
        }
        dadosCliente.ativo = dados.ativo;
    }
    const resultadoEnderecos = dados.enderecos === undefined
        ? null
        : normalizarEnderecos(dados.enderecos);
    if (resultadoEnderecos && resultadoEnderecos.erro) {
        return res.status(400).json({ mensagem: resultadoEnderecos.erro });
    }

    try {
        const cliente = await sequelize.transaction(async (transacao) => {
            const registro = await Usuario.findOne({
                where: { id_usuario: idCliente, tipo: 'cliente' },
                transaction: transacao,
                lock: transacao.LOCK.UPDATE
            });
            if (!registro) return null;

            if (Object.keys(dadosCliente).length > 0) {
                await registro.update(dadosCliente, { transaction: transacao });
            }

            if (resultadoEnderecos) {
                for (const endereco of resultadoEnderecos.enderecos) {
                    const { id_endereco: idEndereco, ...atributos } = endereco;
                    if (idEndereco) {
                        const existente = await Endereco.findOne({
                            where: { id_endereco: idEndereco, id_usuario: idCliente },
                            transaction: transacao,
                            lock: transacao.LOCK.UPDATE
                        });
                        if (!existente) {
                            const erro = new Error('Endereço não encontrado para este cliente.');
                            erro.status = 404;
                            throw erro;
                        }
                        if (atributos.principal === true) {
                            await Endereco.update(
                                { principal: false },
                                {
                                    where: {
                                        id_usuario: idCliente,
                                        id_endereco: { [Op.ne]: idEndereco }
                                    },
                                    transaction: transacao
                                }
                            );
                        }
                        await existente.update(atributos, { transaction: transacao });
                    } else {
                        if (atributos.principal === true) {
                            await Endereco.update(
                                { principal: false },
                                { where: { id_usuario: idCliente }, transaction: transacao }
                            );
                        }
                        await Endereco.create(
                            { ...atributos, id_usuario: idCliente },
                            { transaction: transacao }
                        );
                    }
                }
            }
            return registro;
        });
        if (!cliente) {
            return res.status(404).json({ mensagem: 'Cliente não encontrado.' });
        }
        const clienteAtualizado = await Usuario.findOne({
            where: { id_usuario: idCliente, tipo: 'cliente' },
            attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj', 'email', 'telefone', 'ativo'],
            include: [{ model: Endereco, as: 'enderecos', attributes: { exclude: ['id_usuario'] } }]
        });
        return res.status(200).json({
            mensagem: 'Dados operacionais do cliente atualizados.',
            cliente: apresentarCliente(clienteAtualizado)
        });
    } catch (erro) {
        if (erro.status === 404) {
            return res.status(404).json({ mensagem: erro.message });
        }
        if (erro instanceof UniqueConstraintError) {
            return res.status(409).json({ mensagem: 'Este CNPJ já pertence a outro cliente.', codigo: 'CNPJ_JA_CADASTRADO' });
        }
        logger.error('Erro ao atualizar cliente.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao atualizar cliente.' });
    }
}

/**
 * PUT /clientes/:id/senha { senha } (equipe): define uma senha temporária para o cliente que esqueceu a dele.
 * Só o hash é gravado; não há envio de e-mail. A equipe informa a senha ao cliente, que deve trocá-la
 * em PATCH /minha-conta/senha.
 */
async function definirSenhaTemporaria(req, res) {
    const idCliente = obterIdCliente(req.params.id);
    if (!idCliente) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', 'Identificador de cliente inválido.');
    }
    const corpo = req.body || {};
    const extras = Object.keys(corpo).filter((campo) => campo !== 'senha');
    if (extras.length > 0 || typeof corpo.senha !== 'string' || corpo.senha.length < 8 || corpo.senha.length > 72) {
        const mensagem = extras.length > 0 ? `Campo não permitido: ${extras[0]}.` : 'A senha deve ter entre 8 e 72 caracteres.';
        throw new ErroApi(422, 'VALIDACAO', mensagem, [{ campo: extras[0] || 'senha', mensagem }]);
    }
    const cliente = await Usuario.findOne({ where: { id_usuario: idCliente, tipo: 'cliente' }, attributes: ['id_usuario'] });
    if (!cliente) {
        throw new ErroApi(404, 'NAO_ENCONTRADO', 'Cliente não encontrado.');
    }
    await cliente.update({ senha: await bcrypt.hash(corpo.senha, CUSTO_BCRYPT), senha_alterada_em: agoraParaTrocaDeSenha() });
    logger.info('Senha temporária definida para cliente.', { id_cliente: idCliente, por: req.usuario.id });
    return res.status(200).json({
        mensagem: 'Senha temporária definida. Informe-a ao cliente e oriente a troca em "Minha conta".'
    });
}

module.exports = { listarClientes, obterDetalhesCliente, atualizarCliente, definirSenhaTemporaria };
