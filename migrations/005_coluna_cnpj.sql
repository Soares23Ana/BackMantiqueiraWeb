-- Sistema B2B: a coluna de documento do cliente passa a se chamar só "cnpj".
-- O índice único uk_usuarios_cnpj acompanha a coluna renomeada; cnpj_original é mantida.
-- O MySQL não renomeia coluna usada em CHECK, por isso a restrição é removida e recriada.

ALTER TABLE usuarios DROP CHECK ck_usuarios_cnpj;

ALTER TABLE usuarios RENAME COLUMN cnpj_cpf TO cnpj;

ALTER TABLE usuarios
    ADD CONSTRAINT ck_usuarios_cnpj CHECK (cnpj IS NULL OR cnpj REGEXP '^[0-9]{14}$');
