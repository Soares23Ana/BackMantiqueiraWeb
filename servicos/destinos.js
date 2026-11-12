const { Op } = require('sequelize');
const { Produto, Categoria, Marca, Campanha } = require('../models');
const { ehCaminhoOuUrlSegura } = require('../lib/texto');

/**
 * Destino de um banner ou pop-up: onde o clique leva.
 * Gravado como tipo_destino + id_destino (+ link, só no tipo "link") e devolvido como
 * { tipo, id, link }, com o link interno já no formato das rotas do site.
 */
const TIPOS_DESTINO = ['nenhum', 'produto', 'categoria', 'marca', 'campanha', 'link'];

// Para cada tipo com id: como achar o registro e como montar o link a partir dele.
const REFERENCIAS = {
    produto: { buscar: (ids) => Produto.findAll({ where: { id_produto: { [Op.in]: ids } }, attributes: ['id_produto'] }), chave: 'id_produto', rotulo: 'Produto', link: (r) => `/produto/${r.id_produto}` },
    categoria: { buscar: (ids) => Categoria.findAll({ where: { id_categoria: { [Op.in]: ids } }, attributes: ['id_categoria', 'slug'] }), chave: 'id_categoria', rotulo: 'Categoria', link: (r) => `/categoria/${r.slug}` },
    campanha: { buscar: (ids) => Campanha.findAll({ where: { id_campanha: { [Op.in]: ids } }, attributes: ['id_campanha', 'slug'] }), chave: 'id_campanha', rotulo: 'Campanha', link: (r) => `/produtos?campanha=${r.slug}` },
    marca: { buscar: (ids) => Marca.findAll({ where: { id_marca: { [Op.in]: ids } }, attributes: ['id_marca', 'slug'] }), chave: 'id_marca', rotulo: 'Marca', link: (r) => `/marca/${r.slug}` }
};

/**
 * Valida os campos de destino do corpo (tipo_destino, id_destino, link) e devolve
 * { tipo_destino, id_destino, link }, ou undefined quando o corpo não toca no destino.
 * Só "link" informado (formato antigo) vale como tipo "link". Erros vão para "erros".
 */
async function validarDestino(corpo, erros, { atual = null } = {}) {
    const tocou = ['tipo_destino', 'id_destino', 'link'].some((campo) => corpo[campo] !== undefined);
    if (!tocou) return undefined;

    let tipo = corpo.tipo_destino;
    if (tipo === undefined) {
        // Sem tipo: só o link (formato antigo) vira tipo "link"; id_destino sozinho usa o tipo atual.
        tipo = corpo.link !== undefined && corpo.id_destino === undefined ? (corpo.link ? 'link' : 'nenhum') : (atual && atual.tipo_destino);
    }
    if (!TIPOS_DESTINO.includes(tipo)) {
        erros.push({ campo: 'tipo_destino', mensagem: `tipo_destino deve ser: ${TIPOS_DESTINO.join(', ')}.` });
        return undefined;
    }
    if (tipo === 'nenhum') {
        return { tipo_destino: 'nenhum', id_destino: null, link: null };
    }
    if (tipo === 'link') {
        const link = typeof corpo.link === 'string' ? corpo.link.trim() : (corpo.link === undefined && atual ? atual.link : '');
        if (!link || link.length > 2048 || !ehCaminhoOuUrlSegura(link)) {
            erros.push({ campo: 'link', mensagem: 'O link deve ser uma URL HTTP/HTTPS ou um caminho interno.' });
            return undefined;
        }
        return { tipo_destino: 'link', id_destino: null, link };
    }

    const referencia = REFERENCIAS[tipo];
    const bruto = corpo.id_destino === undefined && atual && atual.tipo_destino === tipo ? atual.id_destino : corpo.id_destino;
    const id = typeof bruto === 'string' && /^\d+$/.test(bruto) ? Number(bruto) : bruto;
    if (!Number.isSafeInteger(id) || id <= 0) {
        erros.push({ campo: 'id_destino', mensagem: `id_destino é obrigatório para o tipo ${tipo}.` });
        return undefined;
    }
    if (corpo.link !== undefined && corpo.link !== null && corpo.link !== '') {
        erros.push({ campo: 'link', mensagem: 'O link só vale para o tipo "link".' });
        return undefined;
    }
    if ((await referencia.buscar([id])).length === 0) {
        erros.push({ campo: 'id_destino', mensagem: `${referencia.rotulo} não encontrado(a): ${id}.` });
        return undefined;
    }
    return { tipo_destino: tipo, id_destino: id, link: null };
}

/**
 * Converte registros com { tipo_destino, id_destino, link } em [{ tipo, id, link }], na mesma ordem,
 * resolvendo o link interno com uma consulta por tipo. Se o alvo foi excluído, o link vem null.
 */
async function resolverDestinos(registros) {
    const encontrados = {};
    for (const [tipo, referencia] of Object.entries(REFERENCIAS)) {
        const ids = [...new Set(registros.filter((r) => r.tipo_destino === tipo && r.id_destino).map((r) => r.id_destino))];
        encontrados[tipo] = new Map(ids.length ? (await referencia.buscar(ids)).map((r) => [r[referencia.chave], r]) : []);
    }
    return registros.map((registro) => {
        const tipo = registro.tipo_destino || 'nenhum';
        if (tipo === 'nenhum') return { tipo, id: null, link: null };
        if (tipo === 'link') return { tipo, id: null, link: registro.link || null };
        const alvo = encontrados[tipo] && encontrados[tipo].get(registro.id_destino);
        return { tipo, id: registro.id_destino, link: alvo ? REFERENCIAS[tipo].link(alvo) : null };
    });
}

module.exports = { TIPOS_DESTINO, REFERENCIAS, validarDestino, resolverDestinos };
