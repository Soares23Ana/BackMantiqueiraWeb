// Remove acentos e padroniza para comparação ("Loção" -> "locao").
function semAcento(texto) {
    return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function gerarSlug(texto) {
    return semAcento(texto)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

// Escapa os curingas do LIKE para que "%" e "_" digitados sejam tratados como texto.
function escaparLike(texto) {
    return String(texto).replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

// Quebra a busca em termos. A comparação sem acento fica a cargo da collation utf8mb4_0900_ai_ci do MySQL.
function termosDeBusca(busca, maximo = 6) {
    return String(busca)
        .split(/[\s,;]+/)
        .map((termo) => termo.trim())
        .filter((termo) => termo.length >= 2 || /\d/.test(termo))
        .slice(0, maximo);
}

// Caminho interno ("/img/x.webp") ou URL http/https. Recusa "//host", barras invertidas e caracteres de controle.
function ehCaminhoOuUrlSegura(valor) {
    if (/^\/(?!\/)/.test(valor)) {
        return !/[\\\u0000-\u001f]/.test(valor);
    }
    try {
        const url = new URL(valor);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

module.exports = { semAcento, gerarSlug, escaparLike, termosDeBusca, ehCaminhoOuUrlSegura };
