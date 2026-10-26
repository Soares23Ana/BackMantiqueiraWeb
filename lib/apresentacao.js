const { formatarCnpj } = require('./cnpj');

// CNPJ sempre formatado nas respostas ("11.222.333/0001-81"); no banco fica só com dígitos.
function cnpjParaResposta(cnpj) {
    return cnpj ? formatarCnpj(cnpj) : null;
}

/**
 * Formato único do cliente nas respostas da equipe (clientes e pedidos).
 * nome_exibicao: razão social quando houver; senão, o nome do responsável.
 */
function apresentarCliente(usuario) {
    const dados = typeof usuario.toJSON === 'function' ? usuario.toJSON() : { ...usuario };
    return {
        ...dados,
        nome_exibicao: dados.razao_social || dados.nome,
        cnpj: cnpjParaResposta(dados.cnpj)
    };
}

module.exports = { cnpjParaResposta, apresentarCliente };
