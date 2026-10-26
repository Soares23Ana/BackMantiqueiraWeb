-- Operação: log das importações de catálogo, configurações, blocos de conteúdo e CMS completo.

CREATE TABLE sincronizacoes_log (
    id_sincronizacao INT AUTO_INCREMENT PRIMARY KEY,
    -- importacao_manual: upload pela API; carga_completa: job da meia-noite; estoque: job a cada 30 min.
    tipo ENUM('importacao_manual', 'carga_completa', 'estoque') NOT NULL,
    origem VARCHAR(255) NOT NULL,
    simulado BOOLEAN NOT NULL DEFAULT FALSE,
    status ENUM('em_andamento', 'sucesso', 'parcial', 'falha') NOT NULL DEFAULT 'em_andamento',
    linhas INT NOT NULL DEFAULT 0,
    criados INT NOT NULL DEFAULT 0,
    atualizados INT NOT NULL DEFAULT 0,
    inalterados INT NOT NULL DEFAULT 0,
    desativados INT NOT NULL DEFAULT 0,
    com_erro INT NOT NULL DEFAULT 0,
    movimentacoes_estoque INT NOT NULL DEFAULT 0,
    -- Relatório completo (erros linha a linha e avisos), limitado a 500 erros pelo importador.
    relatorio JSON NULL,
    mensagem VARCHAR(500) NULL,
    id_usuario INT NULL,
    iniciado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalizado_em DATETIME NULL,
    duracao_ms INT NULL,
    KEY idx_sincronizacoes_tipo_data (tipo, iniciado_em),
    CONSTRAINT fk_sincronizacoes_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Configurações chave/valor. "publica" define o que aparece em GET /configuracoes/publicas.
CREATE TABLE configuracoes (
    chave VARCHAR(60) PRIMARY KEY,
    valor TEXT NULL,
    publica BOOLEAN NOT NULL DEFAULT FALSE,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    id_usuario INT NULL,
    CONSTRAINT fk_configuracoes_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO configuracoes (chave, valor, publica) VALUES
('meta_reposicao', '50', FALSE),
('whatsapp', NULL, TRUE),
('telefone_contato', NULL, TRUE),
('email_contato', NULL, TRUE),
('horario_atendimento', NULL, TRUE),
('aviso_topo', NULL, TRUE);

-- Blocos de texto editáveis do site (ex.: "sobre", "politica-de-entrega"), identificados por chave.
CREATE TABLE blocos_cms (
    id_bloco INT AUTO_INCREMENT PRIMARY KEY,
    chave VARCHAR(60) NOT NULL,
    titulo VARCHAR(150) NULL,
    conteudo TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_blocos_chave (chave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Banners: ordem de exibição e janela de exibição opcional (início/fim).
ALTER TABLE conteudo_cms
    ADD COLUMN ordem INT NOT NULL DEFAULT 0 AFTER imagem_url,
    ADD COLUMN inicio_em DATETIME NULL AFTER ativo,
    ADD COLUMN fim_em DATETIME NULL AFTER inicio_em,
    ADD COLUMN criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    ADD KEY idx_banners_exibicao (ativo, ordem),
    ADD CONSTRAINT ck_banners_janela CHECK (inicio_em IS NULL OR fim_em IS NULL OR fim_em > inicio_em);

-- Mantém a ordem atual (mais recentes primeiro, como era listado).
UPDATE conteudo_cms c
JOIN (SELECT id_banner, ROW_NUMBER() OVER (ORDER BY id_banner DESC) AS posicao FROM conteudo_cms) o
    ON o.id_banner = c.id_banner
SET c.ordem = o.posicao;
