-- Suporte: notas internas por cliente e trilha de auditoria das alterações feitas pela equipe.
-- auditoria.resumo guarda só os campos alterados (antes/depois), nunca senha, hash ou token.

CREATE TABLE notas_cliente (
    id_nota INT AUTO_INCREMENT PRIMARY KEY,
    id_cliente INT NOT NULL,
    texto VARCHAR(1000) NOT NULL,
    id_autor INT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_notas_cliente_data (id_cliente, criado_em),
    CONSTRAINT fk_notas_cliente_cliente FOREIGN KEY (id_cliente) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    CONSTRAINT fk_notas_cliente_autor FOREIGN KEY (id_autor) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE auditoria (
    id_auditoria BIGINT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NULL,
    acao VARCHAR(60) NOT NULL,
    entidade VARCHAR(40) NOT NULL,
    id_entidade VARCHAR(60) NULL,
    resumo JSON NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_auditoria_entidade (entidade, id_entidade),
    KEY idx_auditoria_usuario (id_usuario),
    KEY idx_auditoria_data (criado_em),
    CONSTRAINT fk_auditoria_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
