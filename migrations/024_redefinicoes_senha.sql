-- Redefinição de senha por link de uso único, gerado pela equipe (sem e-mail).
-- Só o SHA-256 do token é guardado (token_hash); o token em texto aparece uma única vez, na resposta de quem gera o link.
-- usado_em também marca os links invalidados por um link mais novo ou por uma redefinição concluída.

CREATE TABLE redefinicoes_senha (
    id_redefinicao INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_em DATETIME NOT NULL,
    usado_em DATETIME NULL,
    criado_por INT NULL,
    UNIQUE KEY uq_redefinicoes_senha_token (token_hash),
    KEY idx_redefinicoes_senha_usuario (id_usuario),
    CONSTRAINT fk_redefinicoes_senha_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
    CONSTRAINT fk_redefinicoes_senha_criador FOREIGN KEY (criado_por) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
