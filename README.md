# Mantiqueira Distribuidora - API e Banco de Dados

Este repositório contém a estrutura da API REST (Node.js/Express) e do banco de dados (MySQL) desenvolvidos para o sistema de gerenciamento da distribuidora Mantiqueira, com suporte a autenticação JWT e controle de acesso baseado em funções (RBAC).

## 🚀 Tecnologias Utilizadas
* **Backend**: Node.js 20+, Express 5
* **Banco de Dados**: MySQL 8 com Sequelize ORM (`mysql2` como driver) e migrations SQL numeradas
* **Segurança**: JWT (`jsonwebtoken`), criptografia de senhas (`bcrypt`), `helmet`, limite de requisições
* **Testes**: `node:test` + `supertest`

## 📋 Pré-requisitos
* Node.js 20 ou superior.
* MySQL Server 8 (local) ou AWS RDS.

---

## 1. Instalação das Dependências
No terminal, na pasta raiz do projeto, execute:

```bash
npm install
```

## 2. Configuração de Variáveis de Ambiente (`.env`)
Copie o `.env.example` para `.env` e preencha. A API **valida as variáveis ao iniciar** e não sobe se algo estiver errado (por exemplo, `JWT_SECRET` com menos de 32 caracteres ou ainda com o valor de exemplo). Para gerar um segredo:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **Nota de Segurança**: O arquivo `.env` contém dados sensíveis e é ignorado pelo Git (via `.gitignore`). Para compartilhar a estrutura de variáveis com a equipe, utilize o arquivo `.env.example`.

Na nuvem, configure `NODE_ENV=production`, `DB_HOST` com o endpoint do AWS RDS e `CORS_ORIGINS` com o endereço do front-end (múltiplas origens separadas por vírgula). Defina `TRUST_PROXY=1` quando a API estiver atrás de um proxy, como Nginx.

O CORS permite por padrão `http://localhost:5173`, `http://localhost:3000` e `http://localhost:3001`, com credenciais.

## 3. Banco de Dados (migrations)
A estrutura do banco é versionada em `migrations/` (`001_*.sql`, `002_*.js`, ...). A API **não altera mais o banco sozinha** (o `sequelize.sync()` foi removido).

```bash
npm run migrar          # cria o banco se não existir e aplica as migrations pendentes
npm run migrar:status   # só lista o que está pendente
```

* **Banco novo**: rode `npm run migrar`, ou execute o `BancoMantiqueira.sql` no MySQL Workbench (ele é gerado a partir das migrations).
* **Banco existente** (criado pelo `BancoMantiqueira.sql` antigo ou pelo `sync()`): rode `npm run migrar`. A `002_normalizar_estrutura` converte status antigos de pedido, remove índices duplicados criados pelo `sync()` e corrige a FK que apagava pedidos junto com o cliente. Os scripts de `migrations/legado/` não precisam mais ser executados.
* Ao subir, a API avisa no log se houver migrations pendentes.

Para alterar o banco, **crie uma migration nova** com o próximo número (nunca edite uma já aplicada; o runner detecta pelo checksum) e depois rode `npm run schema:gerar` para atualizar o `BancoMantiqueira.sql`.

### Dados iniciais (seeds)

```bash
npm run seed:catalogo                         # importa seeds/catalogo_inicial.csv (38 produtos, upsert por SKU)
npm run seed:catalogo -- --simular            # mostra o que mudaria, sem gravar
npm run seed:catalogo -- --desativar-ausentes # também desativa produtos que não estão no CSV
npm run seed:dev                              # usuários de teste (recusa produção e RDS)
```

O `seed:catalogo` pode rodar quantas vezes quiser: só altera o que mudou e registra mudanças de estoque em `movimentacoes_estoque`. As imagens ficam no front; o CSV guarda só o caminho (`/img/...`).

O `seed:dev` cria os usuários abaixo, com a senha `Mantiqueira@2026` (troque com `SEED_SENHA`; `-- --redefinir-senhas` volta a senha dos já existentes):

| Perfil | Login |
|---|---|
| admin | `admin@mantiqueira.com` |
| gerente | `gerente@mantiqueira.com` |
| funcionario | `funcionario@mantiqueira.com` |
| cliente | CNPJ `11.222.333/0001-81` (e-mail `compras@mercadinho-exemplo.com.br`) |

## 4. Execução do Servidor

```bash
npm start      # produção (node server.js)
npm run dev    # desenvolvimento (nodemon)
```

Se o banco estiver fora do ar, a API sobe mesmo assim, responde `503` e tenta reconectar com espera crescente (1s, 2s, 4s... até 30s). Ao receber `SIGTERM`/`SIGINT`, ela termina as requisições em andamento e fecha as conexões antes de sair.

