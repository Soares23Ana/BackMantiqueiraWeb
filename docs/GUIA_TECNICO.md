# Guia técnico

Detalhes de configuração e operação da API. O passo a passo para rodar o projeto está no [README](../README.md); o contrato dos endpoints, em [`API.md`](API.md).

## Sumário
1. [Variáveis de ambiente](#1-variáveis-de-ambiente)
2. [Banco de dados e migrations](#2-banco-de-dados-e-migrations)
3. [Dados de teste (seeds)](#3-dados-de-teste-seeds)
4. [Servidor](#4-servidor)
5. [Testes automatizados](#5-testes-automatizados)
6. [CORS](#6-cors)
7. [Importação de catálogo (CSV)](#7-importação-de-catálogo-csv)
8. [Jobs agendados](#8-jobs-agendados)
9. [Saúde](#9-saúde)

---

## 1. Variáveis de ambiente

Copie o `.env.example` para `.env`. A API **valida as variáveis ao iniciar** e não sobe se algo estiver errado (por exemplo, `JWT_SECRET` com menos de 32 caracteres ou ainda com o valor de exemplo).

### Obrigatórias
| Variável | Regra |
|---|---|
| `JWT_SECRET` | Sempre. Pelo menos 32 caracteres, diferente do valor de exemplo e de cada ambiente. |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Obrigatórias em produção. Em desenvolvimento, o padrão é `localhost`, `root`, senha vazia e `mantiqueira_db`. |

Para gerar um `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Opcionais
| Variável | Padrão | Para que serve |
|---|---|---|
| `NODE_ENV` | `development` | `production` na nuvem; `test` é definido pelos testes |
| `PORT` | `3000` | Porta da API (1 a 65535) |
| `DB_PORT` | `3306` | Porta do MySQL |
| `DB_NAME_TEST` | `mantiqueira_test` | Banco do `npm test` (precisa terminar com `_test`) |
| `DB_POOL_MAX` | `10` | Conexões simultâneas no pool (1 a 100) |
| `JWT_EXPIRES_IN` | `8h` | Duração do token: número + `s`, `m`, `h` ou `d` (ex.: `30m`, `1d`) |
| `LIMITE_GLOBAL` | `600` | Requisições por minuto por IP em `/api/v1` |
| `LOGIN_LIMITE` | `10` | Tentativas de login com falha a cada 15 min, por IP |
| `CADASTRO_LIMITE` | `10` | Cadastros por hora, por IP |
| `CORS_ORIGINS` | — | Origens do front liberadas além das padrão ([CORS](#6-cors)) |
| `TRUST_PROXY` | — | `1` quando a API fica atrás de proxy (ex.: Nginx na EC2), para os limites verem o IP real |
| `JOBS_ATIVOS` | `true` (exceto nos testes) | `false` desliga os [jobs agendados](#8-jobs-agendados) |
| `IMPORTACAO_DIR` | `./importacao` | Pasta com `entrada/`, `processados/` e `rejeitados/` usada pelos jobs |
| `LOG_LEVEL` | `info` (`silent` nos testes) | `debug`, `info`, `warn`, `error` ou `silent` |
| `LOG_FORMAT` | `texto` em dev, `json` em produção | Formato dos logs |
| `JSON_LIMIT` | `200kb` | Tamanho máximo do corpo JSON |
| `SEED_SENHA` | `Mantiqueira@2026` | Senha dos usuários criados pelo `seed:dev` |
| `SEED_DEV_PERMITIR_REMOTO` | — | `1` permite os seeds de teste num `DB_HOST` do RDS que seja um banco de testes |

A equipe (funcionário, gerente, admin) não é criada por variável: o gestor cria em `POST /api/v1/admin/usuarios`.

### Na nuvem
Configure `NODE_ENV=production`, `DB_HOST` com o endpoint do AWS RDS e `CORS_ORIGINS` com o endereço do front-end (várias origens separadas por vírgula). Defina `TRUST_PROXY=1` quando a API estiver atrás de um proxy, como Nginx.

> O `.env` tem dados sensíveis e é ignorado pelo Git (`.gitignore`). Para compartilhar a estrutura das variáveis com a equipe, use o `.env.example`.

---

## 2. Banco de dados e migrations

A estrutura do banco é versionada em `migrations/` (`001_*.sql`, `002_*.js`, ...). A API **não altera o banco sozinha** (o `sequelize.sync()` foi removido).

```bash
npm run migrar          # cria o banco se não existir e aplica as migrations pendentes
npm run migrar:status   # só lista o que está pendente
```

- **Banco novo**: rode `npm run migrar`, ou execute o `BancoMantiqueira.sql` no MySQL Workbench (ele é gerado a partir das migrations).
- **Banco existente** (criado pelo `BancoMantiqueira.sql` antigo ou pelo `sync()`): rode `npm run migrar`. A `002_normalizar_estrutura` converte status antigos de pedido, remove índices duplicados criados pelo `sync()` e corrige a FK que apagava pedidos junto com o cliente. Os scripts de `migrations/legado/` não precisam mais ser executados.
- Ao subir, a API avisa no log se houver migrations pendentes.

Para alterar o banco, **crie uma migration nova** com o próximo número (nunca edite uma já aplicada; o runner detecta pelo checksum) e depois rode `npm run schema:gerar` para atualizar o `BancoMantiqueira.sql`.

---

## 3. Dados de teste (seeds)

```bash
npm run seed:catalogo                         # importa seeds/catalogo_inicial.csv (38 produtos, upsert por SKU)
npm run seed:catalogo -- --simular            # mostra o que mudaria, sem gravar
npm run seed:catalogo -- --desativar-ausentes # também desativa produtos que não estão no CSV
npm run seed:dev                              # usuários de teste (recusa produção e RDS)
npm run seed:dev -- --redefinir-senhas        # volta a senha dos usuários de teste já existentes
npm run seed:demo                             # dados de demonstração (recusa produção e RDS)
```

**`seed:catalogo`** pode rodar quantas vezes quiser: só altera o que mudou e registra mudanças de estoque em `movimentacoes_estoque`. As imagens ficam no front; o CSV guarda só o caminho (`/img/...`).

**`seed:dev`** cria os usuários abaixo com a senha `Mantiqueira@2026` (troque com `SEED_SENHA`). A senha só vale para os usuários criados naquela execução; `-- --redefinir-senhas` volta a senha dos que já existiam.

| Perfil | Login | Observação |
|---|---|---|
| equipe | `admin@mantiqueira.com` | cargo "Administrador", **pode gerenciar a equipe** |
| equipe | `gerente@mantiqueira.com` | cargo "Gerente" |
| equipe | `funcionario@mantiqueira.com` | cargo "Estoquista" |
| cliente | CNPJ `11.222.333/0001-81` | e-mail `compras@mercadinho-exemplo.com.br`, com endereço principal |

**`seed:demo`** prepara o site para uma demonstração. Rode depois do `seed:catalogo` e do `seed:dev`; pode rodar quantas vezes quiser:
- **Configurações**: WhatsApp, telefone, e-mail, horário de atendimento e aviso do topo (regravados a cada execução).
- **3 banners** com imagens da pasta `/img/` do front (criados uma vez, pelo título).
- **1 campanha ativa** ("Semana Granado", com selo e 5 produtos Granado). A cada execução o período volta a cobrir hoje.
- **5 pedidos do cliente de teste**, um em cada status: Aguardando Separação, Em Separação, Saiu para Entrega, Entregue e Cancelado. São criados pelo fluxo real (baixa de estoque, histórico, devolução no cancelamento), com uma `Idempotency-Key` fixa: uma nova execução não cria outros pedidos nem mexe no estoque.
- Sem os usuários do `seed:dev` ou sem o catálogo, avisa e pula os pedidos.

`seed:dev` e `seed:demo` recusam `NODE_ENV=production` e `DB_HOST` do RDS (a menos que `SEED_DEV_PERMITIR_REMOTO=1`).

---

## 4. Servidor

```bash
npm start      # produção (node server.js)
npm run dev    # desenvolvimento (nodemon)
```

- Se o banco estiver fora do ar, a API sobe mesmo assim, responde `503` e tenta reconectar com espera crescente (1s, 2s, 4s... até 30s).
- Ao receber `SIGTERM`/`SIGINT`, ela termina as requisições em andamento e fecha as conexões antes de sair.
- Os logs saem estruturados (JSON em produção, texto legível em desenvolvimento). Cada requisição recebe um `X-Request-Id`, devolvido no cabeçalho da resposta e incluído em todos os logs dela.

---

## 5. Testes automatizados

```bash
npm test
```

Os testes usam o banco `DB_NAME_TEST` (padrão `mantiqueira_test`), que é **apagado e recriado** a cada execução. Por segurança, o nome precisa terminar com `_test`. O banco de desenvolvimento não é tocado.

---

## 6. CORS

O navegador só deixa o front chamar a API se a origem dele (protocolo + endereço + porta) estiver liberada. Por padrão, com credenciais, ficam liberadas as origens locais de desenvolvimento:

- `http://localhost:5173` e `http://127.0.0.1:5173` (Vite em `npm run dev`)
- `http://localhost:4173` (Vite em `npm run preview`)
- `http://localhost:3000` e `http://localhost:3001`

Para liberar outras (por exemplo, o endereço do front publicado), use `CORS_ORIGINS` no `.env`, separadas por vírgula, sem barra no final e sem caminho:

```bash
CORS_ORIGINS=https://mantiqueira.exemplo.com.br,http://192.168.0.10:5173
```

- Elas são **somadas** às origens padrão.
- A API não sobe se alguma origem for inválida (ex.: `mantiqueira.com.br` sem `http(s)://`, ou com caminho).
- Requisições sem cabeçalho `Origin` (Postman, `curl`, outro servidor) não passam pelo CORS.
- Cabeçalhos liberados: `Authorization`, `Content-Type`, `X-Request-Id` e `Idempotency-Key`; o front consegue ler o `X-Request-Id` da resposta.

---

## 7. Importação de catálogo (CSV)

O mesmo formato serve para o upload (`POST /produtos/importar`, ver [API.md](API.md#5-importação-de-catálogo)), para os [jobs](#8-jobs-agendados) e para o `seed:catalogo`.

**Formato**: o mesmo do `seeds/catalogo_inicial.csv`. Separador `;` (ou `,`), cabeçalho na primeira linha, UTF-8 ou Windows-1252 (o padrão do Excel). Só `sku` é obrigatória; **colunas ausentes não são alteradas**.

| Coluna | Conteúdo |
|---|---|
| `sku` | Identificador do produto (upsert por SKU) |
| `nome` | Obrigatório para produto novo |
| `categoria`, `marca` | Nome; criadas automaticamente se não existirem |
| `descricao` | Texto |
| `destaques` | Itens separados por `\|` |
| `imagem_url` | Caminho do front (`/img/x.webp`) ou URL |
| `ativo` | `sim` ou `nao` |
| `estoque_minimo`, `multiplo_venda` | Inteiros |
| `preco` | Opcional; nunca aparece para clientes |
| `estoque` | Quantidade atual; vazio mantém o estoque. Mudanças viram movimentações `importacao` |

- Cada linha é validada separadamente: as boas são gravadas e as com problema voltam em `relatorio.erros` (`linha`, `sku`, `campo`, `mensagem`).
- `status`: `sucesso`, `parcial` (algumas linhas rejeitadas) ou `falha` (arquivo ilegível ou todas as linhas com erro).
- **Proteção:** a carga completa só desativa produtos ausentes quando o arquivo não tem nenhum erro; um arquivo vazio ou truncado não esvazia o catálogo.
- Cada importação (upload ou job) fica em `sincronizacoes_log`, consultável em `GET /produtos/importacoes`.

**Arquivos de exemplo** para demonstração ficam em `importacao/exemplos/` (fora das pastas lidas pelos jobs):
- `catalogo_exemplo.csv`: o catálogo completo com 1 produto novo e 4 alterações, seguro para a carga completa.
- `estoque_exemplo.csv`: 4 atualizações e 1 SKU inexistente, para mostrar o relatório de erros.

Para testar um job, copie o arquivo para `importacao/entrada/`.

---

## 8. Jobs agendados

Fuso `America/Sao_Paulo`. A API lê arquivos colocados em `importacao/entrada/` (pasta configurável em `IMPORTACAO_DIR`):

| Job | Quando | Arquivos | O que faz |
|---|---|---|---|
| `carga-completa` | Meia-noite | `catalogo*.csv` | Importa tudo e desativa produtos ausentes |
| `estoque` | A cada 30 min | `estoque*.csv` | Aplica só `sku` e `estoque` (outras colunas são ignoradas) |
| `limpeza-eventos` | 3h | — | Apaga eventos de uso com mais de 12 meses |

- **Arquivos sendo copiados:** os jobs ignoram arquivos modificados nos últimos 60 segundos (podem estar no meio da cópia); eles ficam na entrada e são lidos na execução seguinte, e aparecem com `"status": "ignorado"` no `ultimo_resultado` do job. Mesmo assim, o recomendado é **gravar com a extensão `.tmp` e renomear para `.csv` ao terminar** (ex.: copiar `estoque_20261026_1430.tmp` e depois renomear para `estoque_20261026_1430.csv`): só arquivos `.csv` são lidos, e renomear dentro da mesma pasta é instantâneo, então o job nunca pega um arquivo pela metade.
- Os arquivos são processados em ordem alfabética (use data/hora no nome, ex.: `estoque_20261026_1430.csv`) e depois movidos para `processados/` ou `rejeitados/`, com um `.relatorio.json` ao lado.
- Cada execução fica em `sincronizacoes_log`.
- Uma trava do MySQL (`GET_LOCK`) garante que, com várias instâncias da API, só uma rode cada job, e que job e upload não importem ao mesmo tempo.
- `JOBS_ATIVOS=false` desliga os jobs (nos testes eles já vêm desligados).

---

## 9. Saúde

- **`GET /saude`** (público, fora de `/api/v1`): só `status` e `banco`. Responde `200` com `{ "status": "ok", "banco": "conectado" }` ou `503` com `{ "status": "degradado", "banco": "indisponivel" }` quando o banco não responde. Fica fora do limite de requisições, para servir de health check do balanceador.
- **`GET /saude/detalhado`** (equipe): versão da API, banco (latência e migrations pendentes), processo (data de início, uptime, memória, versão do Node), jobs (última e próxima execução, último resultado ou erro) e data da última sincronização de cada tipo.

Os exemplos de resposta estão em [API.md](API.md#12-saúde).
