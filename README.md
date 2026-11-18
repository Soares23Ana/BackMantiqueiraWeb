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
npm run seed:catalogo   # catálogo inicial (seeds/catalogo_inicial.csv)
npm run seed:dev        # usuários de teste
npm run seed:demo       # banners, campanha, contatos e pedidos de demonstração
npm run dev             # API em http://localhost:3000 (a API fica em /api/v1)
npm test                # testes (usam o banco mantiqueira_test, apagado e recriado a cada execução)
npm run uploads:mover   # copia as fotos de publico/uploads para a pasta definida em UPLOADS_DIR
npm run backup:fotos    # gera um ZIP com a cópia de segurança das fotos enviadas
npm run redefinir-senha-admin   # só no servidor: gera o token para um administrador que perdeu a senha escolher outra
```

Os seeds podem rodar várias vezes. O `seed:dev` e o `seed:demo` se recusam a rodar em produção ou contra o RDS.

Em produção (ex.: AWS), não use os seeds de teste: crie o primeiro administrador com `npm run criar-admin`, como descrito em [Primeiro acesso em produção](docs/GUIA_TECNICO.md#10-primeiro-acesso-em-produção).

Senha esquecida: o cliente pede a nova senha na tela de login (`POST /api/v1/auth/redefinicao-senha/solicitar`), a equipe vê o pedido no painel e usa `POST /api/v1/redefinicoes-senha/pedidos/:id/enviar-link`, que gera o link e deixa a conversa do WhatsApp pronta. Ou a equipe gera um link de uso único (`POST /api/v1/clientes/:id/redefinicao-senha`, ou `/admin/usuarios/:id/redefinicao-senha` para a equipe) e a própria pessoa escolhe a nova senha, sem e-mail ([Redefinição de senha](docs/GUIA_TECNICO.md#18-redefinição-de-senha)). Se o único administrador perder a senha, rode `npm run redefinir-senha-admin -- --email x@y.com` no servidor: o comando não pede senha, só imprime um token (e a validade, 60 minutos) para repassar ao administrador, que escolhe a própria senha em `/redefinir-senha?token=...`. Atualizando uma nuvem existente: as migrations 024 a 026 criam as tabelas `redefinicoes_senha` e `pedidos_redefinicao_senha`, então rode `npm run migrar` (aplica a 025 e a 026 em ordem; confira com `npm run migrar:status` e faça snapshot do RDS antes, pois DDL no MySQL não é transacional). Selo de pedidos do menu: a migration 027 adiciona `pedidos.visto_em`/`visto_por` e marca os pedidos existentes como vistos (o selo conta só os pedidos que a equipe ainda não abriu; veja o [Guia técnico](docs/GUIA_TECNICO.md#pedidos-não-vistos-selo-do-menu)). Migrations 001 a 027: rode `npm run migrar` ao atualizar. Na nuvem, atrás do Nginx, defina `TRUST_PROXY=1` e `SITE_URL` no `.env` (trecho do Nginx no [Guia técnico](docs/GUIA_TECNICO.md#na-nuvem)); `GET /saude/detalhado` avisa se faltarem.

## Fotos dos produtos
* As fotos enviadas ficam na pasta definida por `UPLOADS_DIR` (em produção, fora do projeto).
* O gestor troca a foto de um produto enviando o arquivo (`POST /produtos/:id/imagem`), colando o link da imagem (`POST /produtos/:id/imagem/link`, com proteção contra acesso à rede interna) ou enviando um ZIP com várias fotos nomeadas pelo SKU (`POST /produtos/imagens/lote`).
* A cópia de segurança é gerada por `npm run backup:fotos`.
* Detalhes nas seções [14](docs/GUIA_TECNICO.md#14-fotos-enviadas-uploads), [15](docs/GUIA_TECNICO.md#15-cópia-de-imagem-a-partir-de-um-link) e [16](docs/GUIA_TECNICO.md#16-envio-em-massa-de-fotos-por-zip) do guia técnico.

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
* [`docs/GUIA_TECNICO.md`](docs/GUIA_TECNICO.md): variáveis opcionais, migrations, seeds, servidor, CORS, importação de CSV, jobs agendados, saúde, fotos enviadas, backup das fotos, dados pessoais e privacidade (LGPD) e redefinição de senha.
* [`docs/MAPA_FRONT_API.md`](docs/MAPA_FRONT_API.md): cada tela do front, os endpoints que ela usa e o que o front precisa mudar.
