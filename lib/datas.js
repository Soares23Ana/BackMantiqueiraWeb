/**
 * Lê uma data/hora ISO vinda do front. Sem fuso explícito ("2026-11-01T08:00" ou "2026-11-01"),
 * considera o horário de Brasília. Devolve undefined quando o campo não veio, null quando veio vazio,
 * e registra o erro em "erros" quando o formato é inválido.
 */
function lerDataHora(valor, campo, erros) {
    if (valor === undefined) return undefined;
    if (valor === null || valor === '') return null;
    const texto = String(valor);
    const comFuso = /([zZ]|[+-]\d{2}:\d{2})$/.test(texto) ? texto : `${texto}${texto.length === 10 ? 'T00:00:00' : ''}-03:00`;
    const data = new Date(comFuso);
    if (!/^\d{4}-\d{2}-\d{2}/.test(texto) || Number.isNaN(data.getTime())) {
        erros.push({ campo, mensagem: `${campo} deve ser uma data ISO (ex.: 2026-11-01T08:00).` });
        return undefined;
    }
    return data;
}

module.exports = { lerDataHora };