Os logs saem estruturados (JSON em produção, texto legível em desenvolvimento). Cada requisição recebe um `X-Request-Id`, devolvido no cabeçalho da resposta e incluído em todos os logs dela.

## 5. Testes

```bash
npm test
```

Os testes usam o banco `DB_NAME_TEST` (padrão `mantiqueira_test`), que é **apagado e recriado** a cada execução. Por segurança, o nome precisa terminar com `_test`.

---

## 📌 Convenções da API

* Todas as rotas ficam sob **`/api/v1`**. Exceções: `GET /saude` e os arquivos em `/arquivos/...`.
* Erros sempre no formato:

```json
{ "sucesso": false, "mensagem": "Texto para o usuário.", "codigo": "NAO_AUTENTICADO", "detalhes": {} }
```

`detalhes` é opcional. Códigos gerais: `REQUISICAO_INVALIDA` (400), `JSON_INVALIDO` (400), `NAO_AUTENTICADO` (401), `ACESSO_NEGADO` (403), `NAO_ENCONTRADO` / `ROTA_NAO_ENCONTRADA` (404), `CONFLITO` (409), `CORPO_MUITO_GRANDE` (413), `VALIDACAO` (422), `LIMITE_REQUISICOES` (429), `ERRO_INTERNO` (500), `BANCO_INDISPONIVEL` (503).

## 📌 Principais Endpoints da API

* `GET /saude` - Público. Responde `200` com `{ status: "ok", banco: "conectado", uptime_segundos, iniciado_em, versao, ultima_sincronizacao }` ou `503` com `status: "degradado"` quando o banco não responde.

### Painel, pedidos e CMS
* `GET /api/v1/painel` - Retorna pedidos pendentes, clientes e produtos com estoque baixo. Requer JWT de `gerente`, `funcionario` ou `admin`; a resposta contém apenas indicadores operacionais.
* `GET /api/v1/painel/contadores` - Retorna os contadores operacionais `pedidosPendentes` e `estoqueBaixo` para os badges do menu. Requer JWT de `gerente`, `funcionario` ou `admin`.
* `GET /api/v1/painel/alertas-reposicao` - Lista produtos com estoque até 10 unidades e sugestão de compra até o alvo operacional de 50 unidades. Restrito a `gerente` e `admin`.
* `POST /api/v1/pedidos` - Cria um pedido para o cliente autenticado. Envie `itens` como uma lista de `{ "id_produto": 1, "quantidade": 2 }`. O estoque e os itens são gravados na mesma transação.
* `GET /api/v1/pedidos/:id_pedido` - Permite ao cliente consultar apenas o próprio pedido; `gerente` e `admin` podem consultar qualquer pedido. Retorna status, datas e itens operacionais, sem valores financeiros.
* `GET /api/v1/pedidos` - Lista pedidos com cliente, funcionário e itens, sem valores financeiros. Requer JWT de `gerente`, `funcionario` ou `admin`.
* `PUT /api/v1/pedidos/:id_pedido/status` - Atualiza o status para `Aguardando Separação`, `Em Separação`, `Saiu para Entrega` ou `Entregue`. Restrito a `gerente` e `admin`; ao entregar, registra `data_entrega` e emite uma notificação simulada no log. O endpoint legado `PATCH` permanece com as mesmas permissões.
* `GET /api/v1/cms` - Lista os banners ativos.
* `POST /api/v1/cms` - Salva um banner, restrito a `gerente`, `funcionario` ou `admin`. Envie multipart/form-data com `titulo`, opcionalmente `link`, e arquivo `imagem` (JPEG, PNG, WEBP ou GIF; até 5 MB).
* `GET /arquivos/uploads/:arquivo` - Serve as imagens enviadas ao CMS.

### Autenticação (`/api/v1/auth`)
* `POST /api/v1/auth/register` - Cadastra um usuário (`nome`, `email`, `senha`, `telefone` e, opcionalmente, `razao_social` e `cnpj_cpf`); a senha deve ter de 8 a 72 caracteres e o tipo inicial é `cliente`.
* `POST /api/v1/auth/login` - Autentica o usuário e retorna o **Token JWT** com `id`, `nome`, `email` e `tipo`, além do objeto `usuario` sem a senha.
* `GET /api/v1/auth/me` - Retorna `id`, `nome`, `email` e `tipo` do usuário autenticado. Requer `Authorization: Bearer <token>`.
* `GET /api/v1/auth/users` - Lista os usuários sem expor as senhas; restrito a `gerente` e `admin`.

### Produtos (`/api/v1/produtos`)
As rotas de leitura são **públicas**. O que aparece depende de quem pergunta: o visitante vê `disponibilidade` (`disponivel`, `ultimas_unidades` ou `indisponivel`); quem está logado também vê `estoque` exato; a equipe vê ainda `preco`, `estoque_minimo`, `ativo` e datas. O preço nunca aparece para clientes.

