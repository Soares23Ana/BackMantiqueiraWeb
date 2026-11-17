const { registrarAuditoria } = require('./auditoria');
const { removerArquivo, removerUploadPorUrl, caminhoDoUpload, urlDoUpload } = require('../lib/uploads');

/**
 * Troca a imagem de um produto por um arquivo JÁ gravado na pasta de uploads: atualiza imagem_url, audita
 * e apaga o upload anterior. Usada pelo upload comum, pela cópia a partir de um link e pelo envio em lote.
 * Se a atualização no banco falhar, o arquivo gravado é apagado e o erro segue adiante.
 * Imagens externas ou do front (/img/...) não ficam no servidor, então nunca são apagadas.
 * Devolve a imagem_url anterior.
 */
async function aplicarImagemProduto({ produto, nomeArquivo, usuario, detalhe }) {
    const anterior = produto.imagem_url;
    try {
        await produto.update({ imagem_url: urlDoUpload(nomeArquivo) });
    } catch (erro) {
        await removerArquivo(caminhoDoUpload(nomeArquivo));
        throw erro;
    }
    await registrarAuditoria({
        usuario,
        acao: 'produto.editar',
        entidade: 'produto',
        idEntidade: produto.id_produto,
        antes: { imagem_url: anterior },
        depois: { imagem_url: produto.imagem_url },
        ...(detalhe !== undefined && { detalhe })
    });
    await removerUploadPorUrl(anterior);
    return anterior;
}

module.exports = { aplicarImagemProduto };
