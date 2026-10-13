# Mantiqueira Distribuidora - API e Banco de Dados

Este repositório contém a estrutura da API REST (Node.js/Express) e do banco de dados (MySQL) desenvolvidos para o sistema de gerenciamento da distribuidora Mantiqueira, com suporte a autenticação JWT e controle de acesso baseado em funções (RBAC).

## 🚀 Tecnologias Utilizadas
* **Backend**: Node.js, Express
* **Banco de Dados**: MySQL com Sequelize ORM (`mysql2` como driver)
* **Segurança**: JWT (`jsonwebtoken`), Criptografia de senhas (`bcrypt`), `dotenv`

## 📋 Pré-requisitos
* Node.js instalado na máquina.
* MySQL Server e MySQL Workbench configurados.

---

## 1. Configuração do Banco de Dados
1. Abra o MySQL Workbench e conecte-se ao seu servidor local.
2. Abra o arquivo `BancoMantiqueira.sql` pelo menu **File > Open SQL Script...**.
3. Execute o script para criar o banco de dados `mantiqueira_db`, as tabelas e a estrutura inicial.

## 2. Instalação das Dependências
No terminal, na pasta raiz do projeto, execute:

```bash
npm install
```

## 3. Configuração de Variáveis de Ambiente (`.env`)
Crie um arquivo chamado `.env` na raiz do projeto (no mesmo nível do `server.js`) utilizando o arquivo `.env.example` como referência:

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=SUA_SENHA_AQUI
DB_NAME=mantiqueira_db
JWT_SECRET=sua_chave_secreta_jwt
```

> **Nota de Segurança**: O arquivo `.env` contém dados sensíveis e é ignorado pelo Git (via `.gitignore`). Para compartilhar a estrutura de variáveis com a equipe, utilize o arquivo `.env.example`.

O CORS permite por padrão `http://localhost:5173`, `http://localhost:3000` e `http://localhost:3001`, com credenciais. Origens adicionais podem ser configuradas em `CORS_ORIGINS`, separadas por vírgula.

## 4. Execução do Servidor
Para iniciar a API, execute no terminal:

```bash
node server.js
```

O terminal exibirá a mensagem de confirmação do servidor rodando na porta `3000`.

---

## 📌 Principais Endpoints da API

### Painel, pedidos e CMS
* `GET /painel` - Retorna pedidos pendentes, clientes e produtos com estoque baixo. Requer JWT de `gerente`, `funcionario` ou `admin`; a resposta contém apenas indicadores operacionais.
* `GET /painel/contadores` - Retorna os contadores operacionais `pedidosPendentes` e `estoqueBaixo` para os badges do menu. Requer JWT de `gerente`, `funcionario` ou `admin`.
* `GET /painel/alertas-reposicao` - Lista produtos com estoque até 10 unidades e sugestão de compra até o alvo operacional de 50 unidades. Restrito a `gerente` e `admin`.
* `POST /pedidos` - Cria um pedido para o cliente autenticado. Envie `itens` como uma lista de `{ "id_produto": 1, "quantidade": 2 }`. O estoque e os itens são gravados na mesma transação.
* `GET /pedidos/:id_pedido` - Permite ao cliente consultar apenas o próprio pedido; `gerente` e `admin` podem consultar qualquer pedido. Retorna status, datas e itens operacionais, sem valores financeiros.
* `GET /pedidos` - Lista pedidos com cliente, funcionário e itens, sem valores financeiros. Requer JWT de `gerente`, `funcionario` ou `admin`.
* `PUT /pedidos/:id_pedido/status` - Atualiza o status para `Aguardando Separação`, `Em Separação`, `Saiu para Entrega` ou `Entregue`. Restrito a `gerente` e `admin`; ao entregar, registra `data_entrega` e emite uma notificação simulada no console. O endpoint legado `PATCH` permanece com as mesmas permissões.
* `GET /cms` - Lista os banners ativos.
* `POST /cms` - Salva um banner, restrito a `gerente`, `funcionario` ou `admin`. Envie multipart/form-data com `titulo`, opcionalmente `link`, e arquivo `imagem` (JPEG, PNG, WEBP ou GIF; até 5 MB).
* `GET /arquivos/uploads/:arquivo` - Serve as imagens enviadas ao CMS.

### Autenticação (`/auth`)
* `POST /auth/register` - Cadastra um usuário (`nome`, `email`, `senha`, `telefone` e, opcionalmente, `razao_social` e `cnpj_cpf`); o tipo inicial é `cliente`.
* `POST /auth/login` - Autentica o usuário e retorna o **Token JWT** com `id`, `nome`, `email` e `tipo`, além do objeto `usuario` sem a senha.
* `GET /auth/me` - Retorna `id`, `nome`, `email` e `tipo` do usuário autenticado. Requer `Authorization: Bearer <token>`.
* `GET /auth/users` - Lista os usuários sem expor as senhas (Requer Token JWT no cabeçalho `Authorization: Bearer <token>`).

### Produtos (`/produtos`)
* `GET /produtos` - Lista todos os produtos (Requer Token JWT no cabeçalho `Authorization: Bearer <TOKEN>`).
* `POST /produtos` - Cadastra um novo produto (Requer Token JWT com perfil `admin` ou `gerente`).

### Clientes (`/clientes`)
* `GET /clientes?busca=texto&pagina=1&limite=20` - Lista clientes com busca por nome, razão social ou CNPJ/CPF e paginação. Restrito a `gerente` e `admin`.
* `GET /clientes/:id/detalhes` - Retorna dados cadastrais, endereços de entrega, histórico operacional de pedidos e produtos mais solicitados.
* `PUT /clientes/:id` - Atualiza `razao_social`, `cnpj_cpf`, `telefone` e/ou `enderecos`. Cada endereço pode incluir `id_endereco` para atualizar um endereço existente; sem esse identificador, um endereço novo é cadastrado. Endereços omitidos não são removidos.

Clientes mantêm dados operacionais/comerciais (`razao_social`, `cnpj_cpf`, `telefone` e endereços de entrega). Nenhum dado bancário, de cartão ou limite de crédito é armazenado. Em uma atualização de status para `Entregue`, o pedido registra `data_entrega`.

Em bancos já existentes, execute uma vez [`migrations/20261009_status_operacionais_pedidos.sql`](./migrations/20261009_status_operacionais_pedidos.sql) para migrar os status antigos para o ciclo operacional atual e [`migrations/20261009_pedidos_operacionais.sql`](./migrations/20261009_pedidos_operacionais.sql) para permitir pedidos sem valores financeiros, preservando quaisquer registros históricos existentes.

Para aplicar o novo esquema em um banco existente, execute uma vez [`migrations/20261009_clientes_operacionais.sql`](./migrations/20261009_clientes_operacionais.sql). Em uma instalação nova, use [`BancoMantiqueira.sql`](./BancoMantiqueira.sql).