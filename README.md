# Mantiqueira Distribuidora - API e Banco de Dados

Este repositório contém a estrutura base da API (Node.js) e do banco de dados (MySQL) desenvolvidos para o sistema de gerenciamento da distribuidora.

## Pré-requisitos
* Node.js instalado na máquina.
* MySQL Server e MySQL Workbench configurados.

## 1. Configuração do Banco de Dados
* Abra o MySQL Workbench e conecte-se ao seu servidor local.
* Arraste o arquivo `BancoMantiqueira.sql` para o editor ou abra-o pelo menu **File > Open SQL Script...**.
* Clique no ícone de raio amarelo para executar o código. Isso criará o banco `mantiqueira_db`, as tabelas e inserirá os dados iniciais.

## 2. Instalação das Dependências (Backend)
A pasta `node_modules` contém os pacotes da aplicação, mas não é enviada ao GitHub por ser muito pesada (ignorada via `.gitignore`). Para recriá-la no seu computador:
* Abra o terminal na pasta principal onde o arquivo `server.js` está localizado.
* Execute o comando abaixo. O Node.js lerá o arquivo `package.json` e baixará tudo automaticamente:

    npm install

## 3. Vinculação do Banco com a API
* Dentro da pasta do projeto, localize a pasta `db` e abra o arquivo `conn.js`.
* Altere o campo de senha colocando a senha real do seu MySQL local para que a API consiga acessar o banco:

    password: 'SUA_SENHA_AQUI'

## 4. Execução do Servidor
* Com tudo instalado e a senha configurada, volte ao terminal na pasta do `server.js`.
* Execute o comando para iniciar a API:

    node server.js

* O terminal exibirá a mensagem confirmando que a API está rodando. Teste a conexão acessando `http://localhost:3000/produtos` no navegador ou no Insomnia/Postman.