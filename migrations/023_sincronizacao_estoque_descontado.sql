-- Total de unidades que a importação de estoque descontou por pedidos feitos depois da geração da planilha.

ALTER TABLE sincronizacoes_log ADD COLUMN estoque_descontado INT NOT NULL DEFAULT 0 AFTER movimentacoes_estoque;
