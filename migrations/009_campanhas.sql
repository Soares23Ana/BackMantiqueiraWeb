-- Campanhas sem desconto: título, selo de texto (ex.: "Leve 8 pague 6" é só um rótulo), período e produtos.
-- A situação (agendada, ativa, encerrada) é calculada pelas datas; não há aprovação nem limite por cliente.

CREATE TABLE campanhas (
    id_campanha INT AUTO_INCREMENT PRIMARY KEY,
    titulo VARCHAR(120) NOT NULL,
    selo VARCHAR(40) NULL,
    inicio_em DATETIME NOT NULL,
    fim_em DATETIME NOT NULL,
    id_usuario INT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_campanhas_periodo (inicio_em, fim_em),
    CONSTRAINT ck_campanhas_periodo CHECK (fim_em > inicio_em),
    CONSTRAINT fk_campanhas_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE campanhas_produtos (
    id_campanha INT NOT NULL,
    id_produto INT NOT NULL,
    PRIMARY KEY (id_campanha, id_produto),
    KEY idx_campanhas_produtos_produto (id_produto),
    CONSTRAINT fk_campanhas_produtos_campanha FOREIGN KEY (id_campanha) REFERENCES campanhas(id_campanha) ON DELETE CASCADE,
    CONSTRAINT fk_campanhas_produtos_produto FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
