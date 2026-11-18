-- Pedido de nova senha: evolui a tabela criada na migration 025 (solicitacoes_redefinicao) para pedidos_redefinicao_senha,
-- com status (pendente, atendido, dispensado, expirado) e atualizado_em. Os pedidos que já existem continuam:
-- os com atendido_em viram "atendido"; os demais seguem "pendente".
-- No máximo UM pedido pendente por cliente: a coluna gerada (virtual) pendente_de vale o id do cliente só enquanto o pedido
-- está pendente (nula nos demais), e o índice único sobre ela barra um segundo pendente do mesmo cliente.

RENAME TABLE solicitacoes_redefinicao TO pedidos_redefinicao_senha;

ALTER TABLE pedidos_redefinicao_senha
    CHANGE COLUMN id_solicitacao id_pedido INT NOT NULL AUTO_INCREMENT,
    ADD COLUMN status ENUM('pendente', 'atendido', 'dispensado', 'expirado') NOT NULL DEFAULT 'pendente' AFTER id_usuario,
    ADD COLUMN atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER criado_em;

UPDATE pedidos_redefinicao_senha SET status = 'atendido' WHERE atendido_em IS NOT NULL;

ALTER TABLE pedidos_redefinicao_senha
    ADD COLUMN pendente_de INT GENERATED ALWAYS AS (IF(status = 'pendente', id_usuario, NULL)) VIRTUAL,
    ADD UNIQUE KEY uq_pedidos_redefinicao_pendente (pendente_de),
    DROP INDEX idx_solicitacoes_redefinicao_pendentes,
    ADD KEY idx_pedidos_redefinicao_status (status, criado_em);
