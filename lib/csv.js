// Leitor de CSV (RFC 4180): aspas, aspas duplicadas ("") e quebras de linha dentro de aspas.
// Detecta ";" ou "," pelo cabeçalho e ignora o BOM do Excel.

function detectarSeparador(primeiraLinha) {
    const pontoEVirgula = (primeiraLinha.match(/;/g) || []).length;
    const virgula = (primeiraLinha.match(/,/g) || []).length;
    return pontoEVirgula >= virgula ? ';' : ',';
}

function lerLinhas(conteudo, separador) {
    const linhas = [];
    let campos = [];
    let campo = '';
    let entreAspas = false;
    let numeroLinha = 1;
    let inicioRegistro = 1;

    for (let i = 0; i < conteudo.length; i += 1) {
        const caractere = conteudo[i];
        if (entreAspas) {
            if (caractere === '"') {
                if (conteudo[i + 1] === '"') {
                    campo += '"';
                    i += 1;
                } else {
                    entreAspas = false;
                }
            } else {
                if (caractere === '\n') numeroLinha += 1;
                campo += caractere;
            }
        } else if (caractere === '"' && campo === '') {
            entreAspas = true;
        } else if (caractere === separador) {
            campos.push(campo);
            campo = '';
        } else if (caractere === '\n' || caractere === '\r') {
            if (caractere === '\r' && conteudo[i + 1] === '\n') i += 1;
            campos.push(campo);
            linhas.push({ numero: inicioRegistro, campos });
            campos = [];
            campo = '';
            numeroLinha += 1;
            inicioRegistro = numeroLinha;
        } else {
            campo += caractere;
        }
    }
    if (entreAspas) {
        throw new Error(`Aspas não fechadas a partir da linha ${inicioRegistro}.`);
    }
    if (campo !== '' || campos.length > 0) {
        campos.push(campo);
        linhas.push({ numero: inicioRegistro, campos });
    }
    // Linhas totalmente vazias (ex.: final do arquivo) são descartadas.
    return linhas.filter((linha) => linha.campos.some((valor) => valor.trim() !== ''));
}

/**
 * Converte o CSV em { cabecalho, registros }, onde cada registro é { linha, valores: { coluna: texto } }.
 * Os nomes das colunas são normalizados para minúsculas sem espaços nas pontas.
 */
function lerCsv(conteudo) {
    const texto = String(conteudo).replace(/^﻿/, '');
    const primeiraLinha = texto.split(/\r?\n/, 1)[0] || '';
    const separador = detectarSeparador(primeiraLinha);
    const [cabecalhoBruto, ...dados] = lerLinhas(texto, separador);
    if (!cabecalhoBruto) {
        return { cabecalho: [], registros: [], separador };
    }
    const cabecalho = cabecalhoBruto.campos.map((coluna) => coluna.trim().toLowerCase());
    const registros = dados.map(({ numero, campos }) => ({
        linha: numero,
        excedente: campos.length > cabecalho.length,
        valores: Object.fromEntries(cabecalho.map((coluna, indice) => [coluna, (campos[indice] ?? '').trim()]))
    }));
    return { cabecalho, registros, separador };
}

module.exports = { lerCsv };
