# Mapa front ↔ API

Como cada tela do front (`mantiqueira-react`) se liga à API e o que o front precisa mudar para isso.
Hoje o front não chama a API: tudo vem de `src/data/` (dados simulados). O contrato completo de cada rota está em [`API.md`](API.md).

Todas as rotas abaixo ficam sob `/api/v1`, exceto quando indicado.

## Decisões já tomadas

| Assunto | Decisão | Consequência no front |
|---|---|---|
| Valores financeiros | A API **não devolve valores** em pedidos, clientes, painel nem métricas. O `preco` do produto aparece só para a equipe. | Tirar "Faturamento" do painel, preço unitário/subtotal/total do pedido e "Receita"/"Total" das exportações. |
| Grupo do cliente | Não existe no back (não há tabela de preço). | Tirar o filtro e a coluna "Grupo" de Clientes e o tipo `CustomerGroup`. |
| Favoritos | Ficam no navegador (`localStorage`); não há rota de favoritos. | Guardar os `id_produto` e buscar cada um em `GET /produtos/:id` (a listagem não filtra por lista de ids). |
| Exportar CSV | Montado no front, com os dados que ele já carregou. | Com paginação (máx. 100 por página), percorrer as páginas antes de gerar o arquivo. |
| Comentários no pedido | Não haverá rota de comentários. | Usar a `observacao` da mudança de status (`PUT /pedidos/:id/status`) e o `motivo` do cancelamento; exibir pelo `historico` do pedido. Tirar o "Notificar cliente". |

## O que vale para todas as telas

- **Endereço da API**: criar `VITE_API_URL` (ex.: `http://localhost:3000`) e prefixar `/api/v1`. O CORS já libera `http://localhost:5173`, `http://127.0.0.1:5173` e `http://localhost:4173`.
- **Token**: guardar o `token` do login e enviar `Authorization: Bearer <token>`. Qualquer `401 NAO_AUTENTICADO` (token vencido em 8h, usuário desativado ou senha trocada) deve levar ao login.
- **Erros**: todos no formato `{ sucesso: false, mensagem, codigo, detalhes? }`. Em `422 VALIDACAO`, `detalhes` traz a lista `{ campo, mensagem }` para marcar cada campo do formulário.
- **Imagens**: `imagem_url` começando com `/img/` é do próprio front; começando com `/arquivos/` vem da API (prefixar com `VITE_API_URL`).
- **Ids**: os produtos passam a usar o `id_produto` da API em vez dos ids fixos de `src/data/products.ts`.
- **Status do pedido** (nomes diferentes):

  | Front hoje | API |
  |---|---|
  | `Pendente` | `Aguardando Separação` |
  | `Separando` | `Em Separação` |
  | `Enviado` | `Saiu para Entrega` |
  | `Entregue` | `Entregue` |
  | `Cancelado` | `Cancelado` |

- **Marcas** (`BrandId` do front → `slug` da API): `risque` → `risque`, `kimberly-clark` → `kimberly-clark`, `bic` → `bic`, `baruel` → `baruel`, `granado` → `granado`, `colgate` → `colgate-palmolive`, `outras` → `outras-marcas`. As **categorias** já têm os mesmos nomes.

## Loja

### Header e Footer (`components/Header.tsx`, `components/Footer.tsx`)
| Usa | Endpoint |
|---|---|
| Categorias do menu | `GET /categorias` |
| Telefone, WhatsApp, e-mail, horário, aviso do topo | `GET /configuracoes/publicas` |

**Mudar no front:** o Footer tem contatos fixos no código; passar a ler de `/configuracoes/publicas`. Mostrar o `aviso_topo` quando houver.

### Home (`pages/Home.tsx`, `components/Hero.tsx`, `ProductGrid`)
| Usa | Endpoint |
|---|---|
| Banners | `GET /cms` (só os no ar, na ordem) |
| Vitrine, filtro por categoria e busca | `GET /produtos?categoria=&busca=` (ou `q=`), paginado (24 por página) |
| Contagens dos filtros | `GET /produtos/filtros` |
| Selo de campanha nos cards | `GET /campanhas/ativas` (cruzar os `id_produto`) |
| Autocomplete da busca | `GET /produtos/sugestoes?q=` |

**Mudar no front:** trocar `src/data/products.ts` pela API, tratar paginação e `disponibilidade` (`disponivel`, `ultimas_unidades`, `indisponivel`). Se o token for de cliente, o produto vem também com `estoque`.

