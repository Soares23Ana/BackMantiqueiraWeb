# Mantiqueira Distribuidora - API e Banco de Dados

API REST (Node.js/Express) e banco de dados (MySQL) da plataforma B2B da distribuidora Mantiqueira.
Qualquer visitante vê o catálogo; clientes entram com CNPJ para fazer pedidos, e a equipe entra com e-mail para gerenciar produtos, estoque, pedidos, clientes e conteúdo do site.

## Tecnologias
* **Backend**: Node.js 20+, Express 5
* **Banco de dados**: MySQL 8 com Sequelize ORM (`mysql2` como driver) e migrations SQL numeradas
* **Segurança**: JWT (`jsonwebtoken`), criptografia de senhas (`bcrypt`), `helmet`, limite de requisições
* **Testes**: `node:test` + `supertest`

## Pré-requisitos
* Node.js 20 ou superior
* MySQL Server 8 (local) ou AWS RDS

## Instalação e `.env`
Copie o `.env.example` para `.env` e preencha. A API valida as variáveis ao iniciar e não sobe se algo estiver errado.

| Variável | Obrigatória |
|---|---|
| `JWT_SECRET` | Sempre. Pelo menos 32 caracteres, longa e aleatória |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Em produção (em desenvolvimento, o padrão é `localhost`, `root`, senha vazia e `mantiqueira_db`) |

Para gerar o `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> **O `.env` nunca vai para o Git.** Ele tem senhas e segredos e já está no `.gitignore`. Para mostrar à equipe quais variáveis existem, use o `.env.example`.

As variáveis opcionais (limites, CORS, jobs, logs etc.) estão no [guia técnico](docs/GUIA_TECNICO.md#1-variáveis-de-ambiente).

## Como rodar
```bash
npm install             # dependências
npm run migrar          # cria o banco e aplica as migrations
npm run seed:catalogo   # 38 produtos do catálogo inicial
npm run seed:dev        # usuários de teste
npm run seed:demo       # banners, campanha, contatos e pedidos de demonstração
npm run dev             # API em http://localhost:3000 (a API fica em /api/v1)
npm test                # testes (usam o banco mantiqueira_test, apagado e recriado a cada execução)
```

Os seeds podem rodar várias vezes. O `seed:dev` e o `seed:demo` se recusam a rodar em produção ou contra o RDS.

Em produção (ex.: AWS), não use os seeds de teste: crie o primeiro administrador com `npm run criar-admin`, como descrito em [Primeiro acesso em produção](docs/GUIA_TECNICO.md#10-primeiro-acesso-em-produção).

## Usuários de teste
Criados pelo `seed:dev`, todos com a senha `Mantiqueira@2026`.

| Perfil | Login | Observação |
|---|---|---|
| equipe | `admin@mantiqueira.com` | Administrador, pode gerenciar a equipe |
| equipe | `gerente@mantiqueira.com` | Gerente |
| equipe | `funcionario@mantiqueira.com` | Estoquista |
| cliente | CNPJ `11.222.333/0001-81` | Mercadinho da Esquina, com endereço e os pedidos do `seed:demo` |

> **Essa senha é só para desenvolvimento.** Nunca use esses usuários nem essa senha em produção.

## Documentação
* [`docs/API.md`](docs/API.md): contrato completo da API, com convenções, exemplos de requisição e resposta de cada endpoint e limitações conhecidas.
* [`docs/GUIA_TECNICO.md`](docs/GUIA_TECNICO.md): variáveis opcionais, migrations, seeds, servidor, CORS, importação de CSV, jobs agendados e saúde.
* [`docs/MAPA_FRONT_API.md`](docs/MAPA_FRONT_API.md): cada tela do front, os endpoints que ela usa e o que o front precisa mudar.
