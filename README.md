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

| Perfil | Login | Observação |
|---|---|---|
| equipe | `admin@mantiqueira.com` | cargo "Administrador", **pode gerenciar a equipe** |
| equipe | `gerente@mantiqueira.com` | cargo "Gerente" |
| equipe | `funcionario@mantiqueira.com` | cargo "Estoquista" |
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

> O contrato completo, com exemplos de requisição e resposta de cada endpoint e as limitações conhecidas, está em [`docs/API.md`](docs/API.md).

* Todas as rotas ficam sob **`/api/v1`**. Exceções: `GET /saude` e os arquivos em `/arquivos/...`.
* Erros sempre no formato:

```json
{ "sucesso": false, "mensagem": "Texto para o usuário.", "codigo": "NAO_AUTENTICADO", "detalhes": {} }
```

`detalhes` é opcional. Códigos gerais: `REQUISICAO_INVALIDA` (400), `JSON_INVALIDO` (400), `NAO_AUTENTICADO` (401), `ACESSO_NEGADO` (403), `NAO_ENCONTRADO` / `ROTA_NAO_ENCONTRADA` (404), `CONFLITO` (409), `CORPO_MUITO_GRANDE` (413), `VALIDACAO` (422), `LIMITE_REQUISICOES` (429), `ERRO_INTERNO` (500), `BANCO_INDISPONIVEL` (503).

## 📌 Principais Endpoints da API

* `GET /saude` - Público. Responde `200` com `{ status: "ok", banco: "conectado", uptime_segundos, iniciado_em, versao, ultima_sincronizacao }` ou `503` com `status: "degradado"` quando o banco não responde.

### Painel
"Estoque baixo" é um produto ativo com estoque menor ou igual ao **`estoque_minimo` do próprio produto** (padrão 10, editável no produto).

* `GET /api/v1/painel` - `{ pedidos_pendentes, estoque_baixo, clientes_ativos }`. Equipe.
* `GET /api/v1/painel/contadores` - `{ pedidos_pendentes, estoque_baixo }` para os badges do menu. Equipe.
* `GET /api/v1/painel/alertas-reposicao` - `{ meta_reposicao, alertas: [{ produto, estoque_atual, estoque_minimo, sugestao_compra }] }`. A sugestão completa o estoque até a meta, definida na configuração `meta_reposicao` (padrão 50). Equipe.

### Pedidos (`/api/v1/pedidos`)
Nenhuma resposta de pedido tem valores financeiros. Ciclo: `Aguardando Separação` → `Em Separação` → `Saiu para Entrega` → `Entregue`, com cancelamento (`Cancelado`) permitido até `Em Separação`.

* `POST /api/v1/pedidos` - Checkout (só `cliente`):
  ```json
  { "itens": [{ "id_produto": 15, "quantidade": 6 }], "id_endereco": 3, "observacao": "opcional", "data_entrega_desejada": "2026-11-05" }
  ```
  `id_endereco` é opcional (padrão: o endereço principal) e precisa ser do cliente; uma cópia do endereço fica gravada no pedido. A data desejada vai de amanhã até 90 dias. Itens repetidos são somados. Se algum item tiver problema, **nada é gravado** e a resposta `409 ITENS_INDISPONIVEIS` traz **todos** os itens com problema em `detalhes`: `{ id_produto, sku, nome, solicitado, disponivel, multiplo_venda, motivo }`, com `motivo` igual a `produto_inexistente`, `produto_inativo`, `multiplo_de_venda` ou `estoque_insuficiente`. `disponivel` é a maior quantidade que pode ser pedida agora, respeitando o múltiplo de venda. Pedido, itens, baixa de estoque, movimentações e histórico são gravados na mesma transação, e pedidos simultâneos não usam o mesmo estoque.
