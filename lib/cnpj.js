// CNPJ: só dígitos e dígitos verificadores válidos.

function somenteDigitos(valor) {
    return String(valor ?? '').replace(/\D/g, '');
}

function digitoVerificador(base) {
    const pesos = base.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((total, digito, indice) => total + Number(digito) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

function cnpjValido(valor) {
    const cnpj = somenteDigitos(valor);
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) {
        return false;
    }
    const primeiro = digitoVerificador(cnpj.slice(0, 12));
    const segundo = digitoVerificador(cnpj.slice(0, 12) + primeiro);
    return cnpj.endsWith(`${primeiro}${segundo}`);
}

function formatarCnpj(valor) {
    return somenteDigitos(valor).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

module.exports = { somenteDigitos, cnpjValido, formatarCnpj };
