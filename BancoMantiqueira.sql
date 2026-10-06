-- 1. Criação e Seleção da Base de Dados
CREATE DATABASE IF NOT EXISTS mantiqueira_db;
USE mantiqueira_db;

-- 2. Tabela de Utilizadores (Clientes, Funcionários, Gerentes e Administradores)
CREATE TABLE usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    cpf_cnpj VARCHAR(18),
    telefone VARCHAR(20),
    tipo ENUM('cliente', 'funcionario', 'gerente', 'admin') DEFAULT 'cliente',
    cargo VARCHAR(50),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabela de Fornecedores
CREATE TABLE fornecedores (
    id_fornecedor INT AUTO_INCREMENT PRIMARY KEY,
    nome_fantasia VARCHAR(100) NOT NULL,
    cnpj VARCHAR(18) UNIQUE NOT NULL,
    email VARCHAR(100)
);

-- 4. Tabela de Produtos / Itens
CREATE TABLE produtos (
    id_produto INT AUTO_INCREMENT PRIMARY KEY,
    id_fornecedor INT,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    preco DECIMAL(10, 2) NOT NULL,
    quantidade_estoque INT DEFAULT 0,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_fornecedor) REFERENCES fornecedores(id_fornecedor) ON DELETE SET NULL
);

-- 5. Tabela de Pedidos / Transportes
CREATE TABLE pedidos (
    id_pedido INT AUTO_INCREMENT PRIMARY KEY,
    id_cliente INT NOT NULL,
    id_funcionario INT,
    data_pedido DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Pendente', 'Separacao_Estoque', 'Em_Rota_Mantiqueira', 'Entregue', 'Cancelado') DEFAULT 'Pendente',
    FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario),
    FOREIGN KEY (id_funcionario) REFERENCES usuarios(id_usuario)
);

-- 6. Tabela de Itens do Pedido
CREATE TABLE itens_pedido (
    id_pedido INT,
    id_produto INT,
    quantidade INT NOT NULL,
    preco_unitario DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (id_pedido, id_produto),
    FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    FOREIGN KEY (id_produto) REFERENCES produtos(id_produto)
);

-- 7. Conteúdo de banners gerenciado pelo CMS
CREATE TABLE conteudo_cms (
    id_banner INT AUTO_INCREMENT PRIMARY KEY,
    titulo VARCHAR(150) NOT NULL,
    link VARCHAR(2048),
    imagem_url VARCHAR(2048) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE
);

-- ===================================================
-- INSERÇÃO DE DADOS INICIAIS DE TESTE
-- ===================================================

-- Utilizadores Padrão (Senhas salvas em hash bcrypt para a palavra-passe '123456')
INSERT INTO usuarios (nome, email, senha, tipo) VALUES 
('Administrador Mantiqueira', 'admin@mantiqueira.com', '$2b$10$e8R6.V.vR81W48/T4j83p.rB4p6N1gK7j5C0zE9k9R61', 'admin'),
('Gerente Geral', 'gerente@mantiqueira.com', '$2b$10$e8R6.V.vR81W48/T4j83p.rB4p6N1gK7j5C0zE9k9R61', 'gerente');

INSERT INTO usuarios (nome, email, senha, tipo, cargo, telefone) VALUES 
('Carlos Motorista', 'carlos@mantiqueira.com', '$2b$10$e8R6.V.vR81W48/T4j83p.rB4p6N1gK7j5C0zE9k9R61', 'funcionario', 'Motorista', '11977777777');

INSERT INTO usuarios (nome, email, senha, cpf_cnpj, tipo, telefone) VALUES 
('Mercadinho da Esquina', 'cliente@mercadinho.com', '$2b$10$e8R6.V.vR81W48/T4j83p.rB4p6N1gK7j5C0zE9k9R61', '11.111.111/0001-11', 'cliente', '11999999999');

-- Fornecedores
INSERT INTO fornecedores (nome_fantasia, cnpj, email) VALUES 
('Ambev Indústria', '07.526.557/0001-00', 'vendas@ambev.com.br'),
('Coca-Cola Femsa', '00.000.000/0001-91', 'distribuicao@femsa.com.br');

-- Produtos
INSERT INTO produtos (id_fornecedor, nome, preco, quantidade_estoque) VALUES 
(1, 'Cerveja Skol Lata 350ml', 3.50, 1000),
(1, 'Cerveja Brahma Garrafa 600ml', 7.00, 500),
(2, 'Coca-Cola Pet 2L', 8.50, 800);