* `GET /api/v1/produtos` - Vitrine com busca e filtros. Parâmetros (todos opcionais):
  * `busca`: termos separados por espaço; todos precisam aparecer em nome, SKU, descrição, marca ou categoria. Ignora acentos e maiúsculas (`locao` encontra "Loção").
  * `categoria` e `marca`: slug ou id, vários separados por vírgula (`marca=bic,risque`).
  * `disponibilidade`: `disponivel`, `ultimas_unidades`, `indisponivel` ou `em_estoque` (as duas primeiras).
  * `ordenar`: `relevancia` (padrão com busca), `nome` (padrão sem busca), `nome_desc`, `recentes`; a equipe também pode usar `estoque` e `estoque_desc`.
  * `pagina` e `limite` (padrão 24, máximo 100). A equipe pode enviar `incluir_inativos=true`.
  * Resposta: `{ produtos: [...], paginacao: { total, pagina, limite, total_paginas } }`.
* `GET /api/v1/produtos/sugestoes?busca=gran` - Autocomplete: até 8 produtos, 3 categorias e 3 marcas. Exige 2 caracteres ou mais.
* `GET /api/v1/produtos/filtros` - Categorias e marcas com a contagem de produtos e contagem por disponibilidade. Aceita os mesmos filtros da listagem; cada contagem considera os outros filtros escolhidos.
* `GET /api/v1/produtos/:id` - Um produto, por id ou SKU (`/produtos/SKU-115`). Produto desativado só aparece para a equipe.
* `POST /api/v1/produtos` - Cadastra (`gerente`/`admin`). Obrigatórios: `sku` e `nome`. Opcionais: `descricao`, `destaques` (lista de textos), `imagem_url`, `id_categoria`, `id_marca`, `id_fornecedor`, `preco`, `estoque_minimo` (padrão 10), `multiplo_venda` (padrão 1), `ativo` e `quantidade_estoque` inicial.
* `PUT /api/v1/produtos/:id` - Substitui os dados (`gerente`/`admin`); campos opcionais omitidos voltam ao padrão. `PATCH` altera só os campos enviados. Nenhum dos dois altera o estoque.
* `PATCH /api/v1/produtos/:id/estoque` - Ajusta o estoque (`funcionario`/`gerente`/`admin`). Envie `{ "quantidade": 120, "observacao": "Inventário" }` para definir o valor, ou `{ "ajuste": -5, "observacao": "Avaria" }` para somar/subtrair. Nunca deixa negativo (`409 ESTOQUE_INSUFICIENTE`).
* `GET /api/v1/produtos/:id/movimentacoes` - Histórico de estoque com usuário e observação (equipe).
* `DELETE /api/v1/produtos/:id` - Desativa o produto (não apaga). Para reativar: `PATCH { "ativo": true }`.
* `POST /api/v1/produtos/:id/imagem` - Envia a imagem (multipart, campo `imagem`, até 5 MB) e atualiza `imagem_url`.

Erros de validação voltam com `422 VALIDACAO` e a lista de todos os campos com problema em `detalhes: [{ campo, mensagem }]`. SKU repetido: `409 SKU_DUPLICADO`.

### Categorias e marcas (`/api/v1/categorias`, `/api/v1/marcas`)
* `GET` - Públicas, com `total_produtos` ativos. A equipe pode enviar `incluir_inativos=true`.
* `POST` (`nome`, opcionalmente `slug` e, nas categorias, `ordem`), `PUT`/`PATCH /:id` e `DELETE /:id` - `gerente`/`admin`. O slug é gerado do nome (`Loja do bebê` → `loja-do-bebe`). Só é possível excluir se nenhum produto usar (`409 EM_USO`); caso contrário, desative com `{ "ativo": false }`.

### Clientes (`/api/v1/clientes`)
* `GET /api/v1/clientes?busca=texto&pagina=1&limite=20` - Lista clientes com busca por nome, razão social ou CNPJ/CPF e paginação. Restrito a `gerente` e `admin`.
* `GET /api/v1/clientes/:id/detalhes` - Retorna dados cadastrais, endereços de entrega, histórico operacional de pedidos e produtos mais solicitados.
* `PUT /api/v1/clientes/:id` - Atualiza `razao_social`, `cnpj_cpf`, `telefone` e/ou `enderecos`. Cada endereço pode incluir `id_endereco` para atualizar um endereço existente; sem esse identificador, um endereço novo é cadastrado. Endereços omitidos não são removidos.

Clientes mantêm dados operacionais/comerciais (`razao_social`, `cnpj_cpf`, `telefone` e endereços de entrega). Nenhum dado bancário, de cartão ou limite de crédito é armazenado. Em uma atualização de status para `Entregue`, o pedido registra `data_entrega`.
