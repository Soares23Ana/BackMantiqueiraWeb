// Consulta de CNPJ na Receita Federal: BrasilAPI e, se ela falhar, Minha Receita.
// Usada no cadastro (com VALIDAR_CNPJ_RECEITA=true) e em GET /cnpj/:cnpj.
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');
const { cnpjValido, normalizarCnpj, formatarCnpj } = require('../lib/cnpj');
const { buscarJson, criarCache, ServicoIndisponivel } = require('./consultaExterna');

const TEMPO_MAXIMO_MS = 5000;
const VALIDADE_ENCONTRADO_MS = 24 * 60 * 60 * 1000;
// Empresa recém-aberta pode demorar a aparecer na base: "não encontrado" vale pouco tempo.
const VALIDADE_NAO_ENCONTRADO_MS = 10 * 60 * 1000;
const NAO_ENCONTRADO = Symbol('nao-encontrado');

const cache = criarCache();

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

// Os dois serviços usam os mesmos nomes de campo: razao_social, nome_fantasia,
// descricao_situacao_cadastral, municipio e uf. CNPJ inexistente: 404. Formato recusado: 400.
function interpretar(nome) {
    return ({ status, corpo }) => {
        if (status === 404) return NAO_ENCONTRADO;
        // 400 com um CNPJ que a API considera válido (ex.: alfanumérico ainda não aceito pelo serviço):
        // não dá para afirmar que não existe; tenta o próximo.
        if (status !== 200 || !corpo || !corpo.razao_social) throw new ServicoIndisponivel(`${nome}: HTTP ${status}`);
        return corpo;
    };
}

const SERVICOS = [
    { nome: 'brasilapi', url: (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, interpretar: interpretar('brasilapi') },
    { nome: 'minhareceita', url: (cnpj) => `https://minhareceita.org/${cnpj}`, interpretar: interpretar('minhareceita') }
];

/**
 * Devolve { cnpj, razao_social, nome_fantasia, situacao, cidade, estado } ou null se o CNPJ não existir na Receita.
 * Lança ServicoIndisponivel se os dois serviços falharem. O CNPJ precisa já ser válido (cnpjValido).
 */
async function buscarNaReceita(valor) {
    const cnpj = normalizarCnpj(valor);
    let resultado = cache.obter(cnpj);
    if (resultado === undefined) {
        let algumDisseNaoEncontrado = false;
        for (const servico of SERVICOS) {
            try {
                const dados = servico.interpretar(await buscarJson(servico.url(cnpj), { tempoMaximoMs: TEMPO_MAXIMO_MS }));
                if (dados === NAO_ENCONTRADO) {
                    algumDisseNaoEncontrado = true;
                    continue;
                }
                resultado = {
                    cnpj: formatarCnpj(cnpj),
                    razao_social: texto(dados.razao_social),
                    nome_fantasia: texto(dados.nome_fantasia),
                    situacao: texto(dados.descricao_situacao_cadastral).toUpperCase(),
                    cidade: texto(dados.municipio),
                    estado: texto(dados.uf).toUpperCase()
                };
                break;
            } catch (erro) {
                if (!(erro instanceof ServicoIndisponivel)) throw erro;
                logger.warn('Serviço de CNPJ falhou; tentando o próximo.', { servico: servico.nome, erro: erro.message });
            }
        }
        if (resultado) {
            cache.guardar(cnpj, resultado, VALIDADE_ENCONTRADO_MS);
        } else if (algumDisseNaoEncontrado) {
            resultado = NAO_ENCONTRADO;
            cache.guardar(cnpj, resultado, VALIDADE_NAO_ENCONTRADO_MS);
        } else {
            throw new ServicoIndisponivel('Nenhum serviço de CNPJ respondeu.');
        }
    }
    return resultado === NAO_ENCONTRADO ? null : resultado;
}

// GET /cnpj/:cnpj: valida o formato e traduz o resultado em respostas HTTP.
async function consultarCnpj(valor) {
    if (!cnpjValido(valor)) {
        throw new ErroApi(422, 'VALIDACAO', 'CNPJ inválido.', [{ campo: 'cnpj', mensagem: 'CNPJ inválido.' }]);
    }
    let dados;
    try {
        dados = await buscarNaReceita(valor);
    } catch (erro) {
        if (!(erro instanceof ServicoIndisponivel)) throw erro;
        throw new ErroApi(503, 'SERVICO_INDISPONIVEL', 'Não foi possível consultar o CNPJ agora. Tente novamente em instantes.');
    }
    if (!dados) {
        throw new ErroApi(404, 'CNPJ_NAO_ENCONTRADO', 'CNPJ não encontrado na Receita Federal.');
    }
    return dados;
}

/**
 * Cadastro com VALIDAR_CNPJ_RECEITA=true: exige CNPJ existente e ATIVO e devolve a razão social da Receita.
 * Erros: 422 CNPJ_NAO_ENCONTRADO, 422 CNPJ_INATIVO, 503 SERVICO_INDISPONIVEL.
 */
async function validarCnpjParaCadastro(cnpj) {
    let dados;
    try {
        dados = await buscarNaReceita(cnpj);
    } catch (erro) {
        if (!(erro instanceof ServicoIndisponivel)) throw erro;
        throw new ErroApi(503, 'SERVICO_INDISPONIVEL', 'Não foi possível validar o CNPJ agora. Tente novamente em instantes.');
    }
    if (!dados) {
        const mensagem = 'CNPJ não encontrado na Receita Federal.';
        throw new ErroApi(422, 'CNPJ_NAO_ENCONTRADO', mensagem, [{ campo: 'cnpj', mensagem }]);
    }
    if (dados.situacao !== 'ATIVA') {
        const mensagem = `O CNPJ está com a situação "${dados.situacao || 'desconhecida'}" na Receita Federal. Só empresas com CNPJ ativo podem se cadastrar.`;
        throw new ErroApi(422, 'CNPJ_INATIVO', mensagem, [{ campo: 'cnpj', mensagem }]);
    }
    return { razaoSocial: dados.razao_social.slice(0, 150) };
}

module.exports = { consultarCnpj, validarCnpjParaCadastro, limparCacheReceita: () => cache.limpar() };
