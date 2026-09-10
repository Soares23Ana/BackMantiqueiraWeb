-- 1. Criação do Banco de Dados
CREATE DATABASE mantiqueira_db;
USE mantiqueira_db;

-- 2. Criação das Tabelas
CREATE TABLE fornecedores (
    id_fornecedor INT AUTO_INCREMENT PRIMARY KEY,
    nome_fantasia VARCHAR(100) NOT NULL,
    cnpj VARCHAR(18) UNIQUE NOT NULL,
    email VARCHAR(100)
);

CREATE TABLE produtos (
    id_produto INT AUTO_INCREMENT PRIMARY KEY,
    id_fornecedor INT,
    nome VARCHAR(100) NOT NULL,
    preco DECIMAL(10, 2) NOT NULL,
    quantidade_estoque INT DEFAULT 0,
    FOREIGN KEY (id_fornecedor) REFERENCES fornecedores(id_fornecedor)
);

CREATE TABLE clientes (
    id_cliente INT AUTO_INCREMENT PRIMARY KEY,
    razao_social VARCHAR(150) NOT NULL,
    cnpj VARCHAR(18) UNIQUE NOT NULL,
    telefone VARCHAR(15)
);

CREATE TABLE pedidos (
    id_pedido INT AUTO_INCREMENT PRIMARY KEY,
    id_cliente INT,
    data_pedido DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('Pendente', 'Separacao_Estoque', 'Em_Rota_Mantiqueira', 'Entregue') DEFAULT 'Pendente',
    FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente)
);

CREATE TABLE itens_pedido (
    id_pedido INT,
    id_produto INT,
    quantidade INT NOT NULL,
    preco_unitario DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (id_pedido, id_produto),
    FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido),
    FOREIGN KEY (id_produto) REFERENCES produtos(id_produto)
);

-- 3. Inserção de Dados de Teste (Armazenamento)
INSERT INTO fornecedores (nome_fantasia, cnpj, email) VALUES 
('Ambev Indústria', '07.526.557/0001-00', 'vendas@ambev.com.br'),
('Coca-Cola Femsa', '00.000.000/0001-91', 'distribuicao@femsa.com.br');

INSERT INTO produtos (id_fornecedor, nome, preco, quantidade_estoque) VALUES 
(1, 'Cerveja Skol Lata 350ml', 3.50, 1000),
(1, 'Cerveja Brahma Garrafa 600ml', 7.00, 500),
(2, 'Coca-Cola Pet 2L', 8.50, 800);

INSERT INTO clientes (razao_social, cnpj, telefone) VALUES 
('Mercadinho da Esquina', '11.111.111/0001-11', '11999999999'),
('Padaria Pão Quente', '22.222.222/0001-22', '11988888888');

INSERT INTO pedidos (id_cliente, status) VALUES 
(1, 'Em_Rota_Mantiqueira'),
(2, 'Separacao_Estoque');

INSERT INTO itens_pedido (id_pedido, id_produto, quantidade, preco_unitario) VALUES 
(1, 1, 50, 3.50), -- Mercadinho comprou 50 Skol
(1, 3, 20, 8.50), -- Mercadinho comprou 20 Coca-Colas
(2, 2, 30, 7.00); -- Padaria comprou 30 Brahmas