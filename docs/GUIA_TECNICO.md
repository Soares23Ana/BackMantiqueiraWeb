# Guia técnico

Detalhes de configuração e operação da API. O passo a passo para rodar o projeto está no [README](../README.md); o contrato dos endpoints, em [`API.md`](API.md).

## Sumário
1. [Variáveis de ambiente](#1-variáveis-de-ambiente)
2. [Banco de dados e migrations](#2-banco-de-dados-e-migrations)
3. [Dados de teste (seeds)](#3-dados-de-teste-seeds)
4. [Servidor](#4-servidor)
5. [Testes automatizados](#5-testes-automatizados)
6. [CORS](#6-cors)
7. [Importação de catálogo (planilhas .xlsx e CSV)](#7-importação-de-catálogo-planilhas-xlsx-e-csv)
8. [Jobs agendados](#8-jobs-agendados)
9. [Saúde](#9-saúde)
10. [Primeiro acesso em produção](#10-primeiro-acesso-em-produção)
11. [Serviços externos (CEP e CNPJ)](#11-serviços-externos-cep-e-cnpj)
12. [Riscos aceitos](#12-riscos-aceitos)
13. [Regras de negócio](#13-regras-de-negócio)
14. [Fotos enviadas (uploads)](#14-fotos-enviadas-uploads)
15. [Cópia de imagem a partir de um link](#15-cópia-de-imagem-a-partir-de-um-link)
16. [Envio em massa de fotos por ZIP](#16-envio-em-massa-de-fotos-por-zip)
17. [Dados pessoais e privacidade (LGPD)](#17-dados-pessoais-e-privacidade-lgpd)

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
| `JOB_CATALOGO_CRON`, `JOB_CARGA_COMPLETA_CRON`, `JOB_ESTOQUE_CRON` | `0 * * * *`, `0 0 * * *`, `*/30 * * * *` | Horários dos jobs (cron de 5 campos); validados ao iniciar |
| `IMPORTACAO_DIR` | `./importacao` | Pasta com `entrada/`, `processados/` e `rejeitados/` usada pelos jobs |
| `MAPA_CATEGORIAS` | `./seeds/mapa_categorias.csv` | Mapa de `CATEGORIA - Cad. ERP` para categoria e subcategoria ([importação](#7-importação-de-catálogo-planilhas-xlsx-e-csv)) |
| `UPLOADS_DIR` | `./publico/uploads` | Pasta das fotos enviadas; em produção, fora do projeto ([uploads](#14-fotos-enviadas-uploads)) |
| `BACKUP_DIR` | `../backups-fotos` | Pasta dos ZIPs gerados por `npm run backup:fotos` |
| `BACKUP_FOTOS_MANTER` | `7` | Quantas cópias de fotos manter (1 a 365) |
| `LOG_LEVEL` | `info` (`silent` nos testes) | `debug`, `info`, `warn`, `error` ou `silent` |
| `LOG_FORMAT` | `texto` em dev, `json` em produção | Formato dos logs |
| `JSON_LIMIT` | `200kb` | Tamanho máximo do corpo JSON |
| `VALIDAR_CNPJ_RECEITA` | `true` em produção, `false` em dev e testes | O cadastro consulta o CNPJ na Receita: precisa existir e estar `ATIVA`, e a razão social vem de lá ([serviços externos](#11-serviços-externos-cep-e-cnpj)) |
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

A `013_cnpj_alfanumerico` passa a aceitar o CNPJ alfanumérico da Receita: a restrição `ck_usuarios_cnpj` exige 12 caracteres `[0-9A-Z]` (maiúsculos) seguidos de 2 dígitos, em `VARCHAR(14)`. Os CNPJs numéricos já gravados continuam válidos.

Para alterar o banco, **crie uma migration nova** com o próximo número (nunca edite uma já aplicada; o runner detecta pelo checksum) e depois rode `npm run schema:gerar` para atualizar o `BancoMantiqueira.sql`.

---

## 3. Dados de teste (seeds)

```bash
npm run seed:catalogo                         # importa seeds/catalogo_inicial.csv (upsert por SKU)
npm run seed:catalogo -- --simular            # mostra o que mudaria, sem gravar
npm run seed:catalogo -- --desativar-ausentes # desativa TODO produto que não está no CSV (não só os antigos SKU-1xx)
npm run seed:catalogo -- --arquivo=caminho.csv # usa outro arquivo
npm run seed:dev                              # usuários de teste (recusa produção e RDS)
npm run seed:dev -- --redefinir-senhas        # volta a senha dos usuários de teste já existentes
npm run seed:demo                             # dados de demonstração (recusa produção e RDS)
```

**`seed:catalogo`** pode rodar quantas vezes quiser (é idempotente): só altera o que mudou e registra mudanças de estoque em `movimentacoes_estoque`. As imagens ficam no front; o CSV guarda só o caminho (`/img/...`).

Colunas de `seeds/catalogo_inicial.csv` (o catálogo real): `sku` (código do portfólio), `nome`, `nome_erp`, `categoria`, `subcategoria`, `marca`, `estoque`, `estoque_minimo`, `multiplo_venda`, `ativo`, `imagem_url` e `sku_antigo`. Os valores de `estoque` são definidos para a demonstração (com alguns produtos de estoque baixo e zerado).
- **`sku_antigo`** (ex.: `SKU-101`): se já existe um produto com esse SKU, o **produto existente** troca o SKU para o novo, mantendo o id, o estoque, as movimentações e os pedidos; a linha segue como atualização. Se o SKU novo já existe, o produto antigo não é tocado. SKU antigo repetido no arquivo ou fora do padrão é erro da linha.
- **Produtos antigos sem correspondência** (SKU `SKU-123` que nem o arquivo nem um `sku_antigo` aproveitou) ficam **desativados**, nunca apagados; produtos com outros SKUs (cadastrados à mão) não são tocados. Como em toda carga que desativa, nada é desativado se o arquivo tiver erro.
- O relatório mostra `skus_trocados`, `criados`, `atualizados`, `desativados` e as pendências da importação (`abreviacoes_pendentes`, `categorias_sem_mapa`). Use `--simular` antes.

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

## 7. Importação de catálogo (planilhas .xlsx e CSV)

O mesmo formato serve para o upload (`POST /produtos/importar`, ver [API.md](API.md#5-importação-de-catálogo)), para os [jobs](#8-jobs-agendados) e para o `seed:catalogo`.

**Arquivos aceitos: `.xlsx` ou CSV.** O Excel é lido pela biblioteca `read-excel-file` (nunca o pacote `xlsx` do npm, que tem vulnerabilidades altas sem correção) e **só a primeira aba** é usada. `.xls`, `.xlsm` e `.xlsb` são recusados: "Salve o arquivo como .xlsx ou CSV." O upload confere a extensão **e** a assinatura do arquivo (um `.xlsx` começa com `PK`); arquivo corrompido ou que não é planilha dá `422 PLANILHA_INVALIDA` e fica registrado como falha em `sincronizacoes_log`. Limites: 5 MB e 20.000 linhas.

**Leitura da planilha:** o cabeçalho é a primeira linha não vazia e as linhas totalmente vazias são ignoradas. Cada célula do Excel vira o mesmo texto aparado do CSV, para reaproveitar a validação linha a linha, a simulação e o relatório: número inteiro vira texto sem `.0` nem notação científica (o código `1391` vira `"1391"`); datas viram `AAAA-MM-DD HH:MM:SS` no horário de São Paulo; fórmulas usam o valor já calculado pelo Excel; célula com erro (`#N/D`, `#REF!`...) faz a linha ir para `relatorio.erros` sem derrubar a importação.

**Formato**: o do `seeds/catalogo_inicial.csv` ou o do portfólio. CSV com separador `;` (ou `,`), cabeçalho na primeira linha, UTF-8 ou Windows-1252 (o padrão do Excel). Só `sku` é obrigatória; **colunas ausentes não são alteradas**.

**Cabeçalhos do portfólio** (sem diferenciar maiúsculas nem acentos; o formato atual continua valendo):

| Cabeçalho | Vira |
|---|---|
| `CÓDIGO`, `codigo`, `cod` | `sku` |
| `PRODUTO` | `nome_erp` (nome original do portfólio; dele sai o `nome` de exibição) |
| `FABRICANTE` | `marca` (criada se não existir) |
| `CATEGORIA - Cad. ERP` | `categoria_erp` (passa pelo mapa de categorias, abaixo) |
| `categoria`, `subcategoria` | `categoria`, `subcategoria` |
| `estoque`, `quantidade`, `saldo` | `estoque` |

Qualquer outra coluna (por exemplo `CÓDIGO DE BARRAS`) é **ignorada, sem erro**, e listada em `relatorio.colunas_ignoradas`.

**Nome de exibição:** o original fica em `produtos.nome_erp` e o `nome` é gerado pelo dicionário editável `config/abreviacoes.json` (`SAB.` → Sabonete, `SH` → Shampoo, `LOC.HID.` → Loção Hidratante...), com capitalização de título (preposições em minúsculas), unidades e `C/8` mantidos e o `*` final removido. As abreviações **ambíguas** (`ED.`, `RP.`, `P.`, `PRES.`, `CHUP.`, `AP.`, listadas em `ambiguas` no JSON) e qualquer outra abreviação terminada em ponto que não esteja no dicionário **não são expandidas**: vão para `relatorio.abreviacoes_pendentes` para a equipe decidir e acrescentar ao dicionário (o arquivo é relido quando muda, sem reiniciar). Se a planilha já trouxer a coluna `nome`, ele não é alterado pela geração. Num produto existente, o `nome` só é trocado se ainda for igual ao gerado a partir do `nome_erp` anterior (ninguém o editou à mão); o `nome_erp` sempre acompanha a planilha.

**Categoria e subcategoria na planilha:** as colunas `categoria` e `subcategoria` criam o que faltar (a subcategoria fica sob a categoria da mesma linha; `subcategoria` sem `categoria` é erro da linha) e o produto aponta para a subcategoria quando houver. A coluna `CATEGORIA - Cad. ERP` do portfólio passa pelo **mapa** `seeds/mapa_categorias.csv` (colunas `categoria_erp;categoria;subcategoria`, sem diferenciar maiúsculas nem acentos; caminho em `MAPA_CATEGORIAS`, padrão `./seeds/mapa_categorias.csv`, relido a cada importação). Categoria do portfólio **sem mapa**: o produto novo entra sem categoria, o produto existente mantém a que tem, **nenhuma categoria é criada** e o valor vai para `relatorio.categorias_sem_mapa` (`{ categoria_erp, ocorrencias }`) para a equipe completar o mapa. Se o arquivo do mapa não existir, todas ficam sem mapa e o relatório avisa.

**Estoque sem perder pedidos recentes (`gerado_em`):** as planilhas de estoque são preparadas pela equipe e podem ficar horas até serem importadas; nesse intervalo entram pedidos. Por isso, em toda importação com a coluna `estoque`, dentro da transação e com as linhas de produto bloqueadas, o estoque gravado é `max(0, estoque_da_planilha − soma das quantidades dos itens de pedidos NÃO cancelados criados DEPOIS de gerado_em, para aquele produto)`. A coluna opcional `gerado_em` (horário de São Paulo; texto `AAAA-MM-DD HH:MM[:SS]` ou `DD/MM/AAAA HH:MM[:SS]`, ou data do Excel) vale por linha; sem ela usa-se a **data de modificação do arquivo** nos jobs de pasta e o **horário do envio** no upload manual (importações por script, como o `seed:catalogo`, não descontam). A movimentação de estoque registra na observação o estoque da planilha e o desconto aplicado; o relatório traz `total_descontado`, `produtos_com_desconto` e `gerado_em_padrao`, e `sincronizacoes_log.estoque_descontado` guarda o total (migration 023). Pedido cancelado não conta (o cancelamento já devolveu o estoque). Um `gerado_em` no futuro é erro da linha.

**Consistência com pedidos simultâneos:** o checkout grava o pedido e depois bloqueia as linhas de produto; a importação bloqueia as linhas dos produtos da planilha antes de somar os pedidos. Um pedido que ainda não confirmou espera o bloqueio, não aparece na soma e, depois da importação, baixa o estoque já importado; um pedido já confirmado entra no desconto. Nos dois casos o resultado é o mesmo: planilha − todos os pedidos posteriores a `gerado_em`.

**Limitação:** o desconto só enxerga pedidos criados depois de `gerado_em`. Se a coluna não vier, um pedido feito entre a preparação da planilha e o horário usado como padrão (envio ou modificação do arquivo) **não** é descontado e sua baixa é desfeita; ajustes manuais de estoque feitos no painel depois de `gerado_em` também são sobrescritos pelo valor da planilha. Preencha `gerado_em` com o instante em que a contagem foi feita, e copie o arquivo para `importacao/entrada/` preservando a data de modificação (ou use a coluna).

**Códigos só com dígitos:** `GET /produtos/:id` procura o número primeiro como id e, não havendo produto com esse id, como SKU.

| Coluna | Conteúdo |
|---|---|
| `sku` | Identificador do produto (upsert por SKU) |
| `nome` | Obrigatório para produto novo |
| `categoria`, `subcategoria`, `marca` | Nome; criadas automaticamente se não existirem (a subcategoria fica sob a `categoria`) |
| `descricao` | Texto |
| `destaques` | Itens separados por `\|` |
| `imagem_url` | Caminho do front (`/img/x.webp`) ou URL |
| `ativo` | `sim` ou `nao` |
| `estoque_minimo`, `multiplo_venda` | Inteiros |
| `preco` | Opcional; nunca aparece para clientes |
| `estoque` | Quantidade atual; vazio mantém o estoque. Mudanças viram movimentações `importacao` |
| `nome_erp` | Nome original do portfólio (vem de `PRODUTO`) |
| `sku_antigo` | Opcional: o produto que hoje tem esse SKU troca para o `sku` da linha (mesmo id e pedidos) |
| `gerado_em` | Opcional: quando a planilha de estoque foi gerada (horário de São Paulo); pedidos posteriores são descontados do `estoque` |

- Cada linha é validada separadamente: as boas são gravadas e as com problema voltam em `relatorio.erros` (`linha`, `sku`, `campo`, `mensagem`).
- `status`: `sucesso`, `parcial` (algumas linhas rejeitadas) ou `falha` (arquivo ilegível ou todas as linhas com erro).
- **Proteção:** a carga completa só desativa produtos ausentes quando o arquivo não tem nenhum erro; um arquivo vazio ou truncado não esvazia o catálogo.
- Cada importação (upload ou job) fica em `sincronizacoes_log`, consultável em `GET /produtos/importacoes`.
- O relatório traz também `formato` (`csv` ou `xlsx`), `abreviacoes_pendentes`, `categorias_sem_mapa` e `colunas_ignoradas`.

**Arquivos de exemplo** para demonstração ficam em `importacao/exemplos/` (fora das pastas lidas pelos jobs):
- `catalogo_exemplo.csv`: o catálogo completo com 1 produto novo e 4 alterações, seguro para a carga completa.
- `estoque_exemplo.csv`: 4 atualizações e 1 SKU inexistente, para mostrar o relatório de erros.

Para testar um job, copie o arquivo para `importacao/entrada/`.

---

## 8. Jobs agendados

Fuso `America/Sao_Paulo`. A API lê arquivos colocados em `importacao/entrada/` (pasta configurável em `IMPORTACAO_DIR`):

| Job | Quando | Arquivos | O que faz |
|---|---|---|---|
| `catalogo` | De hora em hora | `catalogo*.csv` ou `.xlsx` | Carga incremental: cria e atualiza, **sem desativar** os ausentes |
| `carga-completa` | Meia-noite | `carga_completa*.csv` ou `.xlsx` | Importa tudo e desativa produtos ausentes (só se o arquivo não tiver erro) |
| `estoque` | A cada 30 min | `estoque*.csv` ou `.xlsx` | Aplica só `sku` e `estoque` (outras colunas são ignoradas) |
| `limpeza-eventos` | 3h | — | Apaga eventos de uso com mais de 12 meses |

Os arquivos são preparados e colocados na pasta pela própria equipe. Os horários dos três primeiros vêm das variáveis `JOB_CATALOGO_CRON`, `JOB_CARGA_COMPLETA_CRON` e `JOB_ESTOQUE_CRON` (cron de 5 campos, fuso de São Paulo; padrões `0 * * * *`, `0 0 * * *` e `*/30 * * * *`). Uma expressão inválida impede a API de subir, com a mensagem apontando a variável.

- **Arquivos sendo copiados:** os jobs ignoram arquivos modificados nos últimos 60 segundos (podem estar no meio da cópia); eles ficam na entrada e são lidos na execução seguinte, e aparecem com `"status": "ignorado"` no `ultimo_resultado` do job. Mesmo assim, o recomendado é **gravar com a extensão `.tmp` e renomear para `.csv` ou `.xlsx` ao terminar** (ex.: copiar `estoque_20261026_1430.tmp` e depois renomear para `estoque_20261026_1430.csv`): só arquivos `.csv` e `.xlsx` são lidos, e renomear dentro da mesma pasta é instantâneo, então o job nunca pega um arquivo pela metade.
- Os arquivos são processados em ordem alfabética (use data/hora no nome, ex.: `estoque_20261026_1430.csv`) e depois movidos para `processados/` ou `rejeitados/`, com um `.relatorio.json` ao lado.
- Cada execução fica em `sincronizacoes_log` (tipos `catalogo`, `carga_completa` e `estoque`).
- **Saúde dos jobs:** `/saude/detalhado` mostra por job a última execução, status, duração, próxima execução e falhas seguidas. O status geral vira `degradado` se um job falhar 2 vezes seguidas ou não rodar por mais de 2 intervalos (o intervalo é calculado da expressão cron).
- **Nova tentativa:** em falha transitória (conexão perdida, timeout, deadlock) o job tenta de novo após 1 minuto; só se a segunda tentativa falhar a falha conta nas "falhas seguidas".
- **Execução manual:** `POST /admin/jobs/:nome/executar` (equipe) roda o job na hora, com a mesma trava do MySQL, e devolve o relatório.
- Uma trava do MySQL (`GET_LOCK`) garante que, com várias instâncias da API, só uma rode cada job, e que job e upload não importem ao mesmo tempo.
- `JOBS_ATIVOS=false` desliga os jobs (nos testes eles já vêm desligados).

---

## 9. Saúde

- **`GET /saude`** (público, fora de `/api/v1`): só `status` e `banco`. Responde `200` com `{ "status": "ok", "banco": "conectado" }` ou `503` com `{ "status": "degradado", "banco": "indisponivel" }` quando o banco não responde. Fica fora do limite de requisições, para servir de health check do balanceador.
- **`GET /saude/detalhado`** (equipe): versão da API, banco (latência e migrations pendentes), processo (data de início, uptime, memória, versão do Node), jobs (última e próxima execução, último resultado ou erro), pasta de uploads (gravável e quantidade de arquivos) e data da última sincronização de cada tipo.

Os exemplos de resposta estão em [API.md](API.md#12-saúde).

---

## 10. Primeiro acesso em produção

Num ambiente novo (ex.: EC2 com banco no RDS), com o `.env` de produção já preenchido ([variáveis](#1-variáveis-de-ambiente)):

```bash
npm run migrar          # cria as tabelas
npm run seed:catalogo   # opcional: só se quiser o catálogo inicial
npm run criar-admin     # cria o primeiro administrador
```

> **Não rode `npm run seed:dev` nem `npm run seed:demo` em produção.** Eles criam usuários com senha conhecida e dados de demonstração (pedidos, banners, campanha, contatos fictícios). Os dois já se recusam a rodar com `NODE_ENV=production` ou contra o RDS; não defina `SEED_DEV_PERMITIR_REMOTO` em produção.

O `criar-admin`:
1. Mostra o banco de destino (nome, host e `NODE_ENV`).
2. Pergunta nome e e-mail (ou use `npm run criar-admin -- --nome "Maria Silva" --email maria@empresa.com.br`).
3. Pede a senha duas vezes, **sem mostrar o que é digitado**. A senha nunca vem por argumento nem por variável de ambiente e não é escrita na tela nem no log. Regras do cadastro: e-mail válido e senha de 8 a 72 caracteres.
4. Pede para digitar `sim` antes de criar. Qualquer outra resposta cancela sem gravar nada.
5. Cria um usuário `equipe`, ativo, com `pode_gerenciar_equipe = true` e sem CNPJ. Só o hash bcrypt da senha é gravado.
6. Mostra o e-mail criado. Entre por `POST /api/v1/auth/login` com esse e-mail e a senha.

Ele recusa (sem criar nada) se:
- já existir algum usuário **ativo** que pode gerenciar a equipe: o comando é só para o primeiro acesso. As outras contas da equipe são criadas por esse administrador em `POST /api/v1/admin/usuarios`;
- o e-mail já estiver em uso;
- a senha vier por `--senha`;
- não houver um terminal interativo para digitar a senha (ex.: entrada por pipe). No Git Bash do Windows, rode `winpty npm.cmd run criar-admin`; no PowerShell, cmd ou ssh funciona direto.

Se o administrador for desativado e ninguém mais puder gerenciar a equipe, o `criar-admin` volta a funcionar para recuperar o acesso.

---

## 11. Serviços externos (CEP e CNPJ)

A API consulta serviços públicos com o `fetch` nativo do Node (sem dependência nova). Cada consulta tem tempo máximo e as respostas ficam num cache em memória (perdido ao reiniciar a API e separado em cada instância).

### CEP (`GET /api/v1/cep/:cep`)
| Ordem | Serviço | Endereço consultado |
|---|---|---|
| 1 | BrasilAPI | `https://brasilapi.com.br/api/cep/v1/{cep}` (campos `street`, `neighborhood`, `city`, `state`) |
| 2 | ViaCEP | `https://viacep.com.br/ws/{cep}/json/` (campos `logradouro`, `bairro`, `localidade`, `uf`; CEP inexistente vem com `"erro": true`) |

- O ViaCEP é usado quando a BrasilAPI falha (erro de rede, mais de 4 s, resposta 5xx) **ou** responde 404. O 404 da BrasilAPI só significa que os provedores dela não acharam, então o ViaCEP ainda é consultado.
- Tempo máximo: **4 segundos por serviço** (até 8 s no pior caso, com os dois lentos).
- Cache: **24 horas** para CEP encontrado e **5 minutos** para "não encontrado" (um CEP novo pode passar a existir). Falha dos dois serviços não fica em cache. Máximo de 5.000 CEPs na memória; os mais antigos saem primeiro.
- `404 CEP_NAO_ENCONTRADO` quando algum serviço diz que o CEP não existe e nenhum o encontra; `503 SERVICO_INDISPONIVEL` quando os dois falham.
- Limite de **30 consultas por minuto por IP** (vale também nos testes).
- Funciona com o banco fora do ar, e o cadastro não depende dela: o endereço digitado à mão continua aceito.
- Falhas de cada serviço vão para o log como aviso (`warn`), com o nome do serviço.

### CNPJ (`servicos/receita.js`)
| Ordem | Serviço | Endereço consultado |
|---|---|---|
| 1 | BrasilAPI | `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` |
| 2 | Minha Receita | `https://minhareceita.org/{cnpj}` |

- Os dois devolvem os mesmos campos: `razao_social`, `nome_fantasia`, `descricao_situacao_cadastral`, `municipio` e `uf`. CNPJ inexistente: `404`.
- A Minha Receita é usada quando a BrasilAPI falha (erro de rede, mais de 5 s, 5xx), responde `404` ou recusa o formato (`400`). Um serviço que ainda não aceite CNPJ alfanumérico não impede a consulta no outro.
- Tempo máximo: **5 segundos por serviço**. Cache: **24 horas** para CNPJ encontrado e 10 minutos para "não encontrado" (empresa recém-aberta pode demorar a aparecer na base). Falha dos dois não fica em cache.
- Usado em `GET /api/v1/cnpj/:cnpj` (público, **20 consultas por minuto por IP**) e no cadastro (`POST /api/v1/auth/register`) quando `VALIDAR_CNPJ_RECEITA=true`.

**`VALIDAR_CNPJ_RECEITA`** (padrão `true` em produção, `false` em desenvolvimento e testes):
- `true`: o cadastro só aceita CNPJ que existe e está `ATIVA` na Receita e grava a razão social de lá. Não encontrado ou inativo: `422`. Serviços fora do ar: `503`, e o cliente tenta de novo depois.
- **Exceção para CNPJ alfanumérico** (`validarCnpjParaCadastro`): com letras no CNPJ, "não encontrado" ou formato recusado (`400`) **não bloqueia** o cadastro. O cliente é gravado sem `razao_social`, a API registra um aviso no log com o motivo e a equipe revisa em `GET /clientes?novos_dias=N`. Se a Receita encontrar o CNPJ, vale a regra normal (inativo: `422 CNPJ_INATIVO`; ativo: grava a razão social dela). CNPJ só com números não tem exceção. **Esta exceção deve ser revista quando os serviços de consulta passarem a indexar CNPJ alfanumérico**; nesse momento, "não encontrado" deve voltar a bloquear.
- `false`: o cadastro aceita qualquer CNPJ com dígito verificador válido, sem consulta externa.
- **Numa demonstração**, se o serviço externo estiver fora do ar, defina `VALIDAR_CNPJ_RECEITA=false` no `.env` e reinicie a API: o cadastro volta a funcionar sem a consulta. Volte para `true` depois.
- Não há aprovação manual: com o CNPJ ativo, a conta já pode entrar. Para acompanhar os novos cadastros, a equipe consulta quando quiser o `clientes_novos_7_dias` de `GET /painel/contadores` e a lista em `GET /clientes?novos_dias=7` ([API.md](API.md#9-painel)).

---

## 12. Riscos aceitos

### `uuid` dentro do `sequelize` (npm audit, severidade moderada)
- **Aviso:** `uuid <11.1.1`, falta de verificação de limites no buffer nas funções v3/v5/v6 ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)). Está em `sequelize@6.37.8` → `uuid@8.3.2`.
- **Por que fica:** o aviso só vale quando se passa um buffer (`buf`) ao `uuid`, e o projeto não faz isso. O Sequelize só gera UUIDs sem buffer.
- **Por que não se corrige agora:** a correção que o npm sugere (`npm audit fix --force`) instala o `sequelize@3.30.0`, uma versão muito antiga e incompatível com esta API. Não usar `--force`.
- **Registrado em:** 30/10/2026.
- **Revisão:** sempre que sair uma nova versão do Sequelize, rodar `npm update sequelize` e `npm audit --omit=dev`; se o `uuid` já estiver corrigido, remover este item.

---

## 13. Regras de negócio

### Estoque por faixa e rastreio de erros
- **Estoque exato só para a equipe.** Visitantes e clientes recebem `disponibilidade` e `faixa_estoque` (`acima_do_limite`, `disponivel`, `ultimas_unidades` ou `indisponivel`) em toda rota que mostra produto (vitrine, produto, campanhas, repetir pedido), e o 409 `ITENS_INDISPONIVEIS` do checkout traz só o motivo e a disponibilidade. A função `faixaEstoque` (`servicos/estoque.js`) é o único ponto que decide a faixa.
- **Limite da faixa alta:** configuração `estoque_faixa_alta` (padrão 50, inteiro de 1 a 10000), editável pela rota de configurações.
- **`request_id` nos erros:** todo corpo de erro leva o `request_id`, igual ao cabeçalho `X-Request-Id` da resposta e ao campo `request_id` dos logs. O suporte usa esse valor para achar a linha do log. O middleware `padronizarErros` (`middlewares/requisicao.js`) acrescenta o campo em qualquer erro.

### Pop-up e destinos
- O pop-up é o bloco `popup` de `blocos_cms`; a coluna JSON `dados` guarda imagem, destino e janela de exibição (migration 014). A chave é reservada: o público só lê pelo `GET /cms/popup`.
- `servicos/destinos.js` é o mecanismo de destino (`tipo_destino`, `id_destino`, `link`) compartilhado por banners e pop-up: valida se o alvo existe e resolve o link interno no formato das rotas do site.
- Banners guardam `tipo_destino` e `id_destino` (migration 015); `servicos/destinos.js` resolve o link em lote para a lista inteira. O alvo não tem chave estrangeira (um destino excluído só deixa o `link` resolvido `null`).
- Campanhas têm `slug` único (migration 015), gerado do título na criação. `GET /produtos?campanha={slug}` usa uma subconsulta com o período da campanha, então só campanhas ativas listam produtos.

### Visitantes
- O evento `visita` (migration 016) usa a coluna `dia_visita` e o índice único `(sessao, dia_visita)` para gravar no máximo uma visita por sessão por dia, mesmo com requisições simultâneas; a repetição é ignorada (`registrado: false`). Nenhum IP é guardado. As métricas de visitantes contam sessões únicas por dia (horário de Brasília).

### Carrinho e favoritos
- Tabelas `carrinhos` (uma linha por cliente, `itens` em JSON) e `favoritos` (chave composta), migration 018. Ficam no banco da API, então funcionam igual em banco local e na nuvem.
- `PUT /carrinho` substitui a lista inteira e grava `atualizado_em` sempre (mesmo com a mesma lista): essa data é a "última atividade" usada nos carrinhos abandonados. O pedido apaga a linha do carrinho dentro da transação do checkout (`servicos/pedidos.js`).

### Carrinhos abandonados
- Calculados na hora a partir de `carrinhos` (`servicos/carrinhosAbandonados.js`): itens, `atualizado_em` mais antigo que `carrinho_abandonado_dias` e nenhum pedido do cliente depois dessa data. Não há job nem tabela de "abandonos": o contato fica em `carrinho_contatos` (migration 019) e vale enquanto for posterior à última atualização do carrinho. O contador do painel conta só os que ainda não tiveram contato.

### Suporte: notas e auditoria
- `notas_cliente` e `auditoria` (migration 020). A auditoria é gravada por `registrarAuditoria` (`servicos/auditoria.js`), chamado **depois** que a operação principal conclui. O helper captura qualquer erro (só vai para o log), remove chaves com `senha`, `password`, `hash`, `token`, `segredo`, `secret` ou `authorization` em qualquer nível, corta textos em 200 caracteres e não grava quando nada mudou. Preço de produto fica de fora dos campos auditados.
- Para auditar uma nova ação: tire um `instantaneo(registro, CAMPOS)` antes e depois e chame `registrarAuditoria({ usuario, acao, entidade, idEntidade, antes, depois, detalhe })`.

### Histórico do cliente
- `GET /clientes/:id/historico` (`servicos/historicoCliente.js`) lê as fontes numa só consulta `UNION ALL` (cadastro, pedidos, `pedido_historico`, carrinho, contatos do carrinho, eventos do cliente e notas), ordena e pagina no banco e monta título e detalhe em JavaScript. Não há tabela própria de histórico: ele sempre reflete o estado atual das tabelas de origem. Usa `JSON_TABLE` (MySQL 8) para somar as unidades do carrinho.

### Categorias em dois níveis
- `categorias.id_pai` (migration 022) liga a subcategoria à categoria principal. O índice único `(chave_pai, nome)`, em que `chave_pai` é uma coluna gerada (`IFNULL(id_pai, 0)`), garante nome único dentro do mesmo pai, inclusive entre as principais; a migration renomeia (`" (2)"`) nomes repetidos que já existissem. A profundidade máxima (2) é validada na API (`taxonomiaControlador`).
- O produto guarda só `id_categoria` (a subcategoria quando houver, senão a categoria); `categoria` e `subcategoria` das respostas saem do join com o pai. `GET /produtos?categoria=` também casa o pai (`$categoria.pai.slug$`).

---

## 14. Fotos enviadas (uploads)

As fotos de produtos, banners e pop-up ficam numa única pasta, definida por **`UPLOADS_DIR`** (caminho absoluto ou relativo; a API resolve para absoluto). Sem a variável, vale `publico/uploads` (só para desenvolvimento). **Em produção, use uma pasta fora do projeto** (ex.: `/var/mantiqueira/uploads`), para as fotos não sumirem numa nova publicação do código. O banco continua guardando `/arquivos/uploads/<uuid>.<ext>`: as URLs não mudam. O caminho é montado só em `lib/uploads.js`.

Na subida, a API cria a pasta, confirma que dá para gravar e registra um aviso no log se estiver em produção sem `UPLOADS_DIR` ou se a pasta acabou de ser criada vazia (sinal de disco novo ou caminho trocado). O `GET /saude/detalhado` mostra se a pasta é gravável e quantos arquivos ela tem (sem o caminho). As fotos são servidas com cache de 30 dias (`immutable`), porque o nome é UUID e o conteúdo nunca muda.

### Mover as fotos já existentes
```bash
# 1. defina UPLOADS_DIR no .env (pasta fora do projeto)
npm run uploads:mover -- --simular   # mostra o que seria copiado
npm run uploads:mover                # copia publico/uploads para UPLOADS_DIR
```
Copia (não move), não sobrescreve arquivo que já existe e pode rodar várias vezes. Mostra copiados, já existentes e total. Depois de conferir, reinicie a API (`pm2 restart`) e, quando tudo estiver certo, apague `publico/uploads` à mão.

### Cópia de segurança
```bash
npm run backup:fotos
```
Gera `fotos-AAAAMMDD-HHMMSS.zip` em `BACKUP_DIR` (padrão `../backups-fotos`, irmã do projeto) e mantém só as últimas `BACKUP_FOTOS_MANTER` cópias (padrão 7). Grava em fluxo, sem carregar o ZIP na memória, mostra a quantidade de arquivos e o tamanho e termina com código diferente de zero se falhar. Exemplo de agendamento diário às 3h (`crontab -e`, no usuário que roda a API):
```cron
0 3 * * * cd /caminho/da/api && /usr/bin/npm run backup:fotos >> /var/log/mantiqueira-backup.log 2>&1
```

### Restaurar
```bash
unzip -n /caminho/backups-fotos/fotos-20260101-030000.zip -d "$UPLOADS_DIR"
```
(`-n` não sobrescreve arquivos que já existem.) Não é preciso reiniciar a API.

> **Atenção:** o backup na mesma máquina e no mesmo disco **não protege contra a perda da máquina** (disco corrompido, instância apagada). Leve uma cópia para fora, por exemplo enviando o ZIP mais recente para um bucket S3 (`aws s3 cp`) ou baixando-o periodicamente.

---

## 15. Cópia de imagem a partir de um link

`POST /api/v1/produtos/:id/imagem/link` (equipe) recebe `{ "url": "https://..." }`, baixa a imagem no servidor, valida e **guarda uma cópia** em `UPLOADS_DIR`, com a mesma substituição, auditoria e exclusão da imagem anterior do upload comum. É a rota que guarda uma cópia: o cadastro e a edição do produto continuam aceitando uma URL externa em `imagem_url` e apenas guardam o endereço, sem baixar nada. A lógica de gravar, atualizar `imagem_url`, auditar e apagar a anterior está em `servicos/imagemProduto.js`.

### Segurança da rota (SSRF)
Como o servidor faz a chamada, a rota só pode alcançar a internet pública. O código está em `servicos/baixarImagem.js`:
- Só `http` e `https`, até 2048 caracteres, sem usuário e senha na URL.
- O nome é resolvido pela opção `lookup` da própria conexão, então o endereço validado é exatamente o usado para conectar (não há segunda resolução; isso impede rebinding de DNS). IPs escritos na URL são conferidos antes de conectar.
- Bloqueia loopback, redes privadas, link-local (inclusive `169.254.169.254`, dos metadados da AWS), CGNAT, multicast, reservados e não especificados, em IPv4 e IPv6, inclusive IPv4 embutido em IPv6 (`::ffff:127.0.0.1`, NAT64, 6to4). Se um nome resolver para qualquer endereço interno, a conexão é recusada.
- No máximo 3 redirecionamentos, cada um revalidado. Tempo total de 10 s e no máximo 5 MB (o download é interrompido ao passar disso). Com `Content-Type` JPEG, PNG, WEBP ou GIF, o tipo declarado precisa bater com a assinatura do arquivo. Com `Content-Type` ausente, `application/octet-stream` ou `binary/octet-stream`, o tipo e a extensão saem da assinatura. Qualquer outro tipo (`text/html`, `image/svg+xml`, JSON...) é recusado sem baixar o corpo.
- Não envia cookies nem cabeçalhos de autenticação. O conteúdo e os detalhes da resposta remota nunca voltam para quem chamou; os erros são `422` com `URL_INVALIDA`, `URL_NAO_PERMITIDA`, `IMAGEM_INVALIDA`, `IMAGEM_MUITO_GRANDE` ou `IMAGEM_INACESSIVEL`.
- Limite de 30 requisições por minuto por usuário. A auditoria guarda a URL de origem **sem a query string** (links assinados podem conter tokens).
- Nos testes (`NODE_ENV=test`), e só neles, o loopback pode ser liberado para um servidor HTTP local; em qualquer outro ambiente isso é impossível.

### Para a infraestrutura
- Exija **IMDSv2** na instância EC2 (`HttpTokens=required`) com limite de saltos em 1 (`HttpPutResponseHopLimit=1`), como defesa extra caso alguma proteção falhe:
  ```bash
  aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 1 --http-endpoint enabled
  ```
- Testes manuais (logado como equipe, com um produto existente). Todos devem ser **recusados** com `422 URL_NAO_PERMITIDA`:
  - `{ "url": "http://169.254.169.254/latest/meta-data/" }`
  - `{ "url": "http://localhost:3000/saude" }`
  - `{ "url": "http://127.0.0.1" }`
  - E, para conferir o caminho feliz, uma imagem pública (`https://...jpg`) deve ser aceita e servida em `/arquivos/uploads/...`.

---

## 16. Envio em massa de fotos por ZIP

`POST /api/v1/produtos/imagens/lote` (equipe, multipart): campo `arquivo` com um `.zip` e campo opcional `substituir` (`sim` ou `nao`, padrão `nao`). Cada foto vira a imagem de um produto, com a mesma substituição, auditoria e exclusão do upload anterior da troca individual (`servicos/imagemProduto.js`).

- **Casamento:** o nome do arquivo, sem pasta, sem a extensão e sem espaços nas pontas, é o SKU do produto (sem diferenciar maiúsculas). O casamento é somente com o SKU gravado no banco; nenhum arquivo de seed é lido. Uma foto por produto: vale a primeira, na ordem do ZIP, que for uma imagem válida e dentro do limite; as demais do mesmo produto (outra extensão ou o mesmo nome em outra pasta) vão para `duplicadas`. Foto inválida ou grande demais não reserva o produto: vai para `formato_invalido` ou `grande_demais` e a próxima foto válida pode ser aplicada.
- **Produtos que já têm imagem** (inclusive os caminhos locais `/img/...`) são ignorados e contados em `ignoradas_ja_tem_imagem`, a menos que `substituir=sim`.
- **Segurança do ZIP:** o nome interno nunca é usado para gravar (os arquivos levam nome UUID); só o último trecho serve para casar. Ignora pastas, `__MACOSX/`, `.DS_Store` e arquivos ocultos. Confere a extensão (jpg, jpeg, png, webp, gif) e a assinatura do arquivo (`lib/imagem.js`).
- **Limites:** ZIP de até 20 MB, 200 arquivos, 5 MB por imagem e 100 MB descompactados (proteção contra ZIP bomba, conferida pelos tamanhos declarados antes de gravar qualquer coisa e reforçada na descompactação). Passou disso: `422 ZIP_MUITO_GRANDE`, pedindo para dividir em mais de um ZIP.
- **Memória:** o ZIP é gravado em disco (pasta oculta `.lote` dentro de `UPLOADS_DIR`, e não em `/tmp`, que em algumas distribuições é memória) e apagado ao fim da requisição; sobras de uma queda (arquivos com mais de 1 hora em `.lote`) são removidas na subida da API e no início de cada lote. A pasta e os demais arquivos ocultos nunca são servidos, contados, copiados pelo `uploads:mover` nem incluídos no backup. O diretório do ZIP é lido sem carregar o arquivo; cada imagem é descompactada e tratada uma por vez (`lib/zip.js`).
- **Relatório (200):** `total_arquivos`, `aplicadas`, `ignoradas_ja_tem_imagem`, `sem_produto`, `formato_invalido`, `grande_demais`, `duplicadas`, `falhas` (nomes), `arquivos_ignorados_do_sistema` e `listas_cortadas`. Cada lista de nomes tem no máximo 200 itens; se passar, `listas_cortadas` diz quais. Uma imagem com problema não derruba as outras.
- Usa o mesmo limitador das rotas de importação: o limite global por IP de `/api/v1` (as rotas de importação não têm limitador próprio).

---

## 17. Dados pessoais e privacidade (LGPD)

Esta seção descreve o que a API guarda e as medidas adotadas. Ela **não afirma conformidade total** com a LGPD: várias decisões dependem da empresa (veja [Pendências para uso real](#pendências-para-uso-real-pela-empresa)).

### Dados guardados e finalidade

| Dado | Onde fica | Finalidade |
|---|---|---|
| Nome, razão social, e-mail, CNPJ e telefone | `usuarios` | Cadastro e contato comercial |
| Endereços de entrega | `enderecos` | Entrega dos pedidos |
| Senha | `usuarios`, **somente o hash bcrypt** (a senha em si nunca é guardada) | Login |
| Pedidos, carrinho e favoritos | `pedidos`, `itens_pedido`, `carrinhos`, `favoritos` | Compra, histórico e "repetir pedido" |
| Eventos de navegação | `eventos` | Métricas: identificador de sessão anônimo, termo buscado, produto visto; `id_usuario` só se a pessoa estiver logada. **Não há IP nem user-agent.** |
| Auditoria | `auditoria` | Quem fez o quê, com os campos alterados. Chaves de senha, hash, token e segredo nunca entram |
| Notas da equipe sobre clientes e registro de contato de carrinho abandonado | `notas_cliente`, `carrinho_contatos` | Atendimento: texto livre, autor e data |

O CNPJ identifica pessoa jurídica, mas **e-mail, telefone e nome de contato podem ser dados de pessoas físicas**, e o texto livre das notas e das observações de contato também pode conter dados pessoais.

### Medidas já existentes
- **Senha:** bcrypt. A API nunca devolve o hash.
- **Token JWT:** tem validade (8 h, ou `JWT_EXPIRES_IN`) e é conferido no banco a cada requisição: é recusado se o usuário foi desativado ou se a senha foi trocada depois da emissão do token.
- **Acesso:** a lista, os detalhes, o histórico e as notas de clientes são só da equipe (`/clientes/...`). O cliente acessa apenas a própria conta (`/minha-conta`) e os próprios pedidos; o pedido de outro cliente aparece como inexistente. Eventos são gravados sem IP.
- **Logs:** cada requisição registra apenas método, rota **sem query string**, status, duração e id do usuário, além do id da requisição. Não há corpo, senha nem IP.
- **Segredos:** o `.env` fica fora do Git. Cabeçalhos de segurança com `helmet` e limites de requisição por IP (e por usuário em rotas específicas).
- **HTTPS:** fica por conta da infraestrutura (proxy, balanceador); a API não termina TLS.

### Direitos do titular: como funciona hoje
- **Correção:** o cliente corrige nome, e-mail, telefone e endereços em `/minha-conta`. CNPJ e razão social só a equipe altera (`PUT /clientes/:id`).
- **Desativação:** a equipe desativa um cliente com `PUT /clientes/:id` e `ativo=false`. O cliente deixa de entrar e o histórico de pedidos é preservado.
- **Exclusão definitiva: não existe endpoint.** Se o titular pedir a eliminação dos dados, o procedimento é **manual**, feito por quem administra o banco, e **deve ser registrado** (quem pediu, quando, o que foi apagado ou anonimizado e por quem). Atenção aos pedidos, que têm valor de registro comercial, e às notas e à auditoria, que podem citar a pessoa.
- **Acesso e portabilidade:** não há exportação automática dos dados do titular; também é uma consulta manual no banco.

### Pendências para uso real pela empresa
Decisões da empresa, não do código:
1. Definir quem é o **responsável pelo tratamento** (e o contato do encarregado, se houver).
2. Definir o **prazo de retenção** dos dados (clientes inativos, eventos, auditoria, notas) e como a limpeza será feita; hoje só os eventos têm limpeza automática (job `limpeza-eventos`, apaga o que tem mais de 12 meses).
3. Publicar o texto da **política de privacidade** no site e, se couber, o aviso no cadastro.
