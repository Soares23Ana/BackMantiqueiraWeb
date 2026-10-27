-- Eventos de uso para métricas. Não guarda IP; id_usuario só quando a pessoa está logada.
-- "sessao" é um identificador aleatório opcional gerado pelo front (não identifica a pessoa).
-- Sem chaves estrangeiras de propósito: a gravação fica leve e os eventos sobrevivem a exclusões.
-- Um job apaga eventos com mais de 12 meses.

CREATE TABLE eventos (
    id_evento BIGINT AUTO_INCREMENT PRIMARY KEY,
    tipo ENUM(
        'busca', 'busca_sem_resultado', 'produto_visto', 'carrinho_adicionar',
        'checkout_iniciado', 'pedido_concluido', 'banner_clique', 'campanha_clique'
    ) NOT NULL,
    id_usuario INT NULL,
    sessao VARCHAR(64) NULL,
    termo VARCHAR(100) NULL,
    resultados INT NULL,
    id_produto INT NULL,
    quantidade INT NULL,
    id_pedido INT NULL,
    id_banner INT NULL,
    id_campanha INT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_eventos_tipo_data (tipo, criado_em),
    KEY idx_eventos_data (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
