const { Op } = require('sequelize');
const sequelize = require('../db/conn');
const { Endereco, ItemPedido, Pedido, Produto, Usuario } = require('../models');
const logger = require('../lib/logger');

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

async function listarClientes(req, res) {
    const pagina = req.query.pagina === undefined ? 1 : Number(req.query.pagina);
    const limite = req.query.limite === undefined ? 20 : Number(req.query.limite);
    if (!Number.isSafeInteger(pagina) || pagina < 1 ||
        !Number.isSafeInteger(limite) || limite < 1 || limite > 100 ||
        !Number.isSafeInteger((pagina - 1) * limite)) {
        return res.status(400).json({ mensagem: 'Parâmetros de paginação inválidos.' });
    }

    const busca = typeof req.query.busca === 'string' ? req.query.busca.trim() : '';
    if (busca.length > 100) {
        return res.status(400).json({ mensagem: 'A busca deve ter no máximo 100 caracteres.' });
    }
    const where = { tipo: 'cliente' };
    if (busca) {
        where[Op.or] = [
            { nome: { [Op.like]: `%${busca}%` } },
            { razao_social: { [Op.like]: `%${busca}%` } },
            { cnpj_cpf: { [Op.like]: `%${busca}%` } }
        ];
    }

    try {
        const resultado = await Usuario.findAndCountAll({
            where,
            attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj_cpf', 'email', 'telefone', 'criado_em'],
            limit: limite,
            offset: (pagina - 1) * limite,
            order: [['nome', 'ASC']]
        });
        return res.status(200).json({
            clientes: resultado.rows,
            paginacao: {
                pagina,
                limite,
                total: resultado.count,
                totalPaginas: Math.ceil(resultado.count / limite)
            }
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
            attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj_cpf', 'email', 'telefone', 'criado_em'],
            include: [
                { model: Endereco, as: 'enderecos', attributes: { exclude: ['id_usuario'] } },
                {
                    model: Pedido,
                    as: 'pedidosComoCliente',
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
                    quantidadeSolicitada: 0
                };
                atual.quantidadeSolicitada += item.quantidade;
                quantidadePorProduto.set(idProduto, atual);
            }
        }
        const produtosMaisSolicitados = [...quantidadePorProduto.values()]
            .sort((a, b) => b.quantidadeSolicitada - a.quantidadeSolicitada ||
                (a.nome || '').localeCompare(b.nome || ''));

        return res.status(200).json({
            cliente: {
                id_usuario: clienteJson.id_usuario,
                nome: clienteJson.nome,
                razao_social: clienteJson.razao_social,
                cnpj_cpf: clienteJson.cnpj_cpf,
                email: clienteJson.email,
                telefone: clienteJson.telefone,
                criado_em: clienteJson.criado_em,
                enderecos: clienteJson.enderecos
            },
            historicoPedidos: clienteJson.pedidosComoCliente,
            produtosMaisSolicitados
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
    const camposPermitidos = ['razao_social', 'cnpj_cpf', 'telefone', 'enderecos'];
    const camposNaoPermitidos = Object.keys(dados).filter((campo) => !camposPermitidos.includes(campo));
    if (camposNaoPermitidos.length > 0) {
        return res.status(400).json({ mensagem: `Campo não permitido: ${camposNaoPermitidos[0]}.` });
    }
    if (Object.keys(dados).length === 0) {
        return res.status(400).json({ mensagem: 'Informe ao menos um dado operacional para atualizar.' });
    }

    const dadosCliente = {};
    const limitesCliente = { razao_social: 150, cnpj_cpf: 18, telefone: 20 };
    for (const campo of ['razao_social', 'cnpj_cpf', 'telefone']) {
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
            attributes: ['id_usuario', 'nome', 'razao_social', 'cnpj_cpf', 'email', 'telefone'],
            include: [{ model: Endereco, as: 'enderecos', attributes: { exclude: ['id_usuario'] } }]
        });
        return res.status(200).json({
            mensagem: 'Dados operacionais do cliente atualizados.',
            cliente: clienteAtualizado
        });
    } catch (erro) {
        if (erro.status === 404) {
            return res.status(404).json({ mensagem: erro.message });
        }
        logger.error('Erro ao atualizar cliente.', { erro });
        return res.status(500).json({ mensagem: 'Erro ao atualizar cliente.' });
    }
}

module.exports = { listarClientes, obterDetalhesCliente, atualizarCliente };
