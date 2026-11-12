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

const DEZENOVE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const BRASILEIRO = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Data e hora de planilha no horário de São Paulo (UTC-3, sem horário de verão): "2026-11-10 08:30:15",
 * "2026-11-10T08:30", "10/11/2026 08:30" ou só a data (vale 00:00). Com fuso explícito ("Z" ou "-03:00") respeita o fuso.
 * Devolve a Date, ou null se o texto não for uma data e hora válidas.
 */
function lerDataHoraSaoPaulo(texto) {
    const valor = String(texto ?? '').trim();
    if (/([zZ]|[+-]\d{2}:\d{2})$/.test(valor) && DEZENOVE.test(valor.replace(/([zZ]|[+-]\d{2}:\d{2})$/, ''))) {
        const data = new Date(valor.replace(' ', 'T'));
        return Number.isNaN(data.getTime()) ? null : data;
    }
    let ano, mes, dia, hora, minuto, segundo;
    const iso = DEZENOVE.exec(valor);
    const br = BRASILEIRO.exec(valor);
    if (iso) [, ano, mes, dia, hora, minuto, segundo] = iso;
    else if (br) [, dia, mes, ano, hora, minuto, segundo] = br;
    else return null;
    const [a, m, d, h, mi, s] = [ano, mes, dia, hora || 0, minuto || 0, segundo || 0].map(Number);
    if (h > 23 || mi > 59 || s > 59) return null;
    const data = new Date(Date.UTC(a, m - 1, d, h + 3, mi, s));
    // Recusa datas que o JavaScript "corrige" (31/02 virando 03/03).
    const conferida = new Date(data.getTime() - 3 * 60 * 60 * 1000);
    if (conferida.getUTCFullYear() !== a || conferida.getUTCMonth() !== m - 1 || conferida.getUTCDate() !== d) return null;
    return data;
}

module.exports = { lerDataHora, lerDataHoraSaoPaulo };