* `GET /api/v1/pedidos/meus?status=&pagina=&limite=` - Pedidos do cliente logado.
* `GET /api/v1/pedidos?status=&id_cliente=&de=&ate=&busca=&pagina=&limite=` - Todos os pedidos (equipe). `status` aceita vários separados por vírgula; `de`/`ate` no formato `AAAA-MM-DD` (data do pedido, inclusive); `busca` procura pelo número do pedido ou pelo nome, razão social, e-mail ou CNPJ do cliente.
* `GET /api/v1/pedidos/:id_pedido/repetir` - Cliente dono: sugere os itens de um pedido anterior ajustados ao estoque, ao múltiplo de venda e aos produtos ativos de agora; `itens_para_checkout` vai direto para `POST /pedidos`.
* `GET /api/v1/pedidos/:id_pedido` - Detalhe com itens e `historico` (quem mudou cada status, quando e com qual observação). A equipe vê qualquer pedido; o cliente só os próprios (o de outro cliente responde `404`).
* `PUT /api/v1/pedidos/:id_pedido/status` - `{ "status": "Em Separação", "observacao": "opcional" }` (equipe; `PATCH` também funciona). Só aceita o próximo passo do ciclo; pular ou voltar dá `409 TRANSICAO_INVALIDA` com `proximo_permitido` em `detalhes`. Grava quem mudou em `id_funcionario` e no histórico; ao entregar, registra `data_entrega`.
* `POST /api/v1/pedidos/:id_pedido/cancelar` - `{ "motivo": "..." }` (3 a 500 caracteres). O cliente cancela só o próprio pedido e só em `Aguardando Separação`; a equipe cancela até `Em Separação`. O estoque de todos os itens volta na mesma transação, com movimentação do tipo `cancelamento`. Fora dessas condições: `409 CANCELAMENTO_NAO_PERMITIDO`.

Cada pedido nas respostas traz `pode_cancelar` (para quem fez a requisição) e, para a equipe, `cliente`, `funcionario` e `proximo_status`.

> Testando com `curl` no Windows: o terminal pode enviar acentos fora do UTF-8 (`"Em Separação"` chega errado e a API responde `422`). Grave o corpo em um arquivo UTF-8 e use `--data-binary @arquivo.json`, ou use Insomnia/Postman.

### CMS (`/api/v1/cms`)
**Banners.** Datas sem fuso (`2026-11-01T08:00`) são consideradas no horário de Brasília.
* `GET /api/v1/cms` - Público: banners no ar (ativos e dentro da janela `inicio_em`/`fim_em`), na `ordem` definida.
* `GET /api/v1/cms/todos` - Equipe: todos, com `situacao` (`no_ar`, `agendado`, `expirado` ou `inativo`).
* `POST /api/v1/cms` - Equipe, multipart: `titulo`, `imagem` (JPEG, PNG, WEBP ou GIF; até 5 MB) e opcionalmente `link`, `ordem`, `ativo`, `inicio_em`, `fim_em`. Sem `ordem`, vai para o fim da fila.
* `PATCH /api/v1/cms/:id` - Equipe, JSON ou multipart: os mesmos campos; com nova `imagem`, a anterior é apagada. `{ "ativo": false }` desativa; `null` em `inicio_em`/`fim_em` remove a janela.
* `PUT /api/v1/cms/ordem` - Equipe: `{ "ids": [3, 1, 2] }` com **todos** os banners na nova ordem.
* `DELETE /api/v1/cms/:id` - Equipe: exclui o banner e a imagem.
* `GET /arquivos/uploads/:arquivo` - Serve as imagens enviadas.

**Blocos de conteúdo** (textos editáveis do site, identificados por chave, ex.: `sobre`, `politica-de-entrega`):
* `GET /api/v1/cms/blocos` e `GET /api/v1/cms/blocos/:chave` - Públicos (só ativos; a equipe vê também os inativos).
* `PUT /api/v1/cms/blocos/:chave` - Equipe: `{ titulo?, conteudo, ativo? }` cria ou substitui. A chave usa letras minúsculas, números e hífens.
* `DELETE /api/v1/cms/blocos/:chave` - Equipe.

### Campanhas (`/api/v1/campanhas`)
Sem desconto: título, selo de texto (até 40 caracteres), período e produtos. Situação calculada pelas datas (`agendada`, `ativa`, `encerrada`).
* `GET /api/v1/campanhas/ativas` - Público: campanhas no período, com os produtos ativos no formato da vitrine.
* `GET /api/v1/campanhas?situacao=`, `GET /:id`, `POST`, `PATCH /:id` (produtos substitui a lista), `DELETE /:id` - Equipe.

### Eventos e métricas
* `POST /api/v1/eventos` - Público: `produto_visto`, `carrinho_adicionar`, `checkout_iniciado`, `banner_clique`, `campanha_clique`. Sem IP; associa ao usuário se houver token. Busca e pedido concluído são registrados pelo servidor.
* `GET /api/v1/metricas/resumo`, `/buscas`, `/produtos-mais-pedidos`, `/clientes-inativos?dias=` - Equipe; período com `de`/`ate` (padrão: últimos 30 dias).

