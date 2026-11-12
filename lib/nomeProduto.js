const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO_DICIONARIO = path.join(__dirname, '..', 'config', 'abreviacoes.json');
// Unidades soltas ("ML", "KG"...) ficam como vieram; palavras com número ("200ML", "C/8") também.
const UNIDADES = new Set(['ML', 'L', 'LT', 'G', 'GR', 'KG', 'MG', 'M', 'CM', 'MM', 'UN', 'UND', 'UNID', 'CX', 'PCT', 'PC']);

let cache = { mtime: null, dicionario: null };

function normalizarDicionario(bruto) {
    return {
        abreviacoes: Object.fromEntries(Object.entries(bruto.abreviacoes || {}).map(([chave, valor]) => [chave.toUpperCase(), valor])),
        ambiguas: new Set((bruto.ambiguas || []).map((item) => item.toUpperCase())),
        minusculas: new Set((bruto.minusculas || []).map((item) => item.toLowerCase()))
    };
}

/**
 * Lê config/abreviacoes.json. O arquivo é relido quando muda (a equipe pode editá-lo sem reiniciar a API).
 * Sem o arquivo, a geração do nome só capitaliza e remove o "*" final.
 */
function carregarDicionario() {
    try {
        const { mtimeMs } = fs.statSync(ARQUIVO_DICIONARIO);
        if (cache.mtime !== mtimeMs) {
            cache = { mtime: mtimeMs, dicionario: normalizarDicionario(JSON.parse(fs.readFileSync(ARQUIVO_DICIONARIO, 'utf8'))) };
        }
        return cache.dicionario;
    } catch {
        return normalizarDicionario({});
    }
}

// Primeira letra de cada parte (separada por "-", "/" ou "(") em maiúscula e o resto em minúscula.
function capitalizar(palavra) {
    return palavra.toLowerCase().replace(/(^|[-/(])(\p{L})/gu, (_, inicio, letra) => inicio + letra.toUpperCase());
}

/**
 * Gera o nome de exibição a partir do nome do portfólio (ex.: "SAB.LIQ. PHEBO 250ML*" => "Sabonete Líquido Phebo 250ML").
 * - Expande as abreviações do dicionário (palavra inteira).
 * - NÃO expande as ambíguas (ED., RP., P., PRES., CHUP., AP.) nem outra abreviação desconhecida terminada em ponto:
 *   mantém a palavra capitalizada e a devolve em "pendentes".
 * - Capitalização de título, com as preposições em minúsculas (menos a primeira palavra); unidades e palavras com
 *   número ("200ML", "C/8") ficam como vieram; o "*" final é removido.
 * Devolve { nome, pendentes: [abreviação em maiúsculas] }.
 */
function gerarNomeExibicao(original, dicionario = carregarDicionario()) {
    const texto = String(original ?? '').trim().replace(/\*+\s*$/, '').trim();
    const pendentes = [];
    const palavras = texto.split(/\s+/).filter(Boolean).map((palavra, indice) => {
        const chave = palavra.toUpperCase();
        if (dicionario.abreviacoes[chave]) return dicionario.abreviacoes[chave];
        if (dicionario.ambiguas.has(chave) || (/\.$/.test(palavra) && palavra.length > 1 && !/\d/.test(palavra))) {
            pendentes.push(chave);
            return capitalizar(palavra);
        }
        if (/\d/.test(palavra) || UNIDADES.has(chave)) return palavra;
        if (indice > 0 && dicionario.minusculas.has(palavra.toLowerCase())) return palavra.toLowerCase();
        return capitalizar(palavra);
    });
    return { nome: palavras.join(' '), pendentes };
}

module.exports = { gerarNomeExibicao, carregarDicionario, normalizarDicionario };
