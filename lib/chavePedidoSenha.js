// Chave do limite por CNPJ no pedido público de nova senha: o documento informado, normalizado (sem pontuação),
// exista ele no cadastro ou não. Só lê o campo "documento" do corpo. Sem documento legível, quem chama usa o IP.
function documentoDoPedido(req) {
    const documento = req.body && typeof req.body.documento === 'string' ? req.body.documento : '';
    return documento.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
}

module.exports = { documentoDoPedido };