### Configurações (`/api/v1/configuracoes`)
* `GET /api/v1/configuracoes/publicas` - Público: `{ whatsapp, telefone_contato, email_contato, horario_atendimento, aviso_topo }` (`null` quando não preenchido).
* `GET /api/v1/configuracoes` - Equipe: todas, com descrição e se são públicas (inclui a privada `meta_reposicao`).
* `PUT /api/v1/configuracoes/:chave` - Equipe: `{ "valor": ... }`; `null` limpa. Cada chave é validada: `whatsapp` com DDI e DDD (12–13 dígitos), `telefone_contato` com DDD, `email_contato` válido, textos até 200 caracteres, `meta_reposicao` inteiro positivo. Chave desconhecida: `404`.

### Importação de catálogo (CSV)
O formato é o mesmo do `seeds/catalogo_inicial.csv`: separador `;` (ou `,`), cabeçalho na primeira linha, UTF-8 ou Windows-1252 (o padrão do Excel). Só `sku` é obrigatória; **colunas ausentes não são alteradas**.

| Coluna | Conteúdo |
|---|---|
| `sku` | Identificador do produto (upsert por SKU) |
| `nome` | Obrigatório para produto novo |
| `categoria`, `marca` | Nome; criadas automaticamente se não existirem |
| `descricao` | Texto |
| `destaques` | Itens separados por `|` |
| `imagem_url` | Caminho do front (`/img/x.webp`) ou URL |
| `ativo` | `sim` ou `nao` |
| `estoque_minimo`, `multiplo_venda` | Inteiros |
| `preco` | Opcional; nunca aparece para clientes |
| `estoque` | Quantidade atual; vazio mantém o estoque. Mudanças viram movimentações `importacao` |

Cada linha é validada separadamente: as boas são gravadas e as com problema voltam em `relatorio.erros` (`linha`, `sku`, `campo`, `mensagem`).

* `POST /api/v1/produtos/importar` - Equipe, multipart com o arquivo no campo `arquivo` (.csv, até 5 MB). `?simular=true` mostra o resultado sem gravar; `?carga_completa=true` também desativa os produtos que não estão no arquivo. Resposta: `{ id_sincronizacao, status, relatorio: { linhas, criados, atualizados, inalterados, desativados, com_erro, movimentacoes_estoque, erros, avisos } }`.
* `GET /api/v1/produtos/importacoes?tipo=&pagina=` e `GET /api/v1/produtos/importacoes/:id` - Histórico (`sincronizacoes_log`), incluindo as execuções dos jobs; o detalhe traz o relatório de erros.

`status`: `sucesso`, `parcial` (algumas linhas rejeitadas) ou `falha` (arquivo ilegível ou todas as linhas com erro). **Proteção:** a carga completa só desativa produtos ausentes quando o arquivo não tem nenhum erro; um arquivo vazio ou truncado não esvazia o catálogo.

#### Jobs agendados (fuso America/Sao_Paulo)
A API lê arquivos colocados em `importacao/entrada/` (pasta configurável em `IMPORTACAO_DIR`):

| Job | Quando | Arquivos | O que faz |
|---|---|---|---|
| `carga-completa` | Meia-noite | `catalogo*.csv` | Importa tudo e desativa produtos ausentes |
| `estoque` | A cada 30 min | `estoque*.csv` | Aplica só `sku` e `estoque` (outras colunas são ignoradas) |
| `limpeza-eventos` | 3h | — | Apaga eventos de uso com mais de 12 meses |

Arquivos de exemplo para demonstração ficam em `importacao/exemplos/` (fora das pastas lidas pelos jobs): `catalogo_exemplo.csv` (o catálogo completo com 1 produto novo e 4 alterações, seguro para a carga completa) e `estoque_exemplo.csv` (4 atualizações e 1 SKU inexistente, para mostrar o relatório de erros). Para testar um job, copie o arquivo para `importacao/entrada/`.

Os arquivos são processados em ordem alfabética (use data/hora no nome, ex.: `estoque_20261026_1430.csv`) e depois movidos para `processados/` ou `rejeitados/`, com um `.relatorio.json` ao lado. Cada execução fica em `sincronizacoes_log`. Uma trava do MySQL (`GET_LOCK`) garante que, com várias instâncias da API, só uma rode cada job, e que job e upload não importem ao mesmo tempo. `JOBS_ATIVOS=false` desliga os jobs.