### Página da marca (`pages/Brand.tsx`)
| Usa | Endpoint |
|---|---|
| Produtos da marca | `GET /produtos?marca=<slug>` |

**Mudar no front:** os textos e painéis de `src/data/brands.ts` continuam no front (a API não guarda conteúdo de marca); só os produtos vêm da API, usando o slug da tabela acima.

### Detalhe do produto (`pages/ProductDetail.tsx`)
| Usa | Endpoint |
|---|---|
| Produto | `GET /produtos/:id` (aceita id ou SKU) |
| Registro de visita | `POST /eventos` `{ tipo: "produto_visto", id_produto, sessao? }` |

**Mudar no front:** usar `destaques`, `descricao`, `multiplo_venda` e `disponibilidade` da API. A quantidade escolhida precisa respeitar o `multiplo_venda`.

### Favoritos (`pages/Favorites.tsx`)
| Usa | Endpoint |
|---|---|
| Dados de cada favorito | `GET /produtos/:id` para cada id salvo |

**Mudar no front:** salvar os ids em `localStorage` (hoje ficam só na memória e somem ao recarregar). Ignorar ids que voltarem `404`.

### Carrinho e checkout (`pages/Cart.tsx`)
| Usa | Endpoint |
|---|---|
| Adicionar ao carrinho (métrica) | `POST /eventos` `{ tipo: "carrinho_adicionar", id_produto, quantidade }` |
| Abrir o checkout (métrica) | `POST /eventos` `{ tipo: "checkout_iniciado" }` |
| Endereço de entrega | `GET /minha-conta/enderecos` |
| Finalizar | `POST /pedidos` com `Idempotency-Key` |
| Repetir pedido anterior | `GET /pedidos/:id/repetir` → `itens_para_checkout` |

**Mudar no front:**
- Exigir login de cliente para finalizar.
- Gerar um `Idempotency-Key` (ex.: `crypto.randomUUID()`) ao abrir o checkout e reenviar o mesmo valor em caso de falha de rede.
- Tratar `409 ITENS_INDISPONIVEIS`: `detalhes` traz todos os itens com problema e a quantidade `disponivel` para ajustar o carrinho.
- Opcionais do pedido: `id_endereco`, `observacao`, `data_entrega_desejada` (de amanhã até 90 dias).
- O carrinho continua no front (não há rota de carrinho).

### Login e cadastro (`pages/Login.tsx`)
| Usa | Endpoint |
|---|---|
| Login de cliente | `POST /auth/login` `{ identificador: "<CNPJ>", senha }` |
| Login da equipe | `POST /auth/login` `{ identificador: "<e-mail>", senha }` |
| Cadastro | `POST /auth/register` |
| Sessão atual | `GET /auth/me` |

**Mudar no front:**
- O cadastro hoje pede só o CNPJ; a API exige `cnpj`, `nome`, `email`, `telefone`, `senha` e `endereco` (`cep`, `logradouro`, `numero`, `bairro`, `cidade`, `estado`; `complemento` e `referencia` opcionais).
- O botão "Gestor" abre a área do gestor sem login: passar a exigir o login da equipe por e-mail e decidir o destino pelo `tipo` (`cliente` ou `equipe`).
- "Recuperar senha" não existe na API: mostrar o WhatsApp de `/configuracoes/publicas` e orientar a pedir uma senha temporária à equipe.
- Tratar `429 MUITAS_TENTATIVAS` (10 falhas de login em 15 min por IP).

### Minha conta (não existe no front)
A API já tem `GET`/`PATCH /minha-conta`, `PATCH /minha-conta/senha`, `GET /pedidos/meus` e os endereços em `/minha-conta/enderecos`. Se o front criar essa tela: depois de `PATCH /minha-conta/senha` o token atual deixa de valer e o usuário precisa entrar de novo.

## Área do gestor (`pages/Manager.tsx`)

Todas as rotas exigem token da **equipe**.

### Painel (`components/manager/OverviewSection.tsx`)
| Card / bloco | Endpoint |
|---|---|
| Pedidos pendentes / em separação | `GET /painel` (`pedidos_pendentes`) e `GET /metricas/resumo` (`pedidos.por_status`) |
| Clientes ativos | `GET /painel` (`clientes_ativos`) |
| Atenção no estoque | `GET /painel` (`estoque_baixo`) e `GET /painel/alertas-reposicao` |

