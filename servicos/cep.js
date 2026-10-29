// Consulta de CEP para preencher o endereço: BrasilAPI e, se ela falhar, ViaCEP.
// O cadastro não depende disto: o endereço digitado à mão continua aceito.
const logger = require('../lib/logger');
const { ErroApi } = require('../lib/erros');
const { buscarJson, criarCache, ServicoIndisponivel } = require('./consultaExterna');

const TEMPO_MAXIMO_MS = 4000;
const VALIDADE_ENCONTRADO_MS = 24 * 60 * 60 * 1000;
const VALIDADE_NAO_ENCONTRADO_MS = 5 * 60 * 1000;
const NAO_ENCONTRADO = Symbol('nao-encontrado');

const cache = criarCache();

// Cidades com CEP único não trazem rua nem bairro: o que o serviço não informar fica vazio.
const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

const SERVICOS = [
    {
        nome: 'brasilapi',
        url: (cep) => `https://brasilapi.com.br/api/cep/v1/${cep}`,
        // 200: { cep, state, city, neighborhood, street, service }; 404: nenhum provedor dela encontrou.
        interpretar: ({ status, corpo }) => {
            if (status === 404) return NAO_ENCONTRADO;
            if (status !== 200 || !corpo || !corpo.city) throw new ServicoIndisponivel(`brasilapi: HTTP ${status}`);
            return { logradouro: corpo.street, bairro: corpo.neighborhood, cidade: corpo.city, estado: corpo.state };
        }
    },
    {
        nome: 'viacep',
        url: (cep) => `https://viacep.com.br/ws/${cep}/json/`,
        // 200: { cep, logradouro, bairro, localidade, uf, ... }; CEP inexistente: 200 com { "erro": true }.
        interpretar: ({ status, corpo }) => {
            if (status === 200 && corpo && (corpo.erro === true || corpo.erro === 'true')) return NAO_ENCONTRADO;
            if (status !== 200 || !corpo || !corpo.localidade) throw new ServicoIndisponivel(`viacep: HTTP ${status}`);
            return { logradouro: corpo.logradouro, bairro: corpo.bairro, cidade: corpo.localidade, estado: corpo.uf };
        }
    }
];

function normalizarCep(valor) {
    const bruto = String(valor ?? '').trim();
    if (!/^\d{5}-?\d{3}$/.test(bruto)) {
        throw new ErroApi(422, 'VALIDACAO', 'Informe o CEP com 8 dígitos (com ou sem hífen).',
            [{ campo: 'cep', mensagem: 'Informe o CEP com 8 dígitos (com ou sem hífen).' }]);
    }
    return bruto.replace('-', '');
}

/**
 * Devolve { cep, logradouro, bairro, cidade, estado }. Lança 404 CEP_NAO_ENCONTRADO se algum serviço
 * disser que o CEP não existe e nenhum o encontrar, e 503 SERVICO_INDISPONIVEL se todos falharem.
 */
async function consultarCep(valor) {
    const cep = normalizarCep(valor);
    let resultado = cache.obter(cep);
    if (resultado === undefined) {
        let algumDisseNaoEncontrado = false;
        for (const servico of SERVICOS) {
            try {
                const encontrado = servico.interpretar(await buscarJson(servico.url(cep), { tempoMaximoMs: TEMPO_MAXIMO_MS }));
                if (encontrado === NAO_ENCONTRADO) {
                    algumDisseNaoEncontrado = true;
                    continue;
                }
                resultado = {
                    cep: `${cep.slice(0, 5)}-${cep.slice(5)}`,
                    logradouro: texto(encontrado.logradouro),
                    bairro: texto(encontrado.bairro),
                    cidade: texto(encontrado.cidade),
                    estado: texto(encontrado.estado).toUpperCase()
                };
                break;
            } catch (erro) {
                if (!(erro instanceof ServicoIndisponivel)) throw erro;
                logger.warn('Serviço de CEP falhou; tentando o próximo.', { servico: servico.nome, erro: erro.message });
            }
        }
        if (resultado) {
            cache.guardar(cep, resultado, VALIDADE_ENCONTRADO_MS);
        } else if (algumDisseNaoEncontrado) {
            resultado = NAO_ENCONTRADO;
            cache.guardar(cep, resultado, VALIDADE_NAO_ENCONTRADO_MS);
        } else {
            throw new ErroApi(503, 'SERVICO_INDISPONIVEL',
                'Não foi possível consultar o CEP agora. Tente novamente em instantes ou preencha o endereço à mão.');
        }
    }
    if (resultado === NAO_ENCONTRADO) {
        throw new ErroApi(404, 'CEP_NAO_ENCONTRADO', 'CEP não encontrado.');
    }
    return resultado;
}

module.exports = { consultarCep, limparCacheCep: () => cache.limpar() };