### Saúde
* `GET /saude` - Público (ver acima). `ultima_sincronizacao` é a data da última importação gravada (upload ou job).
* `GET /saude/detalhado` - Equipe: banco (latência e migrations pendentes), processo (uptime, memória, versão do Node), jobs (última e próxima execução, último resultado ou erro) e data da última sincronização de cada tipo.

### Autenticação e contas
Plataforma B2B: **clientes entram com CNPJ** e **a equipe entra com e-mail**.

* `POST /api/v1/auth/register` - Cadastro público, sempre como `cliente`. Todos os campos são obrigatórios:
  ```json
  {
    "cnpj": "11.222.333/0001-81",
    "nome": "Maria (responsável)",
    "email": "compras@mercadinho.com",
    "telefone": "(19) 99999-0000",
    "senha": "mínimo 8 caracteres",
    "endereco": { "cep": "13870-000", "logradouro": "Rua X", "numero": "100", "complemento": "opcional",
                  "bairro": "Centro", "cidade": "São João da Boa Vista", "estado": "SP", "referencia": "opcional" }
  }
  ```
  O CNPJ precisa ter dígitos verificadores válidos e é gravado só com dígitos. A razão social não faz parte do cadastro; a equipe pode preenchê-la em `PUT /clientes/:id`. O endereço vira o principal; outros são adicionados em `/minha-conta/enderecos`. Erros: `422 VALIDACAO` (com todos os campos em `detalhes`), `409 CNPJ_JA_CADASTRADO`, `409 EMAIL_JA_CADASTRADO`, `429` após 10 cadastros/hora por IP.
* `POST /api/v1/auth/login` - Corpo `{ "identificador", "senha" }`. Com `@`, busca o e-mail **só na equipe**; sem `@`, exige um CNPJ válido e busca **só nos clientes**. Sucesso: `{ token, usuario: { id, nome, email, tipo } }`; o front escolhe o destino pelo `tipo`. **Qualquer falha** (formato inválido, usuário inexistente, perfil errado, senha errada, usuário inativo) devolve `401` com `{ "mensagem": "Credenciais inválidas.", "codigo": "CREDENCIAIS_INVALIDAS" }`, no mesmo tempo de resposta. Depois de 10 falhas em 15 min, o IP recebe `429 MUITAS_TENTATIVAS`.
* `GET /api/v1/auth/me` - Dados do usuário do token.
* `GET /api/v1/auth/users` - Lista os usuários sem expor as senhas; mesma permissão de `GET /admin/usuarios`.

O token vale 2 horas. A cada requisição a API confere se o usuário ainda existe e está ativo: desativar alguém ou mudar o perfil vale na hora. Rotas que o perfil não pode usar respondem `403` com a mensagem genérica `Acesso negado.`.

#### Perfis
Existem dois perfis (`usuario.tipo`): **`cliente`** e **`equipe`**. Todos os usuários da equipe têm as mesmas permissões na área do gestor (produtos, estoque, categorias/marcas, pedidos, clientes, painel e CMS). O `cargo` (ex.: "Estoquista") é texto livre e não muda permissões. A única exceção é a gestão de usuários da equipe, que exige `pode_gerenciar_equipe = true` (devolvido no login e em `/auth/me` para o front decidir se mostra o menu).

#### Gestão da equipe (`/api/v1/admin`, equipe com `pode_gerenciar_equipe`)
* `POST /api/v1/admin/usuarios` - Cria um usuário da equipe: `{ nome, email, senha, cargo?, telefone?, pode_gerenciar_equipe? }`. Equipe não tem CNPJ.
* `GET /api/v1/admin/usuarios?tipo=cliente|equipe&ativo=&busca=&pagina=` - Lista os usuários.
* `PATCH /api/v1/admin/usuarios/:id` - Altera nome, e-mail, senha, cargo, telefone, `pode_gerenciar_equipe` ou `ativo` (desativar/reativar). Para clientes, só `ativo`. Ninguém desativa a si mesmo, e a marca `pode_gerenciar_equipe` não pode sair do último usuário ativo que a tem (`409 OPERACAO_NAO_PERMITIDA`).

