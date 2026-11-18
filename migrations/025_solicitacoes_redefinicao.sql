-- Pedido de nova senha feito pelo próprio cliente na tela de login (informando o CNPJ).
-- A equipe vê os pedidos pendentes (selo no menu e lista em Clientes) e atende gerando o link de redefinição.
-- atendido_em marca o pedido como resolvido: link gerado, senha temporária definida ou senha trocada pelo cliente.
-- Só existe um pedido pendente por cliente (pedidos repetidos não criam linhas novas).

CREATE TABLE solicitacoes_redefinicao (
    id_solicitacao INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atendido_em DATETIME NULL,
    atendido_por INT NULL,
    KEY idx_solicitacoes_redefinicao_pendentes (atendido_em, criado_em),
    KEY idx_solicitacoes_redefinicao_usuario (id_usuario, atendido_em),
    CONSTRAINT fk_solicitacoes_redefinicao_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    CONSTRAINT fk_solicitacoes_redefinicao_atendente FOREIGN KEY (atendido_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