**Mudar no front:** tirar o card "Faturamento". O limite de estoque baixo é o `estoque_minimo` de cada produto (não um número fixo no front).

### Pedidos (`OrdersSection.tsx`, `OrderDetailModal.tsx`)
| Ação | Endpoint |
|---|---|
| Lista, busca e filtro de status | `GET /pedidos?status=&busca=&pagina=` |
| Detalhe com linha do tempo | `GET /pedidos/:id` (`historico`, `proximo_status`, `pode_cancelar`) |
| Avançar status | `PUT /pedidos/:id/status` `{ status, observacao? }` |
| Cancelar | `POST /pedidos/:id/cancelar` `{ motivo }` |

**Mudar no front:**
- Tirar preço unitário, subtotal e total do modal e a coluna "Total" da exportação.
- Trocar a área de comentários por um campo de observação enviado junto com "Marcar como...", e por um motivo obrigatório no cancelamento. As observações aparecem no `historico`.
- Tirar o "Notificar cliente".
- O próximo passo vem pronto em `proximo_status`.

### Produtos (`ProductsSection.tsx`)
| Ação | Endpoint |
|---|---|
| Lista (inclusive inativos), busca e categoria | `GET /produtos?incluir_inativos=true&busca=&categoria=` |
| Só estoque baixo ou zerado | `GET /painel/alertas-reposicao` (produtos ativos com estoque ≤ `estoque_minimo`) |
| +/− no estoque | `PATCH /produtos/:id/estoque` `{ ajuste: 1 \| -1, observacao }` |
| Ativar/desativar | `PATCH /produtos/:id` `{ ativo }` |
| Importar CSV | `POST /produtos/importar` (multipart, campo `arquivo`) |

**Mudar no front:**
- O ajuste de estoque exige `observacao` (3 a 500 caracteres): enviar um texto padrão (ex.: "Ajuste pela tela de produtos") ou pedir o motivo.
- Para a equipe, `preco` pode vir `null`.
- A exportação pode manter o preço (só a equipe vê).

### Clientes (`CustomersSection.tsx`)
| Ação | Endpoint |
|---|---|
| Lista dos que mais compram | `GET /clientes?ordenar=mais_pedidos` |
| Busca por nome, e-mail, CNPJ ou cidade | `GET /clientes?busca=` |
| Cidade e nº de pedidos na linha | campos `cidade` e `total_pedidos` de `GET /clientes` |
| Ativar/desativar | `PUT /clientes/:id` `{ ativo }` |
| Detalhes | `GET /clientes/:id/detalhes` |
| Senha temporária | `PUT /clientes/:id/senha` `{ senha }` |

**Mudar no front:**
- Tirar o filtro e a coluna "Grupo" e a "Receita" da exportação.
- Exibir `nome_exibicao` (razão social ou nome).
- `total_pedidos` não conta cancelados.

### Conteúdo (`ContentSection.tsx`, `BannerEditor.tsx`, `BannerFormModal.tsx`)
| Ação | Endpoint |
|---|---|
| Lista de banners (todos) | `GET /cms/todos` |
| Criar banner | `POST /cms` (multipart: `titulo`, `imagem`, `link?`) |
| Editar banner | `PATCH /cms/:id` |
| Reordenar (setas) | `PUT /cms/ordem` `{ ids: [...] }` com todos os banners |
| Excluir banner | `DELETE /cms/:id` |
| Lista de blocos | `GET /cms/blocos` (a equipe vê também os inativos) |
| Ligar/desligar bloco | `PATCH /cms/blocos/:chave` `{ ativo }` |

**Mudar no front:**
- O banner exige uma imagem enviada (arquivo), não um blob local.
- Os blocos da API têm `chave`, `titulo`, `conteudo` e `ativo`; o `type` do front (`Slider`, `Texto`...) não existe na API.
- O `link` do banner aceita caminho interno (`/...`) ou URL http/https; o formulário hoje só aceita URL completa.

## Dados para testar a integração
```bash
npm run migrar
npm run seed:catalogo
npm run seed:dev
npm run seed:demo
```
Cliente: CNPJ `11.222.333/0001-81`; equipe: `admin@mantiqueira.com`; senha `Mantiqueira@2026`. O `seed:demo` cria contatos, aviso do topo, 3 banners, 1 campanha ativa e 5 pedidos do cliente, um em cada status.
