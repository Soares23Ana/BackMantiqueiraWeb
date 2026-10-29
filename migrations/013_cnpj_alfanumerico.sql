-- CNPJ alfanumérico (Receita Federal, a partir de julho de 2026): 12 posições com letras maiúsculas ou números
-- e 2 dígitos verificadores numéricos. A API grava o CNPJ normalizado (maiúsculas, sem pontuação), sempre com 14 caracteres.
-- REGEXP_LIKE com 'c' diferencia maiúsculas: a collation da tabela não diferencia e aceitaria "abc".

ALTER TABLE usuarios DROP CHECK ck_usuarios_cnpj;

ALTER TABLE usuarios MODIFY COLUMN cnpj VARCHAR(14) NULL;

ALTER TABLE usuarios
    ADD CONSTRAINT ck_usuarios_cnpj CHECK (cnpj IS NULL OR REGEXP_LIKE(cnpj, '^[0-9A-Z]{12}[0-9]{2}$', 'c'));
