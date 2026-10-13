-- Preserva eventuais valores históricos, mas permite pedidos novos sem dados financeiros.
ALTER TABLE itens_pedido
    MODIFY COLUMN preco_unitario DECIMAL(10, 2) NULL;
