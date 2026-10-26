-- Catálogo: categorias e marcas editáveis, campos novos de produto e registro de movimentações de estoque.

CREATE TABLE categorias (
    id_categoria INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_categorias_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE marcas (
    id_marca INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_marcas_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE produtos SET quantidade_estoque = 0 WHERE quantidade_estoque IS NULL;

-- O preço deixa de ser obrigatório: a plataforma não trata valores financeiros.
ALTER TABLE produtos
    ADD COLUMN sku VARCHAR(40) NULL AFTER id_produto,
    ADD COLUMN id_categoria INT NULL AFTER id_fornecedor,
    ADD COLUMN id_marca INT NULL AFTER id_categoria,
    MODIFY COLUMN nome VARCHAR(150) NOT NULL,
    ADD COLUMN destaques JSON NULL AFTER descricao,
    ADD COLUMN imagem_url VARCHAR(2048) NULL AFTER destaques,
    MODIFY COLUMN preco DECIMAL(10, 2) NULL,
    MODIFY COLUMN quantidade_estoque INT NOT NULL DEFAULT 0,
    ADD COLUMN estoque_minimo INT NOT NULL DEFAULT 10 AFTER quantidade_estoque,
    ADD COLUMN multiplo_venda INT NOT NULL DEFAULT 1 AFTER estoque_minimo,
    ADD COLUMN ativo BOOLEAN NOT NULL DEFAULT TRUE AFTER multiplo_venda,
    ADD COLUMN atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER criado_em;

-- Produtos anteriores ao catálogo recebem um SKU provisório para a coluna poder ser obrigatória e única.
UPDATE produtos SET sku = CONCAT('LEGADO-', id_produto) WHERE sku IS NULL;

ALTER TABLE produtos
    MODIFY COLUMN sku VARCHAR(40) NOT NULL,
    ADD UNIQUE KEY uk_produtos_sku (sku),
    ADD KEY idx_produtos_ativo_nome (ativo, nome),
    ADD CONSTRAINT fk_produtos_categoria FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria) ON DELETE SET NULL,
    ADD CONSTRAINT fk_produtos_marca FOREIGN KEY (id_marca) REFERENCES marcas(id_marca) ON DELETE SET NULL,
    ADD CONSTRAINT ck_produtos_estoque CHECK (quantidade_estoque >= 0),
    ADD CONSTRAINT ck_produtos_estoque_minimo CHECK (estoque_minimo >= 0),
    ADD CONSTRAINT ck_produtos_multiplo CHECK (multiplo_venda >= 1);

-- Toda mudança de estoque fica registrada (ajuste manual, pedido, cancelamento, importação).
CREATE TABLE movimentacoes_estoque (
    id_movimentacao INT AUTO_INCREMENT PRIMARY KEY,
    id_produto INT NOT NULL,
    tipo ENUM('ajuste', 'pedido', 'cancelamento', 'importacao') NOT NULL,
    quantidade INT NOT NULL,
    estoque_anterior INT NOT NULL,
    estoque_novo INT NOT NULL,
    observacao VARCHAR(500) NULL,
    id_usuario INT NULL,
    id_pedido INT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_movimentacoes_produto (id_produto, criado_em),
    CONSTRAINT fk_movimentacoes_produto FOREIGN KEY (id_produto) REFERENCES produtos(id_produto),
    CONSTRAINT fk_movimentacoes_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
    CONSTRAINT fk_movimentacoes_pedido FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
