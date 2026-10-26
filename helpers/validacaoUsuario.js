const { ErroApi } = require('../lib/erros');
const { cnpjValido, somenteDigitos } = require('../lib/cnpj');

const UFS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
    'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Coletor de erros: cada validação registra { campo, mensagem } e devolve o valor limpo.
function criarValidador(prefixo = '') {
    const erros = [];
    const nome = (campo) => `${prefixo}${campo}`;
    const erro = (campo, mensagem) => erros.push({ campo: nome(campo), mensagem });

    return {
        erros,
        erro,
        texto(valor, campo, { maximo, minimo = 1, obrigatorio = true, rotulo = campo }) {
            if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) {
                if (obrigatorio) erro(campo, `${rotulo} é obrigatório.`);
                return null;
            }
            if (typeof valor !== 'string') {
                erro(campo, `${rotulo} deve ser texto.`);
                return undefined;
            }
            const limpo = valor.trim();
            if (limpo.length < minimo || limpo.length > maximo) {
                erro(campo, `${rotulo} deve ter entre ${minimo} e ${maximo} caracteres.`);
            }
            return limpo;
        },
        email(valor, campo = 'email') {
            const email = this.texto(valor, campo, { maximo: 100, rotulo: 'O e-mail' });
            if (email && !EMAIL.test(email)) erro(campo, 'Informe um e-mail válido.');
            return email ? email.toLowerCase() : email;
        },
        telefone(valor, campo = 'telefone', { obrigatorio = true } = {}) {
            const telefone = this.texto(valor, campo, { maximo: 20, obrigatorio, rotulo: 'O telefone' });
            if (!telefone) return telefone;
            const digitos = somenteDigitos(telefone);
            if (digitos.length < 10 || digitos.length > 11) {
                erro(campo, 'Informe o telefone com DDD (10 ou 11 dígitos).');
            }
            return digitos;
        },
        senha(valor, campo = 'senha') {
            if (typeof valor !== 'string' || valor.length < 8 || valor.length > 72) {
                erro(campo, 'A senha deve ter entre 8 e 72 caracteres.');
                return undefined;
            }
            return valor;
        },
        cnpj(valor, campo = 'cnpj') {
            if (typeof valor !== 'string' || !valor.trim()) {
                erro(campo, 'O CNPJ é obrigatório.');
                return undefined;
            }
            const digitos = somenteDigitos(valor);
            if (!cnpjValido(digitos)) {
                erro(campo, 'CNPJ inválido.');
            }
            return digitos;
        },
        camposPermitidos(corpo, permitidos) {
            for (const campo of Object.keys(corpo)) {
                if (!permitidos.includes(campo)) erro(campo, `Campo não permitido: ${campo}.`);
            }
        }
    };
}

function exigirObjeto(corpo, rotulo = 'O corpo da requisição') {
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        throw new ErroApi(400, 'REQUISICAO_INVALIDA', `${rotulo} deve ser um objeto.`);
    }
}

function lancarSeHouverErros(erros) {
    if (erros.length > 0) {
        throw new ErroApi(422, 'VALIDACAO', erros[0].mensagem, erros);
    }
}

const CAMPOS_ENDERECO = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'estado', 'referencia', 'principal'];

// Valida um endereço; com parcial=true só os campos enviados. Retorna { dados, erros }.
function validarEndereco(corpo, { parcial = false, prefixo = '' } = {}) {
    const v = criarValidador(prefixo);
    if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
        v.erros.push({ campo: prefixo.replace(/\.$/, '') || 'endereco', mensagem: 'O endereço é obrigatório.' });
        return { dados: {}, erros: v.erros };
    }
    v.camposPermitidos(corpo, CAMPOS_ENDERECO);
    const dados = {};
    const enviado = (campo) => !parcial || corpo[campo] !== undefined;

    if (enviado('cep')) {
        const cep = somenteDigitos(corpo.cep);
        if (cep.length !== 8) v.erro('cep', 'Informe o CEP com 8 dígitos.');
        dados.cep = `${cep.slice(0, 5)}-${cep.slice(5)}`;
    }
    if (enviado('logradouro')) dados.logradouro = v.texto(corpo.logradouro, 'logradouro', { maximo: 150, rotulo: 'O logradouro' });
    if (enviado('numero')) dados.numero = v.texto(corpo.numero, 'numero', { maximo: 20, rotulo: 'O número' });
    if (corpo.complemento !== undefined) {
        dados.complemento = v.texto(corpo.complemento, 'complemento', { maximo: 100, obrigatorio: false, rotulo: 'O complemento' });
    }
    if (enviado('bairro')) dados.bairro = v.texto(corpo.bairro, 'bairro', { maximo: 100, rotulo: 'O bairro' });
    if (enviado('cidade')) dados.cidade = v.texto(corpo.cidade, 'cidade', { maximo: 100, rotulo: 'A cidade' });
    if (enviado('estado')) {
        const uf = typeof corpo.estado === 'string' ? corpo.estado.trim().toUpperCase() : '';
        if (!UFS.includes(uf)) v.erro('estado', 'Informe a UF (ex.: SP).');
        dados.estado = uf;
    }
    if (corpo.referencia !== undefined) {
        dados.referencia = v.texto(corpo.referencia, 'referencia', { maximo: 200, obrigatorio: false, rotulo: 'A referência' });
    }
    if (corpo.principal !== undefined) {
        if (typeof corpo.principal !== 'boolean') v.erro('principal', 'O campo principal deve ser true ou false.');
        dados.principal = corpo.principal;
    }
    if (parcial && Object.keys(corpo).length === 0) {
        v.erros.push({ campo: null, mensagem: 'Informe ao menos um campo para atualizar.' });
    }
    return { dados, erros: v.erros };
}

/**
 * Cadastro público: sempre cria cliente. Exige CNPJ válido, nome do responsável, e-mail, telefone,
 * um endereço e senha. A razão social pode ser preenchida depois pela equipe (PUT /clientes/:id).
 */
function validarCadastroCliente(corpo) {
    exigirObjeto(corpo);
    const v = criarValidador();
    v.camposPermitidos(corpo, ['cnpj', 'nome', 'email', 'telefone', 'endereco', 'senha']);

    const usuario = {
        cnpj: v.cnpj(corpo.cnpj),
        nome: v.texto(corpo.nome, 'nome', { maximo: 100, minimo: 2, rotulo: 'O nome do responsável' }),
        email: v.email(corpo.email),
        telefone: v.telefone(corpo.telefone),
        senha: v.senha(corpo.senha)
    };
    const endereco = validarEndereco(corpo.endereco, { prefixo: 'endereco.' });
    const erros = [...v.erros, ...endereco.erros];
    lancarSeHouverErros(erros);
    return { usuario, endereco: { ...endereco.dados, principal: true } };
}

// POST/PATCH /admin/usuarios: usuários da equipe, sem CNPJ. O perfil é sempre "equipe";
// o cargo é texto livre e não muda permissões.
function validarUsuarioEquipe(corpo, { parcial = false } = {}) {
    exigirObjeto(corpo);
    const v = criarValidador();
    v.camposPermitidos(corpo, ['nome', 'email', 'senha', 'cargo', 'telefone', 'pode_gerenciar_equipe', 'ativo']);
    const enviado = (campo) => !parcial || corpo[campo] !== undefined;
    const dados = {};

    if (enviado('nome')) dados.nome = v.texto(corpo.nome, 'nome', { maximo: 100, minimo: 2, rotulo: 'O nome' });
    if (enviado('email')) dados.email = v.email(corpo.email);
    if (enviado('senha')) dados.senha = v.senha(corpo.senha);
    if (corpo.cargo !== undefined) dados.cargo = v.texto(corpo.cargo, 'cargo', { maximo: 50, obrigatorio: false, rotulo: 'O cargo' });
    if (corpo.telefone !== undefined) dados.telefone = v.telefone(corpo.telefone, 'telefone', { obrigatorio: false });
    for (const campo of ['pode_gerenciar_equipe', 'ativo']) {
        if (corpo[campo] !== undefined) {
            if (typeof corpo[campo] !== 'boolean') v.erro(campo, `O campo ${campo} deve ser true ou false.`);
            dados[campo] = corpo[campo];
        }
    }
    if (parcial && Object.keys(corpo).length === 0) {
        v.erros.push({ campo: null, mensagem: 'Informe ao menos um campo para atualizar.' });
    }
    lancarSeHouverErros(v.erros);
    return dados;
}

// PATCH /minha-conta: o usuário altera os próprios dados de contato. CNPJ e razão social só pela equipe.
function validarPerfilProprio(corpo) {
    exigirObjeto(corpo);
    const v = criarValidador();
    v.camposPermitidos(corpo, ['nome', 'email', 'telefone']);
    const dados = {};
    if (corpo.nome !== undefined) dados.nome = v.texto(corpo.nome, 'nome', { maximo: 100, minimo: 2, rotulo: 'O nome' });
    if (corpo.email !== undefined) dados.email = v.email(corpo.email);
    if (corpo.telefone !== undefined) dados.telefone = v.telefone(corpo.telefone);
    if (Object.keys(corpo).length === 0) {
        v.erros.push({ campo: null, mensagem: 'Informe ao menos um campo para atualizar.' });
    }
    lancarSeHouverErros(v.erros);
    return dados;
}

function validarTrocaSenha(corpo) {
    exigirObjeto(corpo);
    const v = criarValidador();
    v.camposPermitidos(corpo, ['senha_atual', 'nova_senha']);
    if (typeof corpo.senha_atual !== 'string' || !corpo.senha_atual) v.erro('senha_atual', 'Informe a senha atual.');
    const novaSenha = v.senha(corpo.nova_senha, 'nova_senha');
    lancarSeHouverErros(v.erros);
    return { senhaAtual: corpo.senha_atual, novaSenha };
}

module.exports = {
    validarCadastroCliente,
    validarEndereco,
    validarUsuarioEquipe,
    validarPerfilProprio,
    validarTrocaSenha,
    lancarSeHouverErros,
    criarValidador
};
