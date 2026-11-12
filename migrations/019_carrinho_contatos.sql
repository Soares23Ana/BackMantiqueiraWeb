-- Registro de contato da equipe com o cliente que abandonou o carrinho (sem envio automático; só o registro).

CREATE TABLE carrinho_contatos (
    id_contato INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    observacao VARCHAR(500) NULL,
    id_funcionario INT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_carrinho_contatos_usuario (id_usuario, criado_em),
    CONSTRAINT fk_carrinho_contatos_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    CONSTRAINT fk_carrinho_contatos_funcionario FOREIGN KEY (id_funcionario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
