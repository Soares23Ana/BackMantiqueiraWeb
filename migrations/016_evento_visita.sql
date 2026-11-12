-- Visitantes: novo tipo de evento "visita" (no máximo uma por sessão por dia). "dia_visita" guarda o dia
-- (horário de Brasília) só nas visitas; o índice único impede a repetição mesmo com requisições simultâneas.
-- Como NULL não conta no índice único, os outros eventos não são afetados.

ALTER TABLE eventos
    MODIFY COLUMN tipo ENUM(
        'busca', 'busca_sem_resultado', 'produto_visto', 'carrinho_adicionar',
        'checkout_iniciado', 'pedido_concluido', 'banner_clique', 'campanha_clique', 'visita'
    ) NOT NULL,
    ADD COLUMN dia_visita DATE NULL AFTER id_campanha,
    ADD UNIQUE KEY uk_eventos_visita_dia (sessao, dia_visita);
