-- Novo tipo de importação por pasta: "catalogo" (carga incremental de hora em hora, sem desativar produtos ausentes).
-- "carga_completa" passa a ser só a carga da meia-noite (arquivos carga_completa*).

ALTER TABLE sincronizacoes_log
    MODIFY COLUMN tipo ENUM('importacao_manual', 'catalogo', 'carga_completa', 'estoque') NOT NULL;
