-- Idempotência do checkout: a chave do cabeçalho Idempotency-Key fica no pedido.
-- Única por cliente; NULL (pedido sem chave) pode se repetir. Comparação exata (ascii_bin): "abc" e "ABC" são chaves diferentes.

ALTER TABLE pedidos
    ADD COLUMN chave_idempotencia VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER id_cliente,
    ADD UNIQUE KEY uq_pedidos_cliente_chave (id_cliente, chave_idempotencia);
