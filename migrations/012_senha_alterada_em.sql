-- Momento da última troca de senha. Tokens emitidos antes dele deixam de valer (encerra as outras sessões).
-- NULL: a senha nunca foi trocada depois do cadastro.

ALTER TABLE usuarios
    ADD COLUMN senha_alterada_em DATETIME NULL AFTER senha;
