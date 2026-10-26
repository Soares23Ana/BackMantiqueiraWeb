// Erro de negócio com status HTTP e código estável para o front tratar.
class ErroApi extends Error {
    constructor(status, codigo, mensagem, detalhes) {
        super(mensagem);
        this.name = 'ErroApi';
        this.status = status;
        this.codigo = codigo;
        this.detalhes = detalhes;
    }
}

const CODIGO_POR_STATUS = {
    400: 'REQUISICAO_INVALIDA',
    401: 'NAO_AUTENTICADO',
    403: 'ACESSO_NEGADO',
    404: 'NAO_ENCONTRADO',
    409: 'CONFLITO',
    413: 'CORPO_MUITO_GRANDE',
    422: 'VALIDACAO',
    429: 'LIMITE_REQUISICOES',
    500: 'ERRO_INTERNO',
    503: 'SERVICO_INDISPONIVEL'
};

const MENSAGEM_POR_STATUS = {
    400: 'Requisição inválida.',
    401: 'Sessão inválida ou expirada.',
    403: 'Acesso negado.',
    404: 'Recurso não encontrado.',
    409: 'Conflito com o estado atual do recurso.',
    429: 'Muitas requisições enviadas. Tente novamente em instantes.',
    500: 'Erro interno no servidor.',
    503: 'Serviço temporariamente indisponível.'
};

function codigoPorStatus(status) {
    return CODIGO_POR_STATUS[status] || (status >= 500 ? 'ERRO_INTERNO' : 'REQUISICAO_INVALIDA');
}

function mensagemPorStatus(status) {
    return MENSAGEM_POR_STATUS[status] || (status >= 500 ? MENSAGEM_POR_STATUS[500] : MENSAGEM_POR_STATUS[400]);
}

// Monta o corpo padrão { sucesso:false, mensagem, codigo, detalhes? }.
function corpoErro(status, { mensagem, codigo, detalhes } = {}) {
    return {
        sucesso: false,
        mensagem: mensagem || mensagemPorStatus(status),
        codigo: codigo || codigoPorStatus(status),
        ...(detalhes !== undefined && { detalhes })
    };
}

module.exports = { ErroApi, corpoErro, codigoPorStatus, mensagemPorStatus };
