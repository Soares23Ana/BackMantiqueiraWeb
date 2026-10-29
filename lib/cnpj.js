// CNPJ alfanumérico (Receita Federal, a partir de julho de 2026): 12 posições com letras ou números
// e 2 dígitos verificadores numéricos. Os CNPJs só com números continuam válidos.

function somenteDigitos(valor) {
    return String(valor ?? '').replace(/\D/g, '');
}

// Maiúsculas, só [0-9A-Z]: "12.abc.345/01de-35" vira "12ABC34501DE35".
function normalizarCnpj(valor) {
    return String(valor ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

// Módulo 11 com o valor de cada caractere = código ASCII - 48 (dígitos valem 0-9, "A" vale 17, "Z" vale 42).
function digitoVerificador(base) {
    const pesos = base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((total, caractere, indice) => total + (caractere.charCodeAt(0) - 48) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

function cnpjValido(valor) {
    const cnpj = normalizarCnpj(valor);
    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) {
        return false;
    }
    const primeiro = digitoVerificador(cnpj.slice(0, 12));
    const segundo = digitoVerificador(cnpj.slice(0, 12) + primeiro);
    return cnpj.endsWith(`${primeiro}${segundo}`);
}

function formatarCnpj(valor) {
    return normalizarCnpj(valor).replace(/^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

module.exports = { somenteDigitos, normalizarCnpj, cnpjValido, formatarCnpj };