#### Minha conta (`/api/v1/minha-conta`, usuário logado)
* `GET /api/v1/minha-conta` - Perfil (com `cnpj` formatado) e endereços.
* `PATCH /api/v1/minha-conta` - Altera `nome`, `email` e `telefone`. CNPJ e razão social só pela equipe (`PUT /clientes/:id`).
* `PATCH /api/v1/minha-conta/senha` - `{ senha_atual, nova_senha }`.
* `GET/POST /api/v1/minha-conta/enderecos` e `PATCH/DELETE /api/v1/minha-conta/enderecos/:id_endereco` - Só clientes. Marcar `principal: true` desmarca os outros; não é possível remover o último endereço (`409 ULTIMO_ENDERECO`); se o principal for removido, o mais antigo assume.

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
* `POST /api/v1/produtos` - Cadastra (equipe). Obrigatórios: `sku` e `nome`. Opcionais: `descricao`, `destaques` (lista de textos), `imagem_url`, `id_categoria`, `id_marca`, `id_fornecedor`, `preco`, `estoque_minimo` (padrão 10), `multiplo_venda` (padrão 1), `ativo` e `quantidade_estoque` inicial.
* `PUT /api/v1/produtos/:id` - Substitui os dados (equipe); campos opcionais omitidos voltam ao padrão. `PATCH` altera só os campos enviados. Nenhum dos dois altera o estoque.
* `PATCH /api/v1/produtos/:id/estoque` - Ajusta o estoque (equipe). Envie `{ "quantidade": 120, "observacao": "Inventário" }` para definir o valor, ou `{ "ajuste": -5, "observacao": "Avaria" }` para somar/subtrair. Nunca deixa negativo (`409 ESTOQUE_INSUFICIENTE`).
* `GET /api/v1/produtos/:id/movimentacoes` - Histórico de estoque com usuário e observação (equipe).
* `DELETE /api/v1/produtos/:id` - Desativa o produto (não apaga). Para reativar: `PATCH { "ativo": true }`.
* `POST /api/v1/produtos/:id/imagem` - Envia a imagem (multipart, campo `imagem`, até 5 MB) e atualiza `imagem_url`.

Erros de validação voltam com `422 VALIDACAO` e a lista de todos os campos com problema em `detalhes: [{ campo, mensagem }]`. SKU repetido: `409 SKU_DUPLICADO`.

### Categorias e marcas (`/api/v1/categorias`, `/api/v1/marcas`)
* `GET` - Públicas, com `total_produtos` ativos. A equipe pode enviar `incluir_inativos=true`.
* `POST` (`nome`, opcionalmente `slug` e, nas categorias, `ordem`), `PUT`/`PATCH /:id` e `DELETE /:id` - equipe. O slug é gerado do nome (`Loja do bebê` → `loja-do-bebe`). Só é possível excluir se nenhum produto usar (`409 EM_USO`); caso contrário, desative com `{ "ativo": false }`.

### Clientes (`/api/v1/clientes`)
* `GET /api/v1/clientes?busca=texto&pagina=1&limite=20` - Lista clientes (com `nome_exibicao` e CNPJ formatado) com busca por nome, razão social, e-mail ou CNPJ (com ou sem pontuação) e paginação. `sem_cnpj=true` lista os clientes que não conseguem entrar por falta de CNPJ válido (o valor antigo fica em `cnpj_original`). Equipe.
* `GET /api/v1/clientes/:id/detalhes` - `{ cliente, historico_pedidos, produtos_mais_solicitados }`: dados cadastrais, endereços, histórico de pedidos e produtos mais solicitados.
* `PUT /api/v1/clientes/:id/senha` - `{ senha }`: define uma senha temporária para o cliente que esqueceu a dele (só o hash é gravado; sem e-mail). Equipe.
* `PUT /api/v1/clientes/:id` - Atualiza `razao_social`, `cnpj` (precisa ser um CNPJ válido e único; corrigir limpa a pendência), `telefone`, `ativo` e/ou `enderecos`. Cada endereço pode incluir `id_endereco` para atualizar um endereço existente; sem esse identificador, um endereço novo é cadastrado. Endereços omitidos não são removidos.

Clientes mantêm dados operacionais/comerciais (`razao_social`, `cnpj`, `telefone` e endereços de entrega). Nenhum dado bancário, de cartão ou limite de crédito é armazenado. Em uma atualização de status para `Entregue`, o pedido registra `data_entrega`.
