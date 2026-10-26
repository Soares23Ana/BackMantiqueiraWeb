-- Migra os status existentes sem perder pedidos ou o status terminal legado Cancelado.
ALTER TABLE pedidos
    MODIFY COLUMN status ENUM(
        'Pendente',
        'Separacao_Estoque',
        'Em_Rota_Mantiqueira',
        'Aguardando Separação',
        'Em Separação',
        'Saiu para Entrega',
        'Entregue',
        'Cancelado'
    ) NULL DEFAULT 'Aguardando Separação';

UPDATE pedidos
SET status = CASE status
    WHEN 'Pendente' THEN 'Aguardando Separação'
    WHEN 'Separacao_Estoque' THEN 'Em Separação'
    WHEN 'Em_Rota_Mantiqueira' THEN 'Saiu para Entrega'
    ELSE status
END;

ALTER TABLE pedidos
    MODIFY COLUMN status ENUM(
        'Aguardando Separação',
        'Em Separação',
        'Saiu para Entrega',
        'Entregue',
        'Cancelado'
    ) NULL DEFAULT 'Aguardando Separação';
