-- Pedidos: dados do checkout, cancelamento com motivo e histórico de status.

UPDATE pedidos SET status = 'Aguardando Separação' WHERE status IS NULL;

-- endereco_entrega guarda uma cópia do endereço no momento do pedido: editar ou remover o endereço
-- depois não altera pedidos já feitos.
ALTER TABLE pedidos
    ADD COLUMN id_endereco INT NULL AFTER id_funcionario,
    ADD COLUMN endereco_entrega JSON NULL AFTER id_endereco,
    ADD COLUMN observacao VARCHAR(500) NULL AFTER endereco_entrega,
    ADD COLUMN data_entrega_desejada DATE NULL AFTER data_pedido,
    ADD COLUMN motivo_cancelamento VARCHAR(500) NULL AFTER status,
    ADD COLUMN atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    MODIFY COLUMN status ENUM('Aguardando Separação', 'Em Separação', 'Saiu para Entrega', 'Entregue', 'Cancelado')
        NOT NULL DEFAULT 'Aguardando Separação',
    ADD KEY idx_pedidos_status_data (status, data_pedido),
    ADD KEY idx_pedidos_cliente_data (id_cliente, data_pedido),
    ADD CONSTRAINT fk_pedidos_endereco FOREIGN KEY (id_endereco) REFERENCES enderecos(id_endereco) ON DELETE SET NULL;

CREATE TABLE pedido_historico (
    id_historico INT AUTO_INCREMENT PRIMARY KEY,
    id_pedido INT NOT NULL,
    status_anterior ENUM('Aguardando Separação', 'Em Separação', 'Saiu para Entrega', 'Entregue', 'Cancelado') NULL,
    status_novo ENUM('Aguardando Separação', 'Em Separação', 'Saiu para Entrega', 'Entregue', 'Cancelado') NOT NULL,
    id_usuario INT NULL,
    observacao VARCHAR(500) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_historico_pedido (id_pedido, criado_em),
    CONSTRAINT fk_historico_pedido FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    CONSTRAINT fk_historico_usuario FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Pedidos anteriores ganham um registro inicial com o status em que estavam.
INSERT INTO pedido_historico (id_pedido, status_anterior, status_novo, observacao, criado_em)
SELECT id_pedido, NULL, status, 'Status registrado na migração 006.', data_pedido FROM pedidos;
