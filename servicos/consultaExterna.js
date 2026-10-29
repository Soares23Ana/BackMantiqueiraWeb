// Chamadas a serviços públicos (CEP, CNPJ) com fetch nativo, tempo máximo e cache em memória.

// Falha do serviço (fora do ar, tempo esgotado, resposta inesperada): quem chama tenta o próximo serviço.
class ServicoIndisponivel extends Error {}

/**
 * GET de um JSON. Devolve { status, corpo } para respostas 2xx e 4xx (o 404 de "não encontrado" é uma
 * resposta válida); lança ServicoIndisponivel em erro de rede, tempo esgotado, 5xx ou corpo que não é JSON.
 */
async function buscarJson(url, { tempoMaximoMs }) {
    let resposta;
    try {
        resposta = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(tempoMaximoMs)
        });
    } catch (erro) {
        throw new ServicoIndisponivel(`${new URL(url).host}: ${erro.name === 'TimeoutError' ? 'tempo esgotado' : erro.message}`);
    }
    if (resposta.status >= 500) {
        throw new ServicoIndisponivel(`${new URL(url).host}: HTTP ${resposta.status}`);
    }
    try {
        return { status: resposta.status, corpo: await resposta.json() };
    } catch {
        throw new ServicoIndisponivel(`${new URL(url).host}: resposta não é JSON (HTTP ${resposta.status})`);
    }
}

// Cache simples por chave, com validade por item e tamanho máximo (os mais antigos saem primeiro).
function criarCache({ maximo = 5000 } = {}) {
    const itens = new Map();
    return {
        obter(chave) {
            const item = itens.get(chave);
            if (!item) return undefined;
            if (item.expiraEm <= Date.now()) {
                itens.delete(chave);
                return undefined;
            }
            return item.valor;
        },
        guardar(chave, valor, validadeMs) {
            itens.delete(chave);
            itens.set(chave, { valor, expiraEm: Date.now() + validadeMs });
            if (itens.size > maximo) itens.delete(itens.keys().next().value);
        },
        limpar() {
            itens.clear();
        }
    };
}

module.exports = { buscarJson, criarCache, ServicoIndisponivel };
