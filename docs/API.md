# API Mantiqueira — contrato para o front-end

Versão da API: **v1**. Os exemplos abaixo foram capturados da API rodando com o catálogo do seed.

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

---

## 1. Convenções

### URL base
- API: `http://localhost:3000/api/v1` (em produção, o domínio da EC2/Nginx + `/api/v1`).
- Exceções fora de `/api/v1`: `GET /saude`, `GET /saude/detalhado` e os arquivos enviados em `GET /arquivos/uploads/...`.
- Imagens: `imagem_url` começando com `/img/` é do **front** (pasta pública do React); começando com `/arquivos/` é da **API** (prefixe com o endereço da API).

### Autenticação
Envie o token do login em todas as rotas protegidas:
```
Authorization: Bearer <token>
```
O token vale **2 horas**. A cada requisição a API confere se o usuário existe e está ativo; usuário desativado perde o acesso na hora (`401`).

### Perfis
| Perfil (`usuario.tipo`) | Entra com | Acesso |
|---|---|---|
| `cliente` | CNPJ + senha | Vitrine, checkout, os próprios pedidos e a própria conta |
| `equipe` | e-mail + senha | Toda a área do gestor. `cargo` é texto livre e não muda permissões |
| `equipe` com `pode_gerenciar_equipe: true` | e-mail + senha | Tudo da equipe + gestão de usuários (`/admin`) |

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
| 404 | `NAO_ENCONTRADO`, `ROTA_NAO_ENCONTRADA`, `PRODUTO_NAO_ENCONTRADO`, `PEDIDO_NAO_ENCONTRADO`, `ENDERECO_NAO_ENCONTRADO`, `USUARIO_NAO_ENCONTRADO` |
| 409 | `CONFLITO` e os específicos de cada rota (ex.: `ITENS_INDISPONIVEIS`, `TRANSICAO_INVALIDA`) |
| 413 | `CORPO_MUITO_GRANDE` |
| 422 | `VALIDACAO`, `CSV_INVALIDO`, `ENDERECO_OBRIGATORIO` |
| 429 | `LIMITE_REQUISICOES`, `MUITAS_TENTATIVAS` (login/cadastro) |
| 500 | `ERRO_INTERNO` (a mensagem nunca expõe detalhes internos) |
| 503 | `BANCO_INDISPONIVEL` |

### Listas paginadas
Parâmetros `pagina` (padrão 1) e `limite` (padrão e máximo variam por rota). Resposta:
```json
{ "produtos": [ ... ], "paginacao": { "total": 38, "pagina": 1, "limite": 24, "total_paginas": 2 } }
```

### Outros
- Datas e horas nas respostas: ISO 8601 em UTC (`2026-10-26T23:27:34.000Z`). Campos só de data (`data_entrega_desejada`): `AAAA-MM-DD`.
- Envie JSON em UTF-8 (`Content-Type: application/json`). Corpo máximo: 200 KB.
- Toda resposta tem o cabeçalho `X-Request-Id`; informe-o ao relatar um erro.
- Limite geral: 100 requisições por minuto por IP em `/api/v1`.
- **Nenhuma resposta tem valores financeiros** (preço, total, desconto). O `preco` do produto só aparece para a equipe.
- Campos sempre em `snake_case`. CNPJ sempre formatado nas respostas (`11.222.333/0001-81`); nas requisições, aceito com ou sem pontuação.
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
Sempre cria um **cliente**. Todos os campos são obrigatórios, exceto `complemento` e `referencia` do endereço. O CNPJ pode vir com ou sem pontuação e precisa ter dígitos verificadores válidos. O endereço vira o principal. Limite: 10 cadastros por hora por IP.
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
- **Qualquer falha** (formato, usuário inexistente, perfil errado, senha errada, inativo) devolve o mesmo `401`:
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
| `busca` | Termos separados por espaço; **todos** precisam aparecer em nome, SKU, descrição, marca ou categoria. Ignora acentos e maiúsculas (`locao` encontra "Loção"). Até 100 caracteres. |
| `categoria`, `marca` | Slug ou id; vários separados por vírgula (`marca=bic,risque`) |
| `disponibilidade` | `disponivel`, `ultimas_unidades`, `indisponivel` ou `em_estoque` (as duas primeiras) |
| `ordenar` | `relevancia` (padrão com busca), `nome` (padrão sem busca), `nome_desc`, `recentes`; equipe também `estoque`, `estoque_desc` |
| `pagina`, `limite` | Padrão 24, máximo 100 |
| `incluir_inativos=true` | Só equipe |

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
Exige 2 caracteres ou mais (menos que isso devolve listas vazias).
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
Só `sku` e `nome` são obrigatórios. `quantidade_estoque` é o estoque inicial (gera movimentação). `201`: `{ "mensagem": "Produto cadastrado com sucesso.", "id_produto": 39, "produto": { ... } }`.
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

