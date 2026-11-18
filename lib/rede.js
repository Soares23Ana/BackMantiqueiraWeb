// Diagnóstico de rede e de endereço público, exibido só para a equipe em GET /saude/detalhado.
// Devolve apenas booleanos, o número de TRUST_PROXY e avisos em texto: nenhum valor de variável sensível.

const AVISO_PROXY = 'A API parece estar atrás de um proxy, mas TRUST_PROXY não está definido: todos os visitantes contam como um único IP nos limites.';
const AVISO_SITE_URL = 'SITE_URL não definida: o link de redefinição de senha usa a origem de quem chama a API.';

function trustProxyConfigurado(config) {
    return config.trustProxy === null || config.trustProxy === undefined ? false : config.trustProxy;
}

// recebeuXForwardedFor: se a requisição atual trouxe o cabeçalho X-Forwarded-For.
function avaliarRede(config, recebeuXForwardedFor) {
    const trustProxy = trustProxyConfigurado(config);
    const avisos = [];
    if (recebeuXForwardedFor && trustProxy === false) avisos.push(AVISO_PROXY);
    if (config.producao && !config.siteUrl) avisos.push(AVISO_SITE_URL);
    return {
        trust_proxy: trustProxy,
        recebeu_x_forwarded_for: Boolean(recebeuXForwardedFor),
        site_url_definida: Boolean(config.siteUrl),
        avisos
    };
}

module.exports = { avaliarRede, AVISO_PROXY, AVISO_SITE_URL };
