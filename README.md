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

## 4. Execução do Servidor
Para iniciar a API, execute no terminal:

```bash
node server.js
```

O terminal exibirá a mensagem de confirmação do servidor rodando na porta `3000`.

---

## 📌 Principais Endpoints da API

### Painel, pedidos e CMS
* `GET /painel` - Retorna faturamento (sem pedidos cancelados), pedidos pendentes, clientes e produtos com estoque baixo. Requer JWT de `gerente`, `funcionario` ou `admin`.
* `POST /pedidos` - Cria um pedido para o cliente autenticado. Envie `itens` como uma lista de `{ "id_produto": 1, "quantidade": 2 }`. O estoque e os itens são gravados na mesma transação.
* `GET /pedidos` - Lista pedidos com cliente, funcionário e itens. Requer JWT de `gerente`, `funcionario` ou `admin`.
* `PATCH /pedidos/:id_pedido/status` - Atualiza o status do pedido com o corpo `{ "status": "Separacao_Estoque" }`. Requer JWT de `gerente`, `funcionario` ou `admin`.
* `GET /cms` - Lista os banners ativos.
* `POST /cms` - Salva um banner, restrito a `gerente`, `funcionario` ou `admin`. Envie multipart/form-data com `titulo`, opcionalmente `link`, e arquivo `imagem` (JPEG, PNG, WEBP ou GIF; até 5 MB).
* `GET /arquivos/uploads/:arquivo` - Serve as imagens enviadas ao CMS.

### Autenticação (`/auth`)
* `POST /auth/register` - Cadastra um novo usuário (`nome`, `email`, `senha`, `telefone`); o tipo inicial é `cliente`.
* `POST /auth/login` - Autentica o usuário e retorna o **Token JWT** contendo o perfil de acesso (`tipo`).
* `GET /auth/users` - Lista os usuários sem expor as senhas (Requer Token JWT no cabeçalho `Authorization: Bearer <token>`).

### Produtos (`/produtos`)
* `GET /produtos` - Lista todos os produtos (Requer Token JWT no cabeçalho `Authorization: Bearer <TOKEN>`).
* `POST /produtos` - Cadastra um novo produto (Requer Token JWT com perfil `admin` ou `gerente`).