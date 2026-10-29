# API Mantiqueira — contrato para o front-end

Versão da API: **v1**. Os exemplos abaixo foram capturados da API rodando com o catálogo do seed.
Para ter banners, campanha, contatos e pedidos em todos os status no ambiente local, rode `npm run seed:catalogo`, `npm run seed:dev` e `npm run seed:demo` (detalhes no [guia técnico](GUIA_TECNICO.md#3-dados-de-teste-seeds)).

## Sumário
1. [Convenções](#1-convenções)
2. [Autenticação e conta](#2-autenticação-e-conta)
3. [Produtos (vitrine e gestão)](#3-produtos)
4. [Categorias e marcas](#4-categorias-e-marcas)
5. [Importação de catálogo](#5-importação-de-catálogo)
6. [Pedidos](#6-pedidos)
7. [Clientes (área do gestor)](#7-clientes)
8. [Gestão da equipe](#8-gestão-da-equipe)
9. [Painel](#9-painel)
10. [CMS: banners e blocos](#10-cms)
11. [Configurações](#11-configurações)
12. [Saúde](#12-saúde)
13. [Limitações conhecidas](#13-limitações-conhecidas)
14. [Campanhas](#14-campanhas)
15. [Eventos e métricas](#15-eventos-e-métricas)
16. [Consultas externas (CEP e CNPJ)](#16-consultas-externas)

---

## 1. Convenções

### URL base
- API: `http://localhost:3000/api/v1` (em produção, o domínio da EC2/Nginx + `/api/v1`).
- Exceções fora de `/api/v1`: `GET /saude`, `GET /saude/detalhado` e os arquivos enviados em `GET /arquivos/uploads/...`.
- CORS: liberadas por padrão `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4173`, `http://localhost:3000` e `http://localhost:3001`, com credenciais; outras origens entram por `CORS_ORIGINS` no servidor (ver [guia técnico](GUIA_TECNICO.md#6-cors)). Cabeçalhos aceitos: `Authorization`, `Content-Type`, `X-Request-Id`, `Idempotency-Key`.
- Imagens: `imagem_url` começando com `/img/` é do **front** (pasta pública do React); começando com `/arquivos/` é da **API** (prefixe com o endereço da API).

### Autenticação
Envie o token do login em todas as rotas protegidas:
```
Authorization: Bearer <token>
```
O token vale **8 horas** (configurável no servidor por `JWT_EXPIRES_IN`). A cada requisição a API confere se o usuário existe e está ativo; usuário desativado perde o acesso na hora (`401`). Trocar a senha (em `PATCH /minha-conta/senha`, pela senha temporária de `PUT /clientes/:id/senha` ou pelo gestor em `PATCH /admin/usuarios/:id`) invalida todos os tokens emitidos antes da troca (`401 NAO_AUTENTICADO`).

### Perfis
| Perfil (`usuario.tipo`) | Entra com | Acesso |
|---|---|---|
| `cliente` | CNPJ + senha | Vitrine, checkout, os próprios pedidos e a própria conta |
| `equipe` | e-mail + senha | Toda a área do gestor. `cargo` é texto livre e não muda permissões |
| `equipe` com `pode_gerenciar_equipe: true` | e-mail + senha | Tudo da equipe + gestão de usuários (`/admin`) |

Todos os usuários da equipe têm as mesmas permissões na área do gestor (produtos, estoque, categorias e marcas, pedidos, clientes, painel e CMS); a única exceção é a gestão de usuários, que exige `pode_gerenciar_equipe` (devolvido no login e em `/auth/me` para o front decidir se mostra o menu). Desativar alguém ou mudar o perfil vale na próxima requisição, sem esperar o token expirar.

Na coluna **Perfil** das tabelas: **público** (sem token), **logado** (qualquer perfil), **cliente**, **equipe**, **gestor da equipe** (equipe com `pode_gerenciar_equipe`).

### Formato de erro
Todo erro segue o mesmo formato (`detalhes` é opcional):
```json
{ "sucesso": false, "mensagem": "Texto para mostrar ao usuário.", "codigo": "CODIGO_ESTAVEL", "detalhes": [] }
```
Erros de validação de formulário (`422 VALIDACAO`) trazem **todos** os campos com problema:
```json
{
  "sucesso": false,
  "mensagem": "CNPJ inválido.",
  "codigo": "VALIDACAO",
  "detalhes": [
    { "campo": "cnpj", "mensagem": "CNPJ inválido." },
    { "campo": "telefone", "mensagem": "Informe o telefone com DDD (10 ou 11 dígitos)." },
    { "campo": "endereco", "mensagem": "O endereço é obrigatório." }
  ]
}
```

| Status | Códigos mais comuns |
|---|---|
| 400 | `REQUISICAO_INVALIDA`, `JSON_INVALIDO`, `FILTRO_INVALIDO`, `PAGINACAO_INVALIDA` |
| 401 | `NAO_AUTENTICADO` (token ausente, expirado ou usuário inativo), `CREDENCIAIS_INVALIDAS` (login) |
| 403 | `ACESSO_NEGADO` (mensagem sempre "Acesso negado.") |
| 404 | `NAO_ENCONTRADO`, `ROTA_NAO_ENCONTRADA`, `PRODUTO_NAO_ENCONTRADO`, `PEDIDO_NAO_ENCONTRADO`, `ENDERECO_NAO_ENCONTRADO`, `USUARIO_NAO_ENCONTRADO`, `CEP_NAO_ENCONTRADO`, `CNPJ_NAO_ENCONTRADO` |
| 409 | `CONFLITO` e os específicos de cada rota (ex.: `ITENS_INDISPONIVEIS`, `TRANSICAO_INVALIDA`) |
| 413 | `CORPO_MUITO_GRANDE` |
| 422 | `VALIDACAO`, `CSV_INVALIDO`, `ENDERECO_OBRIGATORIO`, `CNPJ_NAO_ENCONTRADO` e `CNPJ_INATIVO` (cadastro com consulta à Receita) |
| 429 | `LIMITE_REQUISICOES`, `MUITAS_TENTATIVAS` (login/cadastro) |
| 500 | `ERRO_INTERNO` (a mensagem nunca expõe detalhes internos) |
| 503 | `BANCO_INDISPONIVEL`, `SERVICO_INDISPONIVEL` (serviço externo de CEP ou CNPJ fora do ar) |

### Listas paginadas
Parâmetros `pagina` (padrão 1) e `limite` (padrão e máximo variam por rota). Resposta:
```json
{ "produtos": [ ... ], "paginacao": { "total": 38, "pagina": 1, "limite": 24, "total_paginas": 2 } }
```

### Outros
- Datas e horas nas respostas: ISO 8601 em UTC (`2026-10-26T23:27:34.000Z`). Campos só de data (`data_entrega_desejada`): `AAAA-MM-DD`.
- Envie JSON em UTF-8 (`Content-Type: application/json`). Corpo máximo: 200 KB.
- Toda resposta tem o cabeçalho `X-Request-Id`; informe-o ao relatar um erro.
- Limite geral: 600 requisições por minuto por IP em `/api/v1` (configurável por `LIMITE_GLOBAL`). Login tem limite próprio (10 tentativas com falha a cada 15 min) e cadastro também (10 por hora).
- **Nenhuma resposta tem valores financeiros** (preço, total, desconto). O `preco` do produto só aparece para a equipe.
- Campos sempre em `snake_case`. CNPJ sempre formatado nas respostas (`11.222.333/0001-81` ou `12.ABC.345/01DE-35`); nas requisições, aceito com ou sem pontuação e em maiúsculas ou minúsculas.
- **CNPJ alfanumérico**: desde julho de 2026 a Receita emite CNPJs com letras nas 12 primeiras posições; os 2 dígitos verificadores continuam numéricos. A API aceita os dois tipos em cadastro, login, `PUT /clientes/:id` e buscas. Normaliza para maiúsculas sem pontuação (`12.abc.345/01de-35` → `12ABC34501DE35`) e confere o dígito verificador por módulo 11, com cada caractere valendo o código ASCII − 48. No front, o campo de CNPJ precisa aceitar letras.
- Clientes (em `/clientes` e no `cliente` dos pedidos) trazem `nome_exibicao`: a razão social quando houver, senão o nome do responsável. Use esse campo para exibir o cliente.

---

## 2. Autenticação e conta

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/auth/register` | público | Cadastro de cliente |
| POST | `/auth/login` | público | Login de cliente (CNPJ) ou equipe (e-mail) |
| GET | `/auth/me` | logado | Dados do usuário do token |
| GET | `/auth/users` | gestor da equipe | Lista antiga de usuários (prefira `GET /admin/usuarios`) |
| GET | `/minha-conta` | logado | Perfil e endereços |
| PATCH | `/minha-conta` | logado | Altera nome, e-mail e telefone |
| PATCH | `/minha-conta/senha` | logado | Troca a senha |
| GET | `/minha-conta/enderecos` | cliente | Lista endereços |
| POST | `/minha-conta/enderecos` | cliente | Adiciona endereço |
| PATCH | `/minha-conta/enderecos/:id_endereco` | cliente | Edita endereço |
| DELETE | `/minha-conta/enderecos/:id_endereco` | cliente | Remove endereço |

### POST /auth/register
Sempre cria um **cliente**. Todos os campos são obrigatórios, exceto `complemento` e `referencia` do endereço. O CNPJ (numérico ou alfanumérico) pode vir com ou sem pontuação e em minúsculas, precisa ter dígitos verificadores válidos e é gravado normalizado (14 caracteres, maiúsculas, sem pontuação). A senha tem de 8 a 72 caracteres. O endereço vira o principal; outros são adicionados em `/minha-conta/enderecos`. Limite: 10 cadastros por hora por IP.
```json
{
  "cnpj": "11.222.333/0001-81",
  "nome": "Maria Souza",
  "email": "compras@mercadinho.com",
  "telefone": "(19) 99999-0000",
  "senha": "Senha@Forte1",
  "endereco": {
    "cep": "13870-000", "logradouro": "Rua das Flores", "numero": "100", "complemento": "Sala 2",
    "bairro": "Centro", "cidade": "São João da Boa Vista", "estado": "SP", "referencia": "Ao lado da padaria"
  }
}
```
`201`:
```json
{ "mensagem": "Cadastro realizado com sucesso. Entre com o CNPJ e a senha.", "id_usuario": 2 }
```
Erros: `422 VALIDACAO` (campos com prefixo `endereco.` para o endereço, ex.: `endereco.cep`), `409 CNPJ_JA_CADASTRADO`, `409 EMAIL_JA_CADASTRADO`, `429 MUITAS_TENTATIVAS`. Campos fora da lista (ex.: `tipo`, `razao_social`) são recusados com `422`.

**Consulta à Receita Federal** (ligada em produção pela variável `VALIDAR_CNPJ_RECEITA`; desligada em desenvolvimento e testes). Depois de validar o formato, a API consulta o CNPJ e:
- grava a `razao_social` vinda da Receita (o cliente não envia razão social);
- `422 CNPJ_NAO_ENCONTRADO` "CNPJ não encontrado na Receita Federal." (campo `cnpj`);
- `422 CNPJ_INATIVO` quando a situação não é `ATIVA`, informando a situação na mensagem (ex.: `"BAIXADA"`, `"SUSPENSA"`, `"INAPTA"`);
- `503 SERVICO_INDISPONIVEL` "Não foi possível validar o CNPJ agora. Tente novamente em instantes." quando os serviços de consulta estão fora do ar. Nada é gravado.

Para mostrar o nome da empresa antes de enviar o cadastro, use `GET /cnpj/:cnpj` ([consultas externas](#16-consultas-externas)). Não há aprovação manual: com o CNPJ ativo, a conta já entra.

### POST /auth/login
```json
{ "identificador": "11.222.333/0001-81", "senha": "Senha@Forte1" }
```
- Com `@`: procura o e-mail **só na equipe**. Sem `@`: exige CNPJ válido e procura **só nos clientes**.
- `200`:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "usuario": { "id": 2, "nome": "Maria Souza", "email": "compras@mercadinho.com", "tipo": "cliente", "pode_gerenciar_equipe": false }
}
```
- **Qualquer falha** (formato, usuário inexistente, perfil errado, senha errada, inativo) devolve o mesmo `401`, no mesmo tempo de resposta (não revela quais CNPJs ou e-mails existem):
```json
{ "sucesso": false, "mensagem": "Credenciais inválidas.", "codigo": "CREDENCIAIS_INVALIDAS" }
```
- Depois de 10 falhas em 15 minutos, o IP recebe `429 MUITAS_TENTATIVAS` (inclusive com a senha certa) até a janela passar.
- O front decide o destino pelo `tipo` e mostra o menu de gestão de usuários se `pode_gerenciar_equipe` for `true`.

### GET /auth/me
```json
{ "id": 1, "nome": "Administrador", "email": "admin@mantiqueira.com", "tipo": "equipe", "pode_gerenciar_equipe": true }
```

### GET /minha-conta
```json
{
  "conta": {
    "id_usuario": 2, "nome": "Maria Souza", "email": "compras@mercadinho.com", "telefone": "19999990000",
    "tipo": "cliente", "razao_social": null, "cnpj": "11.222.333/0001-81", "cargo": null,
    "criado_em": "2026-10-26T23:27:34.000Z",
    "enderecos": [
      { "id_endereco": 1, "cep": "13870-000", "logradouro": "Rua das Flores", "numero": "100", "complemento": null,
        "bairro": "Centro", "cidade": "São João da Boa Vista", "estado": "SP", "referencia": null, "principal": true }
    ]
  }
}
```

### PATCH /minha-conta
Corpo com um ou mais de `nome`, `email`, `telefone`. CNPJ e razão social só pela equipe (`422` se enviados). `200`: `{ "mensagem": "Dados atualizados.", "conta": { ... } }`. `409 EMAIL_JA_CADASTRADO`.

### PATCH /minha-conta/senha
```json
{ "senha_atual": "Senha@Forte1", "nova_senha": "NovaSenha@2" }
```
`200`: `{ "mensagem": "Senha alterada." }`. Senha atual errada: `422 VALIDACAO` no campo `senha_atual`.
Depois da troca, **todos os tokens emitidos antes dela deixam de valer, inclusive o da sessão atual**: as próximas requisições com ele recebem `401 NAO_AUTENTICADO`. Mande o usuário para o login (agora com a senha nova).

### Endereços (cliente)
- `POST /minha-conta/enderecos`: mesmos campos do endereço do cadastro, mais `principal` (boolean). O primeiro endereço é sempre o principal; marcar `principal: true` desmarca os outros. Máximo 20 (`409 LIMITE_ENDERECOS`). `201`: `{ "mensagem": "Endereço adicionado.", "endereco": { ... } }`.
- `PATCH /minha-conta/enderecos/:id_endereco`: só os campos enviados. Para trocar o principal, marque outro com `principal: true`.
- `DELETE /minha-conta/enderecos/:id_endereco`: não remove o último (`409 ULTIMO_ENDERECO`). Se remover o principal, o mais antigo assume.
- `GET /minha-conta/enderecos`: `{ "enderecos": [ ... ] }`, o principal primeiro.

---

## 3. Produtos

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/produtos` | público | Vitrine com busca, filtros, ordenação e paginação |
| GET | `/produtos/sugestoes?busca=` | público | Autocomplete |
| GET | `/produtos/filtros` | público | Contagens para os filtros |
| GET | `/produtos/:id` | público | Um produto (id numérico ou SKU) |
| POST | `/produtos` | equipe | Cadastra |
| PUT | `/produtos/:id` | equipe | Substitui os dados |
| PATCH | `/produtos/:id` | equipe | Altera os campos enviados |
| DELETE | `/produtos/:id` | equipe | Desativa (não apaga) |
| POST | `/produtos/:id/imagem` | equipe | Envia imagem (multipart) |
| PATCH | `/produtos/:id/estoque` | equipe | Ajusta estoque com observação |
| GET | `/produtos/:id/movimentacoes` | equipe | Histórico de estoque |

### O que cada perfil vê
| Campo | Público | Cliente logado | Equipe |
|---|---|---|---|
| `id_produto`, `sku`, `nome`, `descricao`, `destaques`, `imagem_url`, `categoria`, `marca`, `multiplo_venda`, `disponibilidade` | ✓ | ✓ | ✓ |
| `estoque` (quantidade exata) | | ✓ | ✓ |
| `preco`, `estoque_minimo`, `ativo`, `id_fornecedor`, `criado_em`, `atualizado_em` | | | ✓ |

`disponibilidade`: `indisponivel` (estoque abaixo do múltiplo de venda), `ultimas_unidades` (estoque até o `estoque_minimo`) ou `disponivel`.

### GET /produtos
| Parâmetro | Descrição |
|---|---|
| `busca` (ou `q`) | Termos separados por espaço; **todos** precisam aparecer em nome, SKU, descrição, marca ou categoria. Ignora acentos e maiúsculas (`locao` encontra "Loção"). Até 100 caracteres. `q` é apelido de `busca`; se vierem os dois, vale `busca`. |
| `categoria`, `marca` | Slug ou id; vários separados por vírgula (`marca=bic,risque`) |
| `disponibilidade` | `disponivel`, `ultimas_unidades`, `indisponivel` ou `em_estoque` (as duas primeiras) |
| `ordenar` | `relevancia` (padrão com busca), `nome` (padrão sem busca), `nome_desc`, `recentes`; equipe também `estoque`, `estoque_desc` |
| `pagina`, `limite` | Padrão 24, máximo 100 |
| `incluir_inativos=true` | Só equipe |

Só estes parâmetros são lidos; qualquer outro é ignorado (não dá erro). `GET /produtos/filtros` lê os mesmos filtros (`busca`/`q`, `categoria`, `marca`, `disponibilidade`, `incluir_inativos`).

Resposta (visitante):
```json
{
  "produtos": [
    {
      "id_produto": 15,
      "sku": "SKU-115",
      "nome": "Anti-séptico bucal Colgate Plax sem álcool Melancia 750 ml",
      "descricao": "Enxaguante bucal Colgate Plax Respira e Refresca, sem álcool, com sabor Melancia Splash.",
      "destaques": ["Sem álcool", "Sabor Melancia Splash", "Elimina até 99,9% das bactérias", "Frasco de 750 ml"],
      "imagem_url": "/img/colgate-plax.webp",
      "categoria": { "id_categoria": 1, "nome": "Higiene e beleza", "slug": "higiene-e-beleza" },
      "marca": { "id_marca": 7, "nome": "Colgate-Palmolive", "slug": "colgate-palmolive" },
      "multiplo_venda": 1,
      "disponibilidade": "disponivel"
    }
  ],
  "paginacao": { "total": 1, "pagina": 1, "limite": 24, "total_paginas": 1 }
}
```
Cliente logado: mesmo objeto + `"estoque": 25`. Equipe: + `"preco": null, "estoque_minimo": 10, "ativo": true, "id_fornecedor": null, "criado_em": "...", "atualizado_em": "..."`.
Erros: `400 FILTRO_INVALIDO`, `400 PAGINACAO_INVALIDA`.

### GET /produtos/sugestoes?busca=gran
Aceita só `busca` (ou o apelido `q`; com os dois, vale `busca`); outros parâmetros são ignorados. Exige 2 caracteres ou mais (menos que isso devolve listas vazias).
```json
{
  "produtos": [
    { "id_produto": 36, "sku": "SKU-136", "nome": "Cera nutritiva Granado 7 g Unhas e Cutículas", "imagem_url": "/img/granado-cera-nutritiva.webp", "marca": "Granado" }
  ],
  "categorias": [],
  "marcas": [{ "id_marca": 5, "nome": "Granado", "slug": "granado" }]
}
```
Até 8 produtos, 3 categorias e 3 marcas.

### GET /produtos/filtros
Aceita os mesmos filtros da listagem. Cada contagem considera os **outros** filtros (com `marca=granado`, as categorias mostram quantos produtos Granado há em cada uma, e a lista de marcas continua completa para permitir trocar de marca).
```json
{
  "categorias": [{ "id_categoria": 3, "nome": "Farmácia", "slug": "farmacia", "total": 5 }],
  "marcas": [{ "id_marca": 2, "nome": "Baruel", "slug": "baruel", "total": 7 }],
  "disponibilidade": { "disponivel": 33, "ultimas_unidades": 3, "indisponivel": 2, "em_estoque": 36 }
}
```

### GET /produtos/:id
`:id` pode ser o id numérico ou o SKU (`/produtos/SKU-115`). `200`: `{ "produto": { ... } }`. Produto desativado só aparece para a equipe (`404 PRODUTO_NAO_ENCONTRADO` para os demais).

### POST /produtos (equipe)
```json
{
  "sku": "SKU-200", "nome": "Fralda Teste M c/ 30",
  "descricao": "Opcional", "destaques": ["Tamanho M", "30 unidades"], "imagem_url": "/img/fralda.webp",
  "id_categoria": 2, "id_marca": 4, "id_fornecedor": null, "preco": 12.5,
  "estoque_minimo": 10, "multiplo_venda": 6, "ativo": true, "quantidade_estoque": 60
}
```
Só `sku` e `nome` são obrigatórios. Padrões: `estoque_minimo` 10, `multiplo_venda` 1. `quantidade_estoque` é o estoque inicial (gera movimentação). `201`: `{ "mensagem": "Produto cadastrado com sucesso.", "id_produto": 39, "produto": { ... } }`.
Erros: `422 VALIDACAO` (todos os campos em `detalhes`), `409 SKU_DUPLICADO`.

### PUT / PATCH /produtos/:id (equipe)
- `PUT`: exige `sku` e `nome`; campos opcionais omitidos voltam ao padrão.
- `PATCH`: só os campos enviados (ex.: `{ "ativo": true }` reativa).
- Nenhum dos dois altera o estoque (`422` se enviar `quantidade_estoque`).
- `200`: `{ "mensagem": "Produto atualizado.", "produto": { ... } }`.

### DELETE /produtos/:id (equipe)
Desativa: some da vitrine e do checkout, mas continua no histórico e para a equipe. `200`: `{ "mensagem": "Produto desativado.", "produto": { ... } }`.

### POST /produtos/:id/imagem (equipe)
`multipart/form-data` com o arquivo no campo `imagem` (JPEG, PNG, WEBP ou GIF, até 5 MB; o conteúdo é conferido). Substitui `imagem_url` por `/arquivos/uploads/<uuid>.<ext>` e apaga o upload anterior. `200`: `{ "mensagem": "Imagem atualizada.", "produto": { ... } }`.

### PATCH /produtos/:id/estoque (equipe)
Envie **um** de `quantidade` (novo valor) ou `ajuste` (soma/subtrai), sempre com `observacao` (3 a 500 caracteres):
```json
{ "ajuste": -1, "observacao": "Avaria" }
```
`200`:
```json
{
  "mensagem": "Estoque atualizado.",
  "produto": { "id_produto": 15, "sku": "SKU-115", "estoque": 24, "...": "..." },
  "movimentacao": {
    "id_movimentacao": 37, "id_produto": 15, "tipo": "ajuste", "quantidade": -1,
    "estoque_anterior": 25, "estoque_novo": 24, "observacao": "Avaria", "id_usuario": 1, "id_pedido": null,
    "criado_em": "2026-10-26T23:27:34.818Z"
  }
}
```
Nunca deixa negativo: `409 ESTOQUE_INSUFICIENTE`.

### GET /produtos/:id/movimentacoes (equipe)
Mais recentes primeiro (`limite` padrão 50, máximo 200). `tipo`: `ajuste`, `pedido`, `cancelamento` ou `importacao`.
```json
{
  "movimentacoes": [
    { "id_movimentacao": 37, "id_produto": 15, "tipo": "ajuste", "quantidade": -1, "estoque_anterior": 25, "estoque_novo": 24,
      "observacao": "Avaria", "id_usuario": 1, "id_pedido": null, "criado_em": "2026-10-26T23:27:34.000Z",
      "usuario": { "id_usuario": 1, "nome": "Administrador" } }
  ],
  "paginacao": { "total": 2, "pagina": 1, "limite": 50, "total_paginas": 1 }
}
```

---

## 4. Categorias e marcas

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/categorias`, `/marcas` | público | Ativas, com `total_produtos` ativos (equipe: `?incluir_inativos=true`) |
| POST | `/categorias`, `/marcas` | equipe | Cria |
| PUT/PATCH | `/categorias/:id`, `/marcas/:id` | equipe | Edita |
| DELETE | `/categorias/:id`, `/marcas/:id` | equipe | Exclui (só sem produtos) |

`GET /categorias`:
```json
{
  "categorias": [
    { "id_categoria": 3, "nome": "Farmácia", "slug": "farmacia", "ordem": 0, "ativo": true,
      "criado_em": "2026-10-26T23:27:33.000Z", "atualizado_em": "2026-10-26T23:27:33.000Z", "total_produtos": 5 }
  ]
}
```
`GET /marcas` devolve `{ "marcas": [ ... ] }` (sem `ordem`).

Criar/editar: `{ "nome": "Perfumaria", "slug": "opcional", "ordem": 5, "ativo": true }` (`ordem` só em categorias). O slug é gerado do nome (`Loja do bebê` → `loja-do-bebe`). Respostas: `{ "mensagem": "...", "categoria": { ... } }` ou `{ "mensagem": "...", "marca": { ... } }`.
Erros: `409 SLUG_DUPLICADO`; exclusão com produtos: `409 EM_USO` (use `PATCH { "ativo": false }`).

---

## 5. Importação de catálogo

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/produtos/importar` | equipe | Importa CSV (multipart, campo `arquivo`) |
| GET | `/produtos/importacoes` | equipe | Histórico (uploads e jobs) |
| GET | `/produtos/importacoes/:id` | equipe | Detalhe com o relatório de erros |

O formato do CSV e as colunas estão no [guia técnico](GUIA_TECNICO.md#7-importação-de-catálogo-csv), e os jobs em [Jobs agendados](GUIA_TECNICO.md#8-jobs-agendados). Exemplos prontos em `importacao/exemplos/`.

**Arquivos na pasta `importacao/entrada/` (jobs):** arquivos modificados nos últimos 60 segundos são ignorados (podem estar sendo copiados) e lidos na execução seguinte; no `ultimo_resultado` do job (em `/saude/detalhado`) aparecem com `"status": "ignorado"`. Recomendado: grave o arquivo como `.tmp` e renomeie para `.csv` ao terminar a cópia; só `.csv` é lido. O upload (`POST /produtos/importar`) não tem essa espera.

### POST /produtos/importar
`multipart/form-data`: `arquivo` (.csv, até 5 MB). Query: `simular=true` (não grava), `carga_completa=true` (desativa produtos ausentes, só se o arquivo não tiver erros).
```json
{
  "mensagem": "Simulação concluída. Nada foi gravado.",
  "id_sincronizacao": 1,
  "status": "parcial",
  "relatorio": {
    "simulado": true, "linhas": 2, "criados": 0, "atualizados": 1, "inalterados": 0, "desativados": 0,
    "com_erro": 1, "categorias_criadas": 0, "marcas_criadas": 0, "movimentacoes_estoque": 1,
    "erros": [{ "linha": 3, "sku": "SKU-XYZ", "campo": "nome", "mensagem": "Produto novo exige o nome." }],
    "avisos": []
  }
}
```
`status`: `sucesso`, `parcial` ou `falha`. Erros: `422 VALIDACAO` (sem arquivo ou não é .csv), `422 CSV_INVALIDO` (ilegível ou sem coluna `sku`), `409 IMPORTACAO_EM_ANDAMENTO`.

### GET /produtos/importacoes
`?tipo=importacao_manual|carga_completa|estoque&pagina=&limite=`. Cada item: `id_sincronizacao`, `tipo`, `origem`, `simulado`, `status`, `linhas`, `criados`, `atualizados`, `inalterados`, `desativados`, `com_erro`, `movimentacoes_estoque`, `mensagem`, `iniciado_em`, `finalizado_em`, `duracao_ms`, `usuario` (`null` nos jobs). O detalhe (`/:id`) inclui `relatorio: { erros, avisos }`.

---

## 6. Pedidos

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| POST | `/pedidos` | cliente | Checkout (aceita `Idempotency-Key`) |
| GET | `/pedidos/meus` | cliente | Pedidos do cliente |
| GET | `/pedidos` | equipe | Todos, com filtros |
| GET | `/pedidos/:id_pedido` | equipe, ou cliente dono | Detalhe com histórico |
| GET | `/pedidos/:id_pedido/repetir` | cliente dono | Sugestão para repetir o pedido |
| PUT/PATCH | `/pedidos/:id_pedido/status` | equipe | Avança o status |
| POST | `/pedidos/:id_pedido/cancelar` | equipe, ou cliente dono | Cancela e devolve o estoque |

Ciclo: `Aguardando Separação` → `Em Separação` → `Saiu para Entrega` → `Entregue`. Cancelamento (`Cancelado`): o cliente só em `Aguardando Separação`; a equipe até `Em Separação`.

### POST /pedidos (cliente)
```json
{
  "itens": [{ "id_produto": 15, "quantidade": 2 }],
  "id_endereco": 1,
  "observacao": "Entregar pela manhã",
  "data_entrega_desejada": "2026-11-05"
}
```
- `id_endereco` opcional (padrão: o principal); precisa ser do cliente. Uma cópia do endereço fica no pedido.
- `data_entrega_desejada` opcional, de amanhã até 90 dias.
- Itens repetidos são somados. Até 100 itens.

**Idempotência (recomendado).** Envie o cabeçalho opcional `Idempotency-Key` com um valor novo por checkout (ex.: `crypto.randomUUID()` gerado ao abrir a tela de finalização) e repita **o mesmo valor** se precisar reenviar (timeout, duplo clique, queda de rede):
```
Idempotency-Key: 9b2f6c1e-4a7d-4c1b-9e1f-2d3a4b5c6d7e
```
- De 8 a 64 caracteres visíveis, sem espaços nem acentos; diferencia maiúsculas. Fora disso: `400 REQUISICAO_INVALIDA`.
- A chave vale por cliente. Se ela já gerou um pedido, a API devolve **`200`** com `"mensagem": "Este pedido já foi criado."` e o mesmo objeto `pedido`, sem validar o corpo de novo e sem baixar estoque outra vez. Requisições simultâneas com a mesma chave também resultam em um único pedido.
- Um checkout que falhou (`409`, `422`) não grava a chave: corrija e reenvie com a mesma.

`201`:
```json
{
  "mensagem": "Pedido criado com sucesso.",
  "pedido": {
    "id_pedido": 1,
    "status": "Aguardando Separação",
    "data_pedido": "2026-10-26T23:27:34.000Z",
    "data_entrega_desejada": null,
    "data_entrega": null,
    "observacao": "Entregar pela manhã",
    "motivo_cancelamento": null,
    "endereco_entrega": {
      "id_endereco": 1, "cep": "13870-000", "logradouro": "Rua das Flores", "numero": "100", "complemento": null,
      "bairro": "Centro", "cidade": "São João da Boa Vista", "estado": "SP", "referencia": null, "principal": true
    },
    "itens": [
      { "id_produto": 15, "sku": "SKU-115", "nome": "Anti-séptico bucal Colgate Plax sem álcool Melancia 750 ml",
        "imagem_url": "/img/colgate-plax.webp", "quantidade": 2 }
    ],
    "total_itens": 2,
    "pode_cancelar": true
  }
}
```
Se algum item tiver problema, **nada é gravado** e vem a lista completa:
```json
{
  "sucesso": false,
  "mensagem": "1 item(ns) do pedido precisa(m) de ajuste.",
  "codigo": "ITENS_INDISPONIVEIS",
  "detalhes": [
    { "id_produto": 15, "sku": "SKU-115", "nome": "Anti-séptico bucal Colgate Plax sem álcool Melancia 750 ml",
      "solicitado": 500, "disponivel": 22, "multiplo_venda": 1, "motivo": "estoque_insuficiente" }
  ]
}
```
`motivo`: `produto_inexistente`, `produto_inativo`, `multiplo_de_venda` ou `estoque_insuficiente`. `disponivel` é a maior quantidade que pode ser pedida agora, respeitando o múltiplo de venda.
Outros erros: `422 VALIDACAO`, `422 ENDERECO_OBRIGATORIO` (cliente sem endereço).

Pedido, itens, baixa de estoque, movimentações e histórico são gravados na mesma transação, e pedidos simultâneos não usam o mesmo estoque. Todo pedido nas respostas traz `pode_cancelar`, calculado para quem fez a requisição.

### GET /pedidos/meus (cliente)
`?status=&pagina=&limite=` (padrão 20, máximo 100). `{ "pedidos": [ ... ], "paginacao": { ... } }`, com o mesmo objeto de pedido do checkout.

### GET /pedidos (equipe)
| Parâmetro | Descrição |
|---|---|
| `status` | Um ou vários separados por vírgula |
| `id_cliente` | Pedidos de um cliente |
| `de`, `ate` | Data do pedido, `AAAA-MM-DD` (inclusive) |
| `busca` | Número do pedido, ou nome, razão social, e-mail ou CNPJ do cliente |
| `pagina`, `limite` | Padrão 20, máximo 100 |

Cada pedido traz, além dos campos do checkout, `cliente`, `funcionario` (quem mudou o status por último) e `proximo_status`:
```json
{
  "cliente": { "id_usuario": 2, "nome": "Maria Souza", "razao_social": null, "nome_exibicao": "Maria Souza",
               "cnpj": "11.222.333/0001-81", "email": "compras@mercadinho.com", "telefone": "19999990000" },
  "funcionario": { "id_usuario": 1, "nome": "Administrador", "cargo": "Administrador" },
  "proximo_status": "Saiu para Entrega"
}
```

### GET /pedidos/:id_pedido
Equipe vê qualquer pedido; cliente só os próprios (o de outro cliente responde `404 PEDIDO_NAO_ENCONTRADO`). Inclui o `historico`:
```json
"historico": [
  { "status_anterior": null, "status_novo": "Aguardando Separação", "observacao": null,
    "data": "2026-10-26T23:27:34.000Z", "usuario": { "id_usuario": 2, "nome": "Maria Souza", "tipo": "cliente" } },
  { "status_anterior": "Aguardando Separação", "status_novo": "Em Separação", "observacao": null,
    "data": "2026-10-26T23:27:34.000Z", "usuario": { "id_usuario": 1, "nome": "Administrador", "tipo": "equipe" } }
]
```

### GET /pedidos/:id_pedido/repetir (cliente dono)
Sugere os itens de um pedido anterior (de qualquer status) ajustados ao catálogo de agora. **Não reserva estoque**: o checkout valida tudo de novo.
```json
{
  "id_pedido_origem": 12,
  "itens": [
    { "id_produto": 15, "sku": "SKU-115", "nome": "Anti-séptico bucal Colgate Plax ...", "imagem_url": "/img/colgate-plax.webp",
      "multiplo_venda": 1, "disponibilidade": "disponivel", "estoque": 24,
      "quantidade_anterior": 4, "quantidade_sugerida": 4, "ajuste": null },
    { "id_produto": 7, "sku": "SKU-107", "nome": "Fralda Huggies ...", "imagem_url": "/img/huggies.webp",
      "multiplo_venda": 1, "disponibilidade": "ultimas_unidades", "estoque": 6,
      "quantidade_anterior": 10, "quantidade_sugerida": 6, "ajuste": "reduzido_ao_estoque" }
  ],
  "itens_para_checkout": [{ "id_produto": 15, "quantidade": 4 }, { "id_produto": 7, "quantidade": 6 }],
  "itens_ajustados": 1
}
```
| `ajuste` | Significado |
|---|---|
| `null` | Mesma quantidade do pedido anterior |
| `ajustado_ao_multiplo` | O múltiplo de venda mudou; arredondado para baixo, com no mínimo um múltiplo |
| `reduzido_ao_estoque` | Menos estoque que o pedido anterior; sugere o máximo disponível |
| `indisponivel` | Sem estoque agora (`quantidade_sugerida: 0`) |
| `produto_inativo` | Produto fora de linha (`quantidade_sugerida: 0`) |

`itens_para_checkout` já vem no formato de `POST /pedidos` (sem os itens zerados). Pedido de outro cliente ou inexistente: `404`.

### PUT /pedidos/:id_pedido/status (equipe)
```json
{ "status": "Em Separação", "observacao": "opcional" }
```
`200`:
```json
{ "mensagem": "Status do pedido atualizado.", "pedido": { "id_pedido": 1, "status": "Em Separação", "data_entrega": null, "id_funcionario": 1 } }
```
Só aceita o próximo passo; pular ou voltar dá:
```json
{ "sucesso": false, "mensagem": "Não é possível mudar de \"Em Separação\" para \"Entregue\".", "codigo": "TRANSICAO_INVALIDA",
  "detalhes": { "status_atual": "Em Separação", "proximo_permitido": "Saiu para Entrega" } }
```
`"status": "Cancelado"` aqui dá `422` (use a rota de cancelamento). Grava quem mudou em `id_funcionario` e no histórico; ao entregar, registra `data_entrega`.

### POST /pedidos/:id_pedido/cancelar
```json
{ "motivo": "Cliente desistiu" }
```
`200`:
```json
{ "mensagem": "Pedido cancelado. O estoque dos itens foi devolvido.", "pedido": { "id_pedido": 1, "status": "Cancelado", "motivo_cancelamento": "Cliente desistiu" } }
```
O estoque de todos os itens volta na mesma transação, com movimentação do tipo `cancelamento`. Erros: `422 VALIDACAO` (motivo com 3 a 500 caracteres), `409 CANCELAMENTO_NAO_PERMITIDO` (`detalhes.status_atual`), `404` para cliente que não é dono.

---

## 7. Clientes

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/clientes` | equipe | Lista com busca, ordenação e paginação |
| GET | `/clientes/:id/detalhes` | equipe | Dados, endereços, histórico e produtos mais pedidos |
| PUT | `/clientes/:id` | equipe | Atualiza dados operacionais |
| PUT | `/clientes/:id/senha` | equipe | Define uma senha temporária |

### GET /clientes
`?busca=&ordenar=&novos_dias=&pagina=&limite=&sem_cnpj=true` (padrão 20, máximo 100).
- `busca` procura em nome, razão social, e-mail, CNPJ (com ou sem pontuação, letras em maiúsculas ou minúsculas) e na **cidade do endereço principal**.
- `ordenar`: `nome` (padrão), `mais_pedidos` (quem tem mais pedidos não cancelados primeiro; empate por nome) ou `recentes` (cadastro mais recente primeiro). Outro valor: `400 FILTRO_INVALIDO`.
- `novos_dias` (1 a 365): só os clientes cadastrados nos últimos N dias, do mais recente para o mais antigo (a menos que `ordenar` seja enviado). Ex.: `?novos_dias=7` lista os novos cadastros da semana. Fora do intervalo: `400 FILTRO_INVALIDO`.
- `sem_cnpj=true` lista quem não consegue entrar por falta de CNPJ válido.
- Cada cliente traz `cidade` (do endereço principal; `null` se não tiver endereço) e `total_pedidos` (pedidos **não cancelados**).
```json
{
  "clientes": [
    { "id_usuario": 2, "nome": "Maria Souza", "razao_social": null, "nome_exibicao": "Maria Souza", "cnpj": "11.222.333/0001-81",
      "cnpj_original": null, "email": "compras@mercadinho.com", "telefone": "19999990000", "ativo": true,
      "criado_em": "2026-10-26T23:27:34.000Z", "cidade": "São João da Boa Vista", "total_pedidos": 4 }
  ],
  "paginacao": { "total": 1, "pagina": 1, "limite": 20, "total_paginas": 1 }
}
```

### GET /clientes/:id/detalhes
```json
{
  "cliente": { "id_usuario": 2, "nome": "Maria Souza", "razao_social": null, "nome_exibicao": "Maria Souza", "cnpj": "11.222.333/0001-81",
               "email": "...", "telefone": "...", "ativo": true, "criado_em": "...", "enderecos": [ ... ] },
  "historico_pedidos": [ { "id_pedido": 1, "status": "Entregue", "data_pedido": "...", "itens": [ ... ] } ],
  "produtos_mais_solicitados": [ { "id_produto": 15, "nome": "...", "quantidade_solicitada": 12 } ]
}
```
`produtos_mais_solicitados` ignora pedidos cancelados.

Clientes guardam só dados operacionais e comerciais (`razao_social`, `cnpj`, `telefone` e endereços de entrega). Nenhum dado bancário, de cartão ou limite de crédito é armazenado.

### PUT /clientes/:id
Um ou mais de: `razao_social`, `cnpj` (válido e único; corrigir limpa a pendência de `cnpj_original`), `telefone`, `ativo` (bloqueia/desbloqueia o login) e `enderecos` (lista; com `id_endereco` atualiza, sem ele cria; os omitidos não são removidos). `200`: `{ "mensagem": "Dados operacionais do cliente atualizados.", "cliente": { ... } }`. Erros: `422` (CNPJ inválido), `409 CNPJ_JA_CADASTRADO`, `404`.

### PUT /clientes/:id/senha
Para o cliente que esqueceu a senha (não há recuperação por e-mail). A equipe define uma senha temporária, informa ao cliente por telefone/WhatsApp e orienta a troca em `PATCH /minha-conta/senha`.
```json
{ "senha": "Temporaria@2026" }
```
`200`: `{ "mensagem": "Senha temporária definida. Informe-a ao cliente e oriente a troca em \"Minha conta\"." }`. Só o hash é gravado. Erros: `422 VALIDACAO` (8 a 72 caracteres; nenhum outro campo), `404` (não é cliente). As sessões abertas do cliente são encerradas (tokens anteriores recebem `401`).

---

## 8. Gestão da equipe

Todas exigem **gestor da equipe** (`pode_gerenciar_equipe: true`); os demais recebem `403`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/admin/usuarios` | Lista usuários (`?tipo=cliente\|equipe&ativo=true\|false&busca=&pagina=`) |
| POST | `/admin/usuarios` | Cria usuário da equipe |
| PATCH | `/admin/usuarios/:id` | Edita, concede/remove a marca, desativa/reativa |

### POST /admin/usuarios
```json
{ "nome": "Carlos", "email": "carlos@mantiqueira.com", "senha": "Senha@Forte1", "cargo": "Estoquista", "telefone": "19988887777", "pode_gerenciar_equipe": false }
```
`201`:
```json
{
  "mensagem": "Usuário da equipe criado.",
  "usuario": { "id_usuario": 3, "nome": "Carlos", "email": "carlos@mantiqueira.com", "tipo": "equipe", "pode_gerenciar_equipe": false,
               "cargo": "Estoquista", "telefone": null, "razao_social": null, "cnpj": null, "ativo": true, "criado_em": "2026-10-26T23:27:35.000Z" }
}
```
`tipo` e `cnpj` não são aceitos (`422`). `409 EMAIL_JA_CADASTRADO`.

### PATCH /admin/usuarios/:id
Campos: `nome`, `email`, `senha`, `cargo`, `telefone`, `pode_gerenciar_equipe`, `ativo`. Para clientes, só `ativo`. Regras (`409 OPERACAO_NAO_PERMITIDA`): ninguém desativa a si mesmo; a marca não sai do último usuário ativo que a tem. Com `senha`, as sessões abertas da pessoa são encerradas (tokens anteriores recebem `401`); editar os outros campos não encerra.

---

## 9. Painel

Todas: **equipe**. "Estoque baixo" = produto ativo com estoque menor ou igual ao `estoque_minimo` dele (padrão 10, editável no produto). `/painel/contadores` serve para os badges do menu.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/painel` | `{ "pedidos_pendentes": 0, "estoque_baixo": 5, "clientes_ativos": 1 }` |
| GET | `/painel/contadores` | `{ "pedidos_pendentes": 0, "estoque_baixo": 5, "clientes_novos_7_dias": 2 }` |
| GET | `/painel/alertas-reposicao` | Ver abaixo |

`pedidos_pendentes` conta `Aguardando Separação` + `Em Separação`; `clientes_ativos` conta clientes não bloqueados; `clientes_novos_7_dias` conta os clientes cadastrados nos últimos 7 dias (ativos ou não). É só informativo: não há aprovação de cadastro e nada fica bloqueado esperando revisão. Para ver quem são, use `GET /clientes?novos_dias=7`.

```json
{
  "meta_reposicao": 50,
  "alertas": [
    { "produto": { "id_produto": 12, "sku": "SKU-112", "nome": "Sabonete Palmolive Naturals Nutrição Intensiva 85 g c/ 3", "descricao": null },
      "estoque_atual": 0, "estoque_minimo": 10, "sugestao_compra": 50 }
  ]
}
```
`sugestao_compra` completa o estoque até a configuração `meta_reposicao`.

---

## 10. CMS

### Banners
| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cms` | público | Banners no ar, na ordem |
| GET | `/cms/todos` | equipe | Todos, com `situacao` |
| POST | `/cms` | equipe | Cria (multipart) |
| PATCH | `/cms/:id` | equipe | Edita (JSON ou multipart) |
| PUT | `/cms/ordem` | equipe | Reordena |
| DELETE | `/cms/:id` | equipe | Exclui banner e imagem |

- `GET /cms`: banners no ar (ativos e dentro da janela `inicio_em`/`fim_em`), na `ordem` definida. `{ "banners": [{ "id_banner": 1, "titulo": "Promo", "link": "/promocoes", "imagem_url": "/arquivos/uploads/<uuid>.png", "ordem": 1 }] }`.
- `GET /cms/todos`: objetos completos (`ativo`, `inicio_em`, `fim_em`, `criado_em`, `atualizado_em`) + `situacao`: `no_ar`, `agendado`, `expirado` ou `inativo`.
- `POST /cms` (multipart): `titulo` e `imagem` (JPEG, PNG, WEBP ou GIF; até 5 MB) obrigatórios; sem `ordem`, o banner vai para o fim da fila. Opcionais `link` (caminho interno ou URL http/https), `ordem`, `ativo`, `inicio_em`, `fim_em`. Datas sem fuso são horário de Brasília (`2026-11-01T08:00`). `201`: `{ "mensagem": "Banner salvo com sucesso.", "banner": { ... } }`.
- `PATCH /cms/:id`: os mesmos campos, todos opcionais; com nova `imagem`, a anterior é apagada; `{ "ativo": false }` desativa; `null` em `inicio_em`/`fim_em` remove a janela.
- `PUT /cms/ordem`: `{ "ids": [3, 1, 2] }` com **todos** os banners; devolve a lista completa reordenada.
- Erros: `422 VALIDACAO` (ex.: `fim_em` antes de `inicio_em`), `404`.

### Blocos de conteúdo
Textos editáveis do site, identificados por uma chave (ex.: `sobre`, `politica-de-entrega`).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cms/blocos` | público | Blocos ativos (equipe vê todos) |
| GET | `/cms/blocos/:chave` | público | Um bloco (inativo só para a equipe) |
| PUT | `/cms/blocos/:chave` | equipe | Cria ou substitui |
| PATCH | `/cms/blocos/:chave` | equipe | Liga ou desliga (`{ "ativo": false }`) |
| DELETE | `/cms/blocos/:chave` | equipe | Exclui |

`PUT /cms/blocos/politica-de-entrega`:
```json
{ "titulo": "Política de entrega", "conteudo": "Entregamos em até 2 dias úteis.", "ativo": true }
```
`200`: `{ "mensagem": "Bloco de conteúdo salvo.", "bloco": { "id_bloco": 1, "chave": "politica-de-entrega", "titulo": "...", "conteudo": "...", "ativo": true, "atualizado_em": "..." } }`. A chave usa só letras minúsculas, números e hífens.

`PATCH /cms/blocos/politica-de-entrega` com `{ "ativo": false }` liga ou desliga o bloco sem reenviar título e conteúdo (o botão de ativar da tela). Só aceita `ativo`, booleano; para mudar o conteúdo, use o `PUT`. `200`: `{ "mensagem": "Bloco desativado.", "bloco": { ... } }` (ou `"Bloco ativado."`). Erros: `422 VALIDACAO` (outro campo ou `ativo` que não seja `true`/`false`), `404` (chave inexistente).

---

## 11. Configurações

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/configuracoes/publicas` | público | Contatos e aviso do topo |
| GET | `/configuracoes` | equipe | Todas, com descrição |
| PUT | `/configuracoes/:chave` | equipe | `{ "valor": ... }`; `null` limpa |

`GET /configuracoes/publicas`:
```json
{ "whatsapp": "5519999990000", "telefone_contato": null, "email_contato": null, "horario_atendimento": null, "aviso_topo": null }
```

| Chave | Pública | Validação |
|---|---|---|
| `whatsapp` | sim | 12–13 dígitos (DDI + DDD); guardado só com dígitos |
| `telefone_contato` | sim | 10–11 dígitos |
| `email_contato` | sim | e-mail válido |
| `horario_atendimento` | sim | texto até 200 caracteres |
| `aviso_topo` | sim | texto até 200 caracteres |
| `meta_reposicao` | não | inteiro de 1 a 1.000.000 (padrão 50) |

Erros: `422 VALIDACAO`, `404` (chave desconhecida).

---

## 12. Saúde

### GET /saude (público)
```json
{ "status": "ok", "banco": "conectado" }
```
`503` com `"status": "degradado"` e `"banco": "indisponivel"` quando o banco não responde.
Só esses dois campos. Versão, uptime, data de início e sincronizações ficam em `GET /saude/detalhado`.

### GET /saude/detalhado (equipe)
```json
{
  "status": "ok",
  "versao": "1.0.0",
  "banco": { "status": "conectado", "latencia_ms": 1, "migracoes_pendentes": [] },
  "processo": { "iniciado_em": "2026-10-26T23:27:33.479Z", "uptime_segundos": 4, "node": "v24.20.0", "memoria_mb": 108 },
  "jobs": [
    { "nome": "estoque", "descricao": "A cada 30 min: ...", "expressao": "*/30 * * * *", "fuso": "America/Sao_Paulo", "ativo": true,
      "proxima_execucao": "2026-10-26T23:30:00.000Z", "ultima_execucao": null, "ultimo_resultado": null, "ultimo_erro": null }
  ],
  "sincronizacoes": { "ultima": null, "ultima_carga_completa": null, "ultima_estoque": null, "ultima_importacao_manual": null }
}
```

---

## 13. Limitações conhecidas

**Estoque e importação**
1. **O estoque importado substitui o valor atual; não soma nem subtrai.** Se um pedido baixar o estoque entre a geração do arquivo e a importação, o valor do arquivo volta a valer e essa baixa é "desfeita" no estoque (o pedido continua registrado). Gere o arquivo o mais perto possível da importação.
2. A importação não tem integração com ERP: os arquivos precisam ser enviados pela tela (upload) ou copiados para `importacao/entrada/` no servidor.
3. No arquivo de estoque, um SKU que não existe é rejeitado (não cria produto). Na carga completa, produtos ausentes só são desativados quando o arquivo não tem nenhum erro.
4. O relatório de cada importação guarda no máximo 500 erros.
5. Uma linha com vários problemas pode aparecer mais de uma vez em `erros` (uma por campo).

**Contrato e formatos**
6. A razão social não é enviada pelo cliente: com `VALIDAR_CNPJ_RECEITA` ligado (produção), ela vem da Receita no cadastro; desligado (desenvolvimento, demonstração), clientes novos têm `razao_social: null` até a equipe preencher em `PUT /clientes/:id`. Use `nome_exibicao` para exibir.
7. Os objetos de pedido em `historico_pedidos` (detalhes do cliente) vêm no formato do banco, mais simples que o de `GET /pedidos` (sem `pode_cancelar`, `total_itens` nem `sku` nos itens).
8. Datas e horas vêm em UTC; converta para o fuso de Brasília na exibição.
9. Imagens do catálogo (`/img/...`) são servidas pelo front; imagens enviadas pela API (`/arquivos/uploads/...`) ficam no disco do servidor e são perdidas se a instância for recriada (não há S3).

**Autenticação**
10. Não há recuperação de senha por e-mail. Cliente que esqueceu a senha: a equipe define uma temporária em `PUT /clientes/:id/senha` e o cliente troca em "Minha conta" (a troca não é obrigatória; a API não força). Usuário da equipe: o gestor redefine em `PATCH /admin/usuarios/:id`.
11. Não há refresh token: depois de 8 horas (ou o valor de `JWT_EXPIRES_IN`) o usuário precisa entrar de novo. "Sair" é só descartar o token no front (ele continua válido até expirar, a menos que o usuário seja desativado).
12. Os limites de requisições ficam na memória de cada instância: com várias instâncias, o limite efetivo é multiplicado; reiniciar a API zera as contagens.

**Métricas**
13. As contagens de eventos (`resumo`, `visualizacoes`, `cliques`) contam eventos, não pessoas: duas visitas da mesma pessoa ao mesmo produto contam 2. Já `sessoes` (funil, produtos vistos, banners e campanhas) só identifica quem está logado ou quem o front marcou com `sessao`; a mesma pessoa antes e depois do login conta como duas sessões. `produto_visto`, `carrinho_adicionar`, `checkout_iniciado` e os cliques só existem se o front enviar `POST /eventos`. Eventos com mais de 12 meses são apagados.
14. Buscas da equipe e trocas de página não entram nas métricas de busca. O termo é guardado em minúsculas; termos com e sem acento são agrupados juntos.

**Pedidos e notificações**
15. A notificação de mudança de status é só um registro no log; o cliente não recebe e-mail nem mensagem.
16. Não há edição de pedido: para mudar itens, cancela-se e faz-se outro (enquanto o status permitir).

**Busca e catálogo**
17. A busca é por trechos de texto (sem tolerância a erros de digitação: "colgat" encontra, "golgate" não). Adequada para milhares de produtos.
18. Desativar uma categoria ou marca não esconde os produtos dela: ela some de `GET /categorias` / `GET /marcas`, mas os produtos continuam na vitrine e ela ainda aparece nas contagens de `GET /produtos/filtros`. Para tirar produtos da vitrine, desative os produtos.
19. `DELETE /produtos/:id` apenas desativa; não existe exclusão definitiva de produto. Já a exclusão de banner é definitiva e apaga a imagem.

**Ferramentas**
20. Testando com `curl` no Windows, acentos no corpo da requisição podem chegar fora do UTF-8 (`"Em Separação"` dá `422`). Use Insomnia/Postman ou envie o corpo de um arquivo UTF-8 (`--data-binary @arquivo.json`). O navegador não tem esse problema.

---

## 14. Campanhas

Campanhas **não aplicam desconto**: são um título, um selo de texto (ex.: "Leve 8 pague 6", só um rótulo), um período e os produtos vinculados. Não há aprovação, grupos de clientes nem limite por cliente. A situação vem das datas: `agendada` (antes do início), `ativa` (no período) ou `encerrada` (depois do fim).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/campanhas/ativas` | público | Campanhas no período, com os produtos ativos |
| GET | `/campanhas?situacao=agendada|ativa|encerrada` | equipe | Todas, com situação |
| GET | `/campanhas/:id` | equipe | Uma campanha |
| POST | `/campanhas` | equipe | Cria |
| PATCH | `/campanhas/:id` | equipe | Edita |
| DELETE | `/campanhas/:id` | equipe | Exclui |

### GET /campanhas/ativas (público)
Os produtos vêm no mesmo formato da vitrine (`GET /produtos`), inclusive com `estoque` para quem estiver logado. Produtos desativados não aparecem. Ordem: as que terminam primeiro vêm antes.
```json
{
  "campanhas": [
    {
      "id_campanha": 1,
      "titulo": "Semana da Higiene",
      "selo": "Leve 8 pague 6",
      "inicio_em": "2026-10-25T03:00:00.000Z",
      "fim_em": "2026-11-01T03:00:00.000Z",
      "produtos": [
        { "id_produto": 15, "sku": "SKU-115", "nome": "Anti-séptico bucal Colgate Plax ...", "imagem_url": "/img/colgate-plax.webp",
          "categoria": { "...": "..." }, "marca": { "...": "..." }, "multiplo_venda": 1, "disponibilidade": "disponivel" }
      ]
    }
  ]
}
```
Para mostrar o selo nos cards da vitrine, cruze os `id_produto` desta resposta com os produtos de `GET /produtos` (a listagem de produtos não traz campanhas). Um produto pode estar em mais de uma campanha ativa.

### POST /campanhas (equipe)
```json
{ "titulo": "Semana da Higiene", "selo": "Leve 8 pague 6", "inicio_em": "2026-11-01T00:00", "fim_em": "2026-11-08T00:00", "produtos": [15, 16, 17] }
```
- Obrigatórios: `titulo` (3 a 120 caracteres), `inicio_em`, `fim_em` (depois do início) e `produtos` (1 a 200 ids existentes, sem repetir). `selo` é opcional, até 40 caracteres.
- Datas sem fuso são horário de Brasília.
- `201`:
```json
{
  "mensagem": "Campanha criada.",
  "campanha": {
    "id_campanha": 1, "titulo": "Semana da Higiene", "selo": "Leve 8 pague 6",
    "inicio_em": "2026-11-01T03:00:00.000Z", "fim_em": "2026-11-08T03:00:00.000Z", "situacao": "agendada",
    "produtos": [{ "id_produto": 15, "sku": "SKU-115", "nome": "...", "imagem_url": "/img/colgate-plax.webp", "ativo": true }],
    "total_produtos": 3, "criado_em": "...", "atualizado_em": "..."
  }
}
```
- Erros: `422 VALIDACAO` (todos os campos em `detalhes`; produtos inexistentes são listados na mensagem).

### PATCH /campanhas/:id (equipe)
Qualquer subconjunto dos campos do `POST`. `produtos`, quando enviado, **substitui a lista inteira**. Para encerrar antes do previsto, envie `fim_em` com a data/hora atual. `200`: `{ "mensagem": "Campanha atualizada.", "campanha": { ... } }`.

### DELETE /campanhas/:id (equipe)
Exclui a campanha e os vínculos (os produtos não são afetados). `200`: `{ "mensagem": "Campanha excluída." }`.

---

## 15. Eventos e métricas

### POST /eventos (público)
O front envia o que acontece na navegação. **A API não guarda IP.** Se houver token válido, o evento fica associado ao usuário; para visitantes, o front pode mandar `sessao` (um identificador aleatório que ele gera e guarda, de 8 a 64 caracteres `[A-Za-z0-9_-]`). Limite: 120 eventos por minuto por IP.

| `tipo` | Campos | Quando enviar |
|---|---|---|
| `produto_visto` | `id_produto` | Abriu a página do produto |
| `carrinho_adicionar` | `id_produto`, `quantidade` (opcional) | Adicionou ao carrinho |
| `checkout_iniciado` | — | Abriu o checkout |
| `banner_clique` | `id_banner` | Clicou num banner |
| `campanha_clique` | `id_campanha` | Clicou numa campanha |

Todos aceitam `sessao` (opcional).
```json
{ "tipo": "carrinho_adicionar", "id_produto": 15, "quantidade": 6, "sessao": "a1b2c3d4e5f6" }
```
`202`: `{ "registrado": true }`. Erros: `422 VALIDACAO` (tipo não aceito, campo faltando ou a mais), `429`.

**Registrados pelo próprio servidor** (o front não envia e a API recusa): `busca` e `busca_sem_resultado` (na `GET /produtos` com `busca`, só na 1ª página e não para a equipe) e `pedido_concluido` (no `POST /pedidos`).

### Métricas (equipe)
Todas aceitam `de` e `ate` (`AAAA-MM-DD`, inclusive; padrão: últimos 30 dias até hoje; máximo 366 dias).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/metricas/resumo` | Pedidos por status, unidades, clientes que compraram e contagem de eventos |
| GET | `/metricas/buscas?limite=10` | Termos mais buscados e buscas sem resultado |
| GET | `/metricas/produtos-mais-pedidos?limite=10` | Ranking em unidades |
| GET | `/metricas/clientes-inativos?dias=60&pagina=` | Clientes sem comprar há X dias |
| GET | `/metricas/funil` | Sessões distintas em cada etapa da compra e a taxa entre etapas |
| GET | `/metricas/produtos-vistos?limite=10` | Produtos mais abertos (visualizações e sessões) |
| GET | `/metricas/banners-campanhas` | Cliques por banner e por campanha |
| GET | `/metricas/pedidos-por-dia` | Pedidos criados em cada dia do período |
| GET | `/metricas/ciclo-pedido` | Tempo médio entre as etapas do pedido |

`limite`: 1 a 50 (padrão 10). Unidades, clientes e produtos mais pedidos **não contam pedidos cancelados**. Nenhuma métrica traz valores financeiros.

**Sessão** (em `funil`, `produtos-vistos` e `banners-campanhas`): o usuário logado, quando o evento tem token; senão, o `sessao` enviado pelo front. Eventos sem nenhum dos dois contam como visualização/clique, mas não como sessão. Um visitante que entra no meio do caminho passa a ser contado como o usuário logado.

`GET /metricas/resumo`:
```json
{
  "periodo": { "de": "2026-09-27", "ate": "2026-10-26" },
  "pedidos": {
    "total": 1,
    "por_status": { "Aguardando Separação": 1, "Em Separação": 0, "Saiu para Entrega": 0, "Entregue": 0, "Cancelado": 0 }
  },
  "unidades_pedidas": 5,
  "clientes_que_compraram": 1,
  "eventos": {
    "busca": 2, "busca_sem_resultado": 1, "produto_visto": 1, "carrinho_adicionar": 1,
    "checkout_iniciado": 1, "pedido_concluido": 1, "banner_clique": 1, "campanha_clique": 1
  }
}
```

`GET /metricas/buscas`:
```json
{
  "periodo": { "de": "2026-09-27", "ate": "2026-10-26" },
  "mais_buscadas": [
    { "termo": "sabonete", "total": 2, "sem_resultado": 0 },
    { "termo": "perfume importado", "total": 1, "sem_resultado": 1 }
  ],
  "sem_resultado": [{ "termo": "perfume importado", "total": 1, "ultima_vez": "2026-10-26T23:50:12.000Z" }]
}
```

`GET /metricas/produtos-mais-pedidos`:
```json
{ "periodo": { "...": "..." }, "produtos": [{ "id_produto": 1, "sku": "M-1", "nome": "Sabonete Lavanda", "unidades": 4, "pedidos": 1 }] }
```

`GET /metricas/clientes-inativos?dias=30` (`dias` de 1 a 730, padrão 60): clientes ativos sem pedido não cancelado no período, **incluindo quem nunca comprou**; quem está há mais tempo sem comprar vem primeiro.
```json
{
  "dias": 30,
  "clientes": [
    { "id_usuario": 3, "nome": "Cliente Sumido", "razao_social": "Sumido LTDA", "nome_exibicao": "Sumido LTDA",
      "cnpj": "11.222.333/0001-81", "email": "...", "telefone": "...", "criado_em": "...",
      "ultimo_pedido_em": null, "total_pedidos": 0 }
  ],
  "paginacao": { "total": 1, "pagina": 1, "limite": 20, "total_paginas": 1 }
}
```

`GET /metricas/funil`: cada etapa conta as sessões distintas que tiveram aquele evento no período, de forma independente (não exige que a sessão tenha passado pelas etapas anteriores). `pedido_concluido` vem do próprio checkout, então é sempre do usuário logado. `taxa_da_anterior` é a fração (0 a 1, 4 casas) em relação à etapa anterior; `null` na primeira etapa ou quando a anterior tem 0.
```json
{
  "periodo": { "de": "2026-09-27", "ate": "2026-10-26" },
  "etapas": [
    { "etapa": "produto_visto", "sessoes": 4, "taxa_da_anterior": null },
    { "etapa": "carrinho_adicionar", "sessoes": 2, "taxa_da_anterior": 0.5 },
    { "etapa": "checkout_iniciado", "sessoes": 2, "taxa_da_anterior": 1 },
    { "etapa": "pedido_concluido", "sessoes": 1, "taxa_da_anterior": 0.5 }
  ]
}
```

`GET /metricas/produtos-vistos` (`limite` de 1 a 50, padrão 10): em ordem de visualizações. `sku` e `nome` vêm `null` se o produto não existir mais.
```json
{ "periodo": { "...": "..." }, "produtos": [{ "id_produto": 1, "sku": "M-1", "nome": "Sabonete Lavanda", "visualizacoes": 3, "sessoes": 2 }] }
```

`GET /metricas/banners-campanhas`: só os itens com clique no período, em ordem de cliques. `titulo` vem `null` se o banner ou a campanha tiver sido excluído.
```json
{
  "periodo": { "...": "..." },
  "banners": [{ "id_banner": 2, "titulo": "Volta às aulas", "cliques": 3, "sessoes": 2 }],
  "campanhas": [{ "id_campanha": 1, "titulo": "Semana da higiene", "cliques": 1, "sessoes": 1 }]
}
```

`GET /metricas/pedidos-por-dia`: um item por dia do período (horário de Brasília), inclusive os dias sem pedido. `total` conta todos os pedidos criados no dia; `cancelados`, quantos deles estão cancelados hoje.
```json
{
  "periodo": { "de": "2026-10-01", "ate": "2026-10-03" },
  "dias": [
    { "data": "2026-10-01", "total": 0, "cancelados": 0 },
    { "data": "2026-10-02", "total": 2, "cancelados": 1 },
    { "data": "2026-10-03", "total": 1, "cancelados": 0 }
  ]
}
```

`GET /metricas/ciclo-pedido`: para os pedidos **feitos** no período, o tempo médio (em minutos, 1 casa) entre a entrada em cada status, pelo histórico do pedido. Cada etapa considera só os pedidos que já passaram pelos dois status (`pedidos`); sem nenhum, `media_minutos` vem `null`. Cancelamentos não entram.
```json
{
  "periodo": { "...": "..." },
  "etapas": [
    { "de": "Aguardando Separação", "para": "Em Separação", "pedidos": 2, "media_minutos": 120 },
    { "de": "Em Separação", "para": "Saiu para Entrega", "pedidos": 1, "media_minutos": 30 },
    { "de": "Saiu para Entrega", "para": "Entregue", "pedidos": 1, "media_minutos": 240 }
  ]
}
```

---

## 16. Consultas externas

Rotas públicas que consultam serviços de fora para ajudar o preenchimento do cadastro. Elas não usam o banco (respondem mesmo com `BANCO_INDISPONIVEL`) e o cadastro **não depende delas**: o endereço digitado à mão continua aceito. Detalhes de serviços, cache e tempo máximo no [guia técnico](GUIA_TECNICO.md#11-serviços-externos-cep-e-cnpj).

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cep/:cep` | público | Endereço de um CEP (limite: 30 por minuto por IP) |
| GET | `/cnpj/:cnpj` | público | Dados da empresa na Receita (limite: 20 por minuto por IP) |

### GET /cep/:cep
`:cep` com 8 dígitos, com ou sem hífen (`13870000` ou `13870-000`).
```json
{ "cep": "13870-000", "logradouro": "Rua das Flores", "bairro": "Centro", "cidade": "São João da Boa Vista", "estado": "SP" }
```
- O que o serviço não informar vem como texto vazio: cidades com CEP único não trazem `logradouro` nem `bairro`.
- `422 VALIDACAO`: formato inválido (campo `cep`).
- `404 CEP_NAO_ENCONTRADO`: o CEP não existe.
- `503 SERVICO_INDISPONIVEL`: os serviços de CEP estão fora do ar; peça para o usuário preencher à mão.
- `429 LIMITE_REQUISICOES`: mais de 30 consultas por minuto do mesmo IP.

### GET /cnpj/:cnpj
Para o front mostrar o nome da empresa antes de enviar o cadastro. Envie o CNPJ sem pontuação (`11222333000181`, `12ABC34501DE35`); com pontuação, codifique a barra (`encodeURIComponent`). Aceita CNPJ numérico e alfanumérico, em maiúsculas ou minúsculas.
```json
{ "cnpj": "11.222.333/0001-81", "razao_social": "MERCADINHO DA ESQUINA LTDA", "nome_fantasia": "MERCADINHO DA ESQUINA",
  "situacao": "ATIVA", "cidade": "SAO JOAO DA BOA VISTA", "estado": "SP" }
```
- `situacao` vem da Receita em maiúsculas (`ATIVA`, `BAIXADA`, `SUSPENSA`, `INAPTA`, `NULA`). Só `ATIVA` pode se cadastrar quando a consulta está ligada.
- O que a Receita não informar vem como texto vazio (ex.: `nome_fantasia`).
- `422 VALIDACAO`: CNPJ inválido (sem consultar a Receita).
- `404 CNPJ_NAO_ENCONTRADO`: o CNPJ não existe na Receita.
- `503 SERVICO_INDISPONIVEL`: os serviços de consulta estão fora do ar.
- `429 LIMITE_REQUISICOES`: mais de 20 consultas por minuto do mesmo IP.
- Funciona mesmo com `VALIDAR_CNPJ_RECEITA` desligado (a variável só controla o cadastro).