O formato do CSV, as colunas e os jobs estão no [README](../README.md#importação-de-catálogo-csv). Exemplos prontos em `importacao/exemplos/`.

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
| POST | `/pedidos` | cliente | Checkout |
| GET | `/pedidos/meus` | cliente | Pedidos do cliente |
| GET | `/pedidos` | equipe | Todos, com filtros |
| GET | `/pedidos/:id_pedido` | equipe, ou cliente dono | Detalhe com histórico |
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
`"status": "Cancelado"` aqui dá `422` (use a rota de cancelamento). Ao entregar, registra `data_entrega`.

### POST /pedidos/:id_pedido/cancelar
```json
{ "motivo": "Cliente desistiu" }
```
`200`:
```json
{ "mensagem": "Pedido cancelado. O estoque dos itens foi devolvido.", "pedido": { "id_pedido": 1, "status": "Cancelado", "motivo_cancelamento": "Cliente desistiu" } }
```
Erros: `422 VALIDACAO` (motivo com 3 a 500 caracteres), `409 CANCELAMENTO_NAO_PERMITIDO` (`detalhes.status_atual`), `404` para cliente que não é dono.

---

## 7. Clientes

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/clientes` | equipe | Lista com busca e paginação |
| GET | `/clientes/:id/detalhes` | equipe | Dados, endereços, histórico e produtos mais pedidos |
| PUT | `/clientes/:id` | equipe | Atualiza dados operacionais |

### GET /clientes
`?busca=&pagina=&limite=&sem_cnpj=true` (padrão 20, máximo 100). `busca` procura em nome, razão social, e-mail e CNPJ (com ou sem pontuação). `sem_cnpj=true` lista quem não consegue entrar por falta de CNPJ válido.
```json
{
  "clientes": [
    { "id_usuario": 2, "nome": "Maria Souza", "razao_social": null, "nome_exibicao": "Maria Souza", "cnpj": "11.222.333/0001-81",
      "cnpj_original": null, "email": "compras@mercadinho.com", "telefone": "19999990000", "ativo": true,
      "criado_em": "2026-10-26T23:27:34.000Z" }
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

### PUT /clientes/:id
Um ou mais de: `razao_social`, `cnpj` (válido e único; corrigir limpa a pendência de `cnpj_original`), `telefone`, `ativo` (bloqueia/desbloqueia o login) e `enderecos` (lista; com `id_endereco` atualiza, sem ele cria; os omitidos não são removidos). `200`: `{ "mensagem": "Dados operacionais do cliente atualizados.", "cliente": { ... } }`. Erros: `422` (CNPJ inválido), `409 CNPJ_JA_CADASTRADO`, `404`.

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
Campos: `nome`, `email`, `senha`, `cargo`, `telefone`, `pode_gerenciar_equipe`, `ativo`. Para clientes, só `ativo`. Regras (`409 OPERACAO_NAO_PERMITIDA`): ninguém desativa a si mesmo; a marca não sai do último usuário ativo que a tem.

---

## 9. Painel

Todas: **equipe**. "Estoque baixo" = produto ativo com estoque menor ou igual ao `estoque_minimo` dele.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/painel` | `{ "pedidos_pendentes": 0, "estoque_baixo": 5, "clientes_ativos": 1 }` |
| GET | `/painel/contadores` | `{ "pedidos_pendentes": 0, "estoque_baixo": 5 }` |
| GET | `/painel/alertas-reposicao` | Ver abaixo |

`pedidos_pendentes` conta `Aguardando Separação` + `Em Separação`; `clientes_ativos` conta clientes não bloqueados.

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

- `GET /cms`: `{ "banners": [{ "id_banner": 1, "titulo": "Promo", "link": "/promocoes", "imagem_url": "/arquivos/uploads/<uuid>.png", "ordem": 1 }] }`.
- `GET /cms/todos`: objetos completos (`ativo`, `inicio_em`, `fim_em`, `criado_em`, `atualizado_em`) + `situacao`: `no_ar`, `agendado`, `expirado` ou `inativo`.
- `POST /cms` (multipart): `titulo` e `imagem` obrigatórios; opcionais `link` (caminho interno ou URL http/https), `ordem`, `ativo`, `inicio_em`, `fim_em`. Datas sem fuso são horário de Brasília (`2026-11-01T08:00`). `201`: `{ "mensagem": "Banner salvo com sucesso.", "banner": { ... } }`.
- `PATCH /cms/:id`: os mesmos campos, todos opcionais; com nova `imagem`, a anterior é apagada; `null` em `inicio_em`/`fim_em` remove a janela.
- `PUT /cms/ordem`: `{ "ids": [3, 1, 2] }` com **todos** os banners; devolve a lista completa reordenada.
- Erros: `422 VALIDACAO` (ex.: `fim_em` antes de `inicio_em`), `404`.

### Blocos de conteúdo
| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cms/blocos` | público | Blocos ativos (equipe vê todos) |
| GET | `/cms/blocos/:chave` | público | Um bloco (inativo só para a equipe) |
| PUT | `/cms/blocos/:chave` | equipe | Cria ou substitui |
| DELETE | `/cms/blocos/:chave` | equipe | Exclui |

`PUT /cms/blocos/politica-de-entrega`:
```json
{ "titulo": "Política de entrega", "conteudo": "Entregamos em até 2 dias úteis.", "ativo": true }
```
`200`: `{ "mensagem": "Bloco de conteúdo salvo.", "bloco": { "id_bloco": 1, "chave": "politica-de-entrega", "titulo": "...", "conteudo": "...", "ativo": true, "atualizado_em": "..." } }`. A chave usa só letras minúsculas, números e hífens.

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
{ "status": "ok", "banco": "conectado", "uptime_segundos": 4, "iniciado_em": "2026-10-26T23:27:33.479Z", "versao": "1.0.0", "ultima_sincronizacao": null }
```
`503` com `"status": "degradado"` e `"banco": "indisponivel"` quando o banco não responde.

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
6. A razão social não faz parte do cadastro; clientes novos têm `razao_social: null` até a equipe preencher em `PUT /clientes/:id`. Use `nome_exibicao` para exibir.
7. Os objetos de pedido em `historico_pedidos` (detalhes do cliente) vêm no formato do banco, mais simples que o de `GET /pedidos` (sem `pode_cancelar`, `total_itens` nem `sku` nos itens).
8. Datas e horas vêm em UTC; converta para o fuso de Brasília na exibição.
9. Imagens do catálogo (`/img/...`) são servidas pelo front; imagens enviadas pela API (`/arquivos/uploads/...`) ficam no disco do servidor e são perdidas se a instância for recriada (não há S3).

**Autenticação**
10. Não há recuperação de senha. A equipe redefine senhas de outros usuários da equipe em `PATCH /admin/usuarios/:id`, mas **não existe forma de redefinir a senha de um cliente** que a esqueceu.
11. Não há refresh token: depois de 2 horas o usuário precisa entrar de novo. "Sair" é só descartar o token no front (ele continua válido até expirar, a menos que o usuário seja desativado).
12. Os limites de requisições ficam na memória de cada instância: com várias instâncias, o limite efetivo é multiplicado; reiniciar a API zera as contagens.

**Pedidos e notificações**
13. A notificação de mudança de status é só um registro no log; o cliente não recebe e-mail nem mensagem.
14. Não há edição de pedido: para mudar itens, cancela-se e faz-se outro (enquanto o status permitir).

**Busca e catálogo**
15. A busca é por trechos de texto (sem tolerância a erros de digitação: "colgat" encontra, "golgate" não). Adequada para milhares de produtos.
16. Desativar uma categoria ou marca não esconde os produtos dela: ela some de `GET /categorias` / `GET /marcas`, mas os produtos continuam na vitrine e ela ainda aparece nas contagens de `GET /produtos/filtros`. Para tirar produtos da vitrine, desative os produtos.
17. `DELETE /produtos/:id` apenas desativa; não existe exclusão definitiva de produto. Já a exclusão de banner é definitiva e apaga a imagem.

**Ferramentas**
18. Testando com `curl` no Windows, acentos no corpo da requisição podem chegar fora do UTF-8 (`"Em Separação"` dá `422`). Use Insomnia/Postman ou envie o corpo de um arquivo UTF-8 (`--data-binary @arquivo.json`). O navegador não tem esse problema.
