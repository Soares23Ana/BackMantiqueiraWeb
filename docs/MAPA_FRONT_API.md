# Mapa front ↔ API

Situação de cada tela do front (`mantiqueira-react-front/mantiqueira-react`, em 30/10/2026) em relação à API: qual endpoint ela usa hoje, o que já está ligado, o que ainda é fixo no código e o que precisa mudar. O contrato completo de cada rota está em [`API.md`](API.md).

Todas as rotas abaixo ficam sob `/api/v1`, exceto quando indicado.

## Resumo

O front **já está ligado à API** em quase tudo: `src/api/client.ts` envia o token, trata erros no formato da API e um `401` leva ao login. Os dados simulados de `src/data/` foram removidos, exceto `brands.ts` (texto editorial das marcas, que continua no front de propósito). O que falta é recente na API e ainda não chegou ao front:

| Pendência | Onde | Prioridade |
|---|---|---|
| `Idempotency-Key` no `POST /pedidos` | Checkout | [1](#prioridades) |
| CNPJ alfanumérico (máscara, validação, login) | `utils/cnpj.ts`, Login, Cadastro | [2](#prioridades) |
| Desconectar depois de trocar a senha | Minha conta | [3](#prioridades) |
| Consulta de CEP e de CNPJ no cadastro | Cadastro | [4](#prioridades) |
| Novos cadastros (contador, filtro) | Layout do gestor, Clientes, Painel | [5](#prioridades) |
| Métricas ainda sem tela | Métricas | [6](#prioridades) |

## Decisões já tomadas

| Assunto | Decisão | Situação no front |
|---|---|---|
| Valores financeiros | A API **não devolve valores** em pedidos, clientes, painel nem métricas. O `preco` do produto aparece só para a equipe. | Feito: painel, pedidos e exportações não têm valores. |
| Grupo do cliente | Não existe no back (não há tabela de preço). | Feito: sem filtro nem coluna "Grupo". |
| Favoritos | Ficam no navegador (`localStorage`); não há rota de favoritos. | Feito: ids em `mantiqueira.favoritos`; cada produto vem de `GET /produtos/:id` (`useProductsById`). |
| Exportar CSV | Montado no front, com os dados que ele já carregou. | Feito: `fetchAllPages` percorre as páginas (100 por vez) em Pedidos, Clientes e Produtos. |
| Comentários no pedido | Não há rota de comentários. | Feito: `observacao` ao avançar o status, `motivo` no cancelamento, ambos no `historico`. |
| Carrinho | Fica no navegador; não há rota de carrinho. | Feito: `mantiqueira.carrinho`. |
| Texto das marcas | A API não guarda conteúdo editorial. | `data/brands.ts` continua no front; os `id` já são os slugs da API. |

## O que vale para todas as telas

- **Endereço da API**: em desenvolvimento o Vite encaminha `/api`, `/arquivos` e `/saude` para `http://localhost:3000` (sem CORS). Em produção, defina `VITE_API_URL` (veja `.env.example`) e libere a origem do front no CORS da API ([Guia técnico, seção 6](GUIA_TECNICO.md#6-cors)).
- **Token**: guardado em `mantiqueira.token` e enviado como `Authorization: Bearer`. `401 NAO_AUTENTICADO` com token limpa a sessão e leva ao login com "Sua sessão expirou." Já feito.
- **Erros**: `ApiError` lê `{ sucesso: false, mensagem, codigo, detalhes? }`; `fieldErrors` transforma `detalhes` em `{ campo: mensagem }` (inclusive `endereco.cep`). Já feito.
- **Imagens**: `imageUrl()` prefixa `/arquivos/...` com a API e deixa `/img/...` no front. Já feito.
- **Métricas de navegação**: `utils/events.ts` envia `POST /eventos` (`produto_visto`, `carrinho_adicionar`, `checkout_iniciado`, `banner_clique`, `campanha_clique`), com `sessao` aleatória; falha nunca atrapalha a tela. Já feito.
- **Status do pedido**: o front já usa os nomes da API (`Aguardando Separação`, `Em Separação`, `Saiu para Entrega`, `Entregue`, `Cancelado`).
- **Marcas**: os `id` de `brands.ts` e os slugs da API coincidem (`risque`, `kimberly-clark`, `bic`, `baruel`, `granado`, `colgate-palmolive`; as demais são `outras-marcas`).

## Loja

### Header, Footer e aviso do topo (`components/Header.tsx`, `Footer.tsx`, `context/StoreContext.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Telefone, WhatsApp, e-mail, horário, aviso do topo | `GET /configuracoes/publicas` |
| Categorias do menu | `GET /categorias` |
| Marcas | `GET /marcas` |
| Campanhas ativas (selos e vitrine) | `GET /campanhas/ativas` |
| Busca com sugestões | `GET /produtos/sugestoes?busca=` |

- **Ligado:** tudo acima. O botão "Gestor" só aparece para a equipe.
- **Fixo no código:** os contatos padrão do Footer (usados só enquanto a configuração não carrega ou está vazia) e o logotipo.
- **Mudar:** nada.

### Home (`pages/Home.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Banners | `GET /cms` |
| Campanhas ativas | `GET /campanhas/ativas` (via `StoreContext`) |
| Destaques | `GET /produtos?disponibilidade=em_estoque&ordenar=recentes&limite=8` |
| Cliques em banner e campanha | `POST /eventos` |

- **Ligado:** tudo. Sem banners no ar, mostra a abertura padrão (`Hero`).
- **Fixo no código:** conteúdo de marketing de `Hero`, `ZoomBanner`, `Benefits` e `BrandPanels` (não vêm do CMS).
- **Mudar:** nada obrigatório. Se a equipe quiser editar esses textos, usar os blocos do CMS (`GET /cms/blocos`), que hoje o público não consome.

### Catálogo (`pages/Catalog.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Lista, busca, categoria, marca, disponibilidade, ordenação e paginação | `GET /produtos` |
| Contagens dos filtros | `GET /produtos/filtros` |

- **Ligado:** tudo, com filtros na URL. Se o token for de cliente, o produto vem com `estoque`.
- **Mudar:** nada.

### Marca (`pages/Brand.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Produtos da marca | `GET /produtos?marca=<slug>&limite=100` |

- **Ligado:** produtos. **Fixo no código (decisão):** textos e cores de `data/brands.ts`.
- **Mudar:** nada.

### Detalhe do produto (`pages/ProductDetail.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Produto | `GET /produtos/:id` |
| Relacionados | `GET /produtos?marca=<slug>&limite=9` |
| Visita | `POST /eventos` `produto_visto` |

- **Ligado:** tudo, com múltiplo de venda e disponibilidade.
- **Mudar:** nada.

### Favoritos (`pages/Favorites.tsx`)
- **Usa hoje:** `GET /produtos/:id` para cada id salvo; produto que volta `404` é ignorado.
- **Ligado:** tudo. **Mudar:** nada.

### Carrinho (`pages/Cart.tsx`)
- **Usa hoje:** `GET /produtos/:id` para conferir estoque, múltiplo e se o produto saiu de linha; `POST /eventos` `carrinho_adicionar`.
- **Ligado:** tudo. Pede login de cliente; a equipe vê um aviso em vez do botão.
- **Mudar:** nada.

### Checkout (`pages/Checkout.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Endereços do cliente | `GET /minha-conta/enderecos` |
| Enviar o pedido | `POST /pedidos` `{ itens, id_endereco?, observacao?, data_entrega_desejada? }` |
| Abertura do checkout | `POST /eventos` `checkout_iniciado` |

- **Ligado:** tudo, inclusive `409 ITENS_INDISPONIVEIS` (lista os itens e oferece "Ajustar para N"/"Remover").
- **Mudar:** **enviar o cabeçalho `Idempotency-Key`**. Hoje `api.post` não aceita cabeçalhos e o pedido vai sem a chave; se a rede falhar depois de o servidor gravar o pedido, o cliente reenvia e o pedido duplica. Gerar `crypto.randomUUID()` ao abrir o checkout, reenviar o mesmo valor nas novas tentativas e trocar só depois de um sucesso. Com a chave repetida, a API devolve o pedido já criado (`200`).

### Login (`pages/Login.tsx`, `context/AuthContext.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Entrar | `POST /auth/login` `{ identificador, senha }` |
| Sessão salva | `GET /auth/me` |

- **Ligado:** tela única; a equipe vai para `/gestor`, o cliente para `/minha-conta` (ou para onde estava). `429 MUITAS_TENTATIVAS` tem mensagem própria. "Esqueci a senha" orienta a falar com a equipe.
- **Mudar:** a regra de e-mail ou CNPJ. Hoje `Login.tsx` trata como e-mail qualquer texto com letra (`/[@a-z]/i`), então um **CNPJ alfanumérico** seria tratado como e-mail e perderia a máscara. A regra da API é só o `@`: com `@` é e-mail da equipe; sem `@` é CNPJ. Ver [CNPJ alfanumérico](#cnpj-alfanumérico).

### Cadastro (`pages/Register.tsx`, `components/AddressFields.tsx`)
| Usa hoje | Endpoint |
|---|---|
| Criar conta | `POST /auth/register` `{ cnpj, nome, email, telefone, senha, endereco }` |

- **Ligado:** o formulário já tem todos os campos que a API exige, marca o campo de cada erro `422` e leva ao login com a mensagem de sucesso. Um `503` aparece como mensagem do formulário, sem apagar o que foi digitado.
- **Mudar:** (1) CNPJ alfanumérico; (2) preencher o endereço pelo CEP; (3) mostrar o nome da empresa pelo CNPJ. Detalhes abaixo.

#### CNPJ alfanumérico
Desde julho de 2026 a Receita emite CNPJs com letras nas 12 primeiras posições; os 2 últimos (dígitos verificadores) continuam números. A API aceita os dois tipos. Em `src/utils/cnpj.ts` (usado no Login e no Cadastro):

- **Máscara**: `formatCnpj` apaga as letras (`replace(/\D/g, '')`). Precisa aceitar letras e números nas 12 primeiras posições e só números nas 2 últimas, convertendo para maiúsculas enquanto a pessoa digita.
- **Teclado**: o campo do Cadastro usa `inputMode="numeric"`; trocar para `text`, para o celular mostrar letras.
- **Validação**: `isValidCnpj` usa `Number(d[i])` e `\D`. Precisa usar o valor de cada caractere = código ASCII − 48 (números continuam valendo 0 a 9; `A` vale 17). Ou só conferir o formato e deixar a API validar (ela responde `422` no campo `cnpj`).
- **Login**: ver acima (só o `@` decide).
- Exemplo de máscara (os nomes são só sugestão):
  ```ts
  const normalizarCnpj = (v: string) => v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
  function formatarCnpj(v: string) {
    const n = normalizarCnpj(v);
    const c = n.slice(0, 12) + n.slice(12).replace(/\D/g, ''); // os 2 últimos só aceitam números
    return c.replace(/^(.{2})(.{1,3})?(.{1,3})?(.{1,4})?(\d{1,2})?$/, (_, a, b, c2, d, e) =>
      [a, b && `.${b}`, c2 && `.${c2}`, d && `/${d}`, e && `-${e}`].filter(Boolean).join(''));
  }
  ```

#### Endereço pelo CEP
`GET /cep/:cep` (público, 30 consultas por minuto por IP). Hoje `AddressFields` só formata o CEP; nada é consultado.
- Quando o CEP tiver 8 dígitos (com ou sem hífen), consultar uma vez (não a cada tecla) e preencher `logradouro`, `bairro`, `cidade` e `estado`. A pessoa continua podendo editar tudo e completa `numero` e `complemento`. Como o componente também é usado em "Meus endereços", o ganho vale nos dois lugares.
- Campos que vierem vazios (cidade com CEP único não tem rua nem bairro) ficam para a pessoa digitar.
- `404 CEP_NAO_ENCONTRADO` ou `503 SERVICO_INDISPONIVEL`: **a pessoa digita o endereço à mão**. O cadastro não depende dessa consulta e aceita o endereço digitado. Texto sugerido:
  - 404: "Não encontramos esse CEP. Confira o número ou preencha o endereço à mão."
  - 503: "Não conseguimos buscar o endereço agora. Preencha os campos à mão."
- `422`: CEP com formato errado (marcar o campo CEP).

#### Nome da empresa pelo CNPJ
`GET /cnpj/:cnpj` (público, 20 consultas por minuto por IP). Hoje não é usado.
- Quando o CNPJ estiver completo e válido, consultar uma vez e mostrar a `razao_social` (e o `nome_fantasia`, se houver) antes de enviar o cadastro, para a pessoa conferir. Resposta: `{ cnpj, razao_social, nome_fantasia, situacao, cidade, estado }`.
- **Envie o CNPJ sem pontuação** (`/cnpj/12ABC34501DE35`): com a pontuação, a `/` do CNPJ quebraria o caminho da rota. Use a mesma `normalizarCnpj` da máscara.
- A consulta é só informativa e não deve impedir o envio: quem valida é o `POST /auth/register`. Se `situacao` não for `ATIVA`, já avisar que o cadastro será recusado. Em `404`, avisar "CNPJ não encontrado na Receita Federal"; em `503`, não mostrar nada e deixar a pessoa seguir.

#### Novos erros do cadastro
Em produção, a API consulta o CNPJ na Receita antes de criar a conta; a razão social passa a vir de lá.

| Erro | Quando | Texto sugerido |
|---|---|---|
| `422 CNPJ_NAO_ENCONTRADO` (campo `cnpj`) | O CNPJ não existe na Receita | "Não encontramos este CNPJ na Receita Federal. Confira os números e letras digitados." |
| `422 CNPJ_INATIVO` (campo `cnpj`) | A situação na Receita não é `ATIVA` (ex.: `BAIXADA`, `SUSPENSA`, `INAPTA`) | Mostrar a `mensagem` da API, que já traz a situação, ou: "Este CNPJ está com situação {situação} na Receita Federal. Só empresas com CNPJ ativo podem se cadastrar." |
| `503 SERVICO_INDISPONIVEL` | O serviço de consulta da Receita está fora do ar | "Não foi possível validar o CNPJ agora. Tente novamente em instantes." Manter o que foi digitado no formulário, para a pessoa só reenviar. |

Os dois `422` vêm com `detalhes: [{ campo: "cnpj", mensagem }]`. **O front já mostra isso no campo de CNPJ**, porque `fieldErrors` trata todo `422` do mesmo jeito, e o `503` aparece como mensagem do formulário com o texto da API. Só falta, se quiserem, trocar pelos textos sugeridos. Não há aprovação manual: com o CNPJ ativo, a conta já pode entrar.

### Minha conta (`pages/account/*`)
| Tela | Endpoint |
|---|---|
| Meus pedidos | `GET /pedidos/meus?status=&pagina=&limite=` |
| Detalhe do pedido | `GET /pedidos/:id`, `POST /pedidos/:id/cancelar` `{ motivo }` |
| Repetir pedido | `GET /pedidos/:id/repetir` → `itens_para_checkout` (vai para o carrinho) |
| Dados | `GET`/`PATCH /minha-conta` |
| Endereços | `GET`/`POST /minha-conta/enderecos`, `PATCH`/`DELETE /minha-conta/enderecos/:id` (inclui tornar principal) |
| Senha | `PATCH /minha-conta/senha` `{ senha_atual, nova_senha }` |

- **Ligado:** tudo.
- **Mudar:** a troca de senha. Depois do `200`, **o token atual deixa de valer** (todos os emitidos antes da troca). Hoje `Password.tsx` mostra "Senha alterada." e continua na tela; a próxima requisição recebe `401` e a pessoa cai no login com "Sua sessão expirou", sem entender por quê. Melhor: depois do sucesso, chamar `logout()` e levar a `/entrar` com a mensagem "Senha alterada. Entre novamente com a senha nova."

## Área do gestor

Todas as rotas exigem token da **equipe** (`RequireRole` no front). A tela Equipe só aparece para `pode_gerenciar_equipe`.

### Barra lateral (`pages/manager/ManagerLayout.tsx`)
- **Usa hoje:** `GET /painel/contadores` a cada troca de rota, para os selos de Pedidos (`pedidos_pendentes`) e Produtos (`estoque_baixo`).
- **Mudar:** ler também `clientes_novos_7_dias` e mostrá-lo como selo de "Clientes" (a interface `Contadores` só declara os dois campos antigos).

### Painel (`pages/manager/Overview.tsx`)
| Bloco | Endpoint |
|---|---|
| Pedidos pendentes, estoque baixo, clientes ativos | `GET /painel` |
| Pedidos para separar | `GET /pedidos?status=Aguardando Separação,Em Separação&limite=6` |
| Alertas de reposição (com sugestão de compra) | `GET /painel/alertas-reposicao` |

- **Ligado:** tudo, sem valores financeiros.
- **Mudar:** incluir um card "Novos cadastros (7 dias)" com `clientes_novos_7_dias` de `GET /painel/contadores`, levando a `/gestor/clientes` com o filtro de novos.

### Pedidos (`pages/manager/Orders.tsx`)
| Ação | Endpoint |
|---|---|
| Lista, busca, status e paginação | `GET /pedidos?status=&busca=&pagina=&limite=` |
| Detalhe com linha do tempo | `GET /pedidos/:id` (`historico`, `proximo_status`, `pode_cancelar`) |
| Avançar status (com observação opcional) | `PATCH /pedidos/:id/status` `{ status, observacao? }` |
| Cancelar (motivo obrigatório) | `POST /pedidos/:id/cancelar` `{ motivo }` |
| Exportar CSV | `GET /pedidos` em todas as páginas |

- **Ligado:** tudo. A API aceita `PUT` e `PATCH` no status; o front usa `PATCH`.
- **Mudar:** nada.

### Produtos (`pages/manager/Products.tsx`, `Taxonomies.tsx`)
| Ação | Endpoint |
|---|---|
| Lista (inclusive inativos), busca, filtros e paginação | `GET /produtos?incluir_inativos=true&...` |
| Categorias e marcas (listar, criar, renomear, ativar, excluir) | `/categorias` e `/marcas` (`GET`, `POST`, `PATCH`, `DELETE`, com `incluir_inativos=true`) |
| Criar e editar produto | `POST /produtos`, `PATCH /produtos/:id` |
| Foto do produto | `POST /produtos/:id/imagem` (multipart) |
| Ativar/desativar | `PATCH /produtos/:id` `{ ativo }` |
| Ajustar estoque (observação obrigatória) | `PATCH /produtos/:id/estoque` |
| Histórico de estoque | `GET /produtos/:id/movimentacoes?limite=30` |
| Exportar CSV | `GET /produtos` em todas as páginas |

- **Ligado:** tudo. O ajuste exige observação de 3 a 500 caracteres, como a API pede.
- **Mudar:** nada.

### Importação (`pages/manager/Imports.tsx`)
| Ação | Endpoint |
|---|---|
| Enviar CSV (simulação ou carga completa) | `POST /produtos/importar?simular=&carga_completa=` (multipart) |
| Histórico | `GET /produtos/importacoes?tipo=&pagina=&limite=` |
| Detalhe de uma importação | `GET /produtos/importacoes/:id` |

- **Ligado:** tudo. **Mudar:** nada.

### Clientes (`pages/manager/Customers.tsx`)
| Ação | Endpoint |
|---|---|
| Lista, busca e "só CNPJ pendente" | `GET /clientes?busca=&sem_cnpj=true&pagina=&limite=` |
| Ativar/desativar | `PUT /clientes/:id` `{ ativo }` |
| Detalhes e edição | `GET /clientes/:id/detalhes`, `PUT /clientes/:id` |
| Senha temporária | `PUT /clientes/:id/senha` `{ senha }` |
| Exportar CSV (sem "Grupo" nem "Receita") | `GET /clientes` em todas as páginas |

- **Ligado:** tudo, com `nome_exibicao`. A busca por CNPJ aceita letras, com ou sem pontuação.
- **Mudar:** **novos cadastros**. Oferecer o filtro "Novos (7 dias)", que chama `GET /clientes?novos_dias=7` (do mais recente para o mais antigo; aceita de 1 a 365 e combina com `busca`), e o selo do menu e o card do painel descritos acima. O contador inclui clientes inativos. É só para a equipe consultar quando quiser: **não existe aprovação de cadastro** e nada fica bloqueado esperando revisão.

### Conteúdo (`pages/manager/Cms.tsx`)
| Ação | Endpoint |
|---|---|
| Banners (todos) | `GET /cms/todos` |
| Criar e editar banner (com imagem) | `POST /cms`, `PATCH /cms/:id` (multipart) |
| Ativar/desativar banner | `PATCH /cms/:id` `{ ativo }` |
| Reordenar | `PUT /cms/ordem` `{ ids }` |
| Excluir banner | `DELETE /cms/:id` |
| Blocos de conteúdo | `GET /cms/blocos`, `PUT /cms/blocos/:chave`, `DELETE /cms/blocos/:chave` |
| Configurações (contatos, aviso do topo, meta de reposição) | `GET /configuracoes`, `PUT /configuracoes/:chave` |

- **Ligado:** tudo. **Mudar:** nada. Os blocos são editados aqui, mas a loja ainda não os mostra (ver Home).

### Campanhas (`pages/manager/Campaigns.tsx`)
- **Usa hoje:** `GET /campanhas?situacao=`, `POST /campanhas`, `PATCH /campanhas/:id` (editar e encerrar, com `fim_em`), `DELETE /campanhas/:id`, e `GET /produtos?busca=` para escolher os produtos.
- **Ligado:** tudo. **Mudar:** nada.

### Métricas (`pages/manager/Metrics.tsx`)
| Bloco | Endpoint |
|---|---|
| Indicadores e navegação | `GET /metricas/resumo?de=&ate=` |
| Termos buscados e sem resultado | `GET /metricas/buscas` |
| Produtos mais pedidos | `GET /metricas/produtos-mais-pedidos` |
| Clientes sem comprar | `GET /metricas/clientes-inativos?dias=` |

- **Ligado:** os quatro acima.
- **Mudar (opcional):** a API tem outras cinco métricas que nenhuma tela usa: `/metricas/funil`, `/metricas/produtos-vistos`, `/metricas/banners-campanhas`, `/metricas/pedidos-por-dia` e `/metricas/ciclo-pedido`. Decidir quais valem uma tela.

### Equipe (`pages/manager/Team.tsx`)
- **Usa hoje:** `GET /admin/usuarios?tipo=equipe`, `POST /admin/usuarios`, `PATCH /admin/usuarios/:id`. Exige `pode_gerenciar_equipe`.
- **Ligado:** tudo. **Mudar:** nada. (A rota antiga `GET /auth/users` foi removida; o front nunca a usou.)

### Saúde do sistema (`pages/manager/SystemHealth.tsx`)
- **Usa hoje:** `GET /saude/detalhado` (fora de `/api/v1`).
- **Ligado:** tudo. **Mudar:** nada.

## Prioridades

Do que mais bloqueia ao que menos bloqueia:

1. **`Idempotency-Key` no checkout.** Único risco de dados incorretos: um reenvio por falha de rede cria pedido duplicado e baixa o estoque duas vezes. É pequeno: `api.post` precisa aceitar cabeçalhos e o Checkout gera a chave.
2. **CNPJ alfanumérico (máscara, validação e regra do login).** Quando a Receita emitir os primeiros CNPJs com letras, essas empresas **não conseguem se cadastrar nem entrar**: a máscara apaga as letras e o login as trata como e-mail. Ainda não bloqueia ninguém, porque a emissão está só começando, mas é o que mais bloqueia quando acontecer.
3. **Logout depois de trocar a senha.** Hoje a pessoa troca a senha e, na próxima ação, é derrubada sem explicação. Não bloqueia, mas parece defeito.
4. **Consulta de CEP e de CNPJ no cadastro.** Não bloqueia (o cadastro aceita o endereço digitado à mão), mas reduz erros de digitação, deixa a pessoa conferir a empresa antes de enviar e evita um `422` à toa. Os textos sugeridos para os erros novos podem entrar junto.
5. **Novos cadastros no gestor** (selo do menu, card do painel e filtro em Clientes). A equipe consegue trabalhar sem, mas hoje não vê quem acabou de se cadastrar.
6. **Telas para as outras métricas** e **blocos do CMS na loja**. A API já entrega; falta decidir se a equipe quer ver ou editar isso.
