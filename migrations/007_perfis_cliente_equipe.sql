-- Perfis simplificados: "cliente" ou "equipe". Toda a equipe tem as mesmas permissões na área do gestor;
-- só quem tem pode_gerenciar_equipe cria, edita e desativa usuários da equipe.

ALTER TABLE usuarios
    ADD COLUMN pode_gerenciar_equipe BOOLEAN NOT NULL DEFAULT FALSE AFTER tipo,
    MODIFY COLUMN tipo ENUM('cliente', 'funcionario', 'gerente', 'admin', 'equipe') NOT NULL DEFAULT 'cliente';

UPDATE usuarios SET pode_gerenciar_equipe = TRUE WHERE tipo = 'admin';

-- O perfil antigo vira o cargo (texto livre, sem efeito em permissões) quando o cargo está vazio.
UPDATE usuarios
SET cargo = CASE tipo WHEN 'admin' THEN 'Administrador' WHEN 'gerente' THEN 'Gerente' ELSE 'Funcionário' END
WHERE tipo IN ('admin', 'gerente', 'funcionario') AND (cargo IS NULL OR cargo = '');

UPDATE usuarios SET tipo = 'equipe' WHERE tipo IN ('admin', 'gerente', 'funcionario');

-- Se não havia admin, o usuário ativo mais antigo da equipe recebe a marca para ninguém ficar sem acesso à gestão da equipe.
UPDATE usuarios
SET pode_gerenciar_equipe = TRUE
WHERE id_usuario = (
    SELECT id FROM (SELECT MIN(id_usuario) AS id FROM usuarios WHERE tipo = 'equipe' AND ativo = TRUE) AS mais_antigo
)
AND NOT EXISTS (
    SELECT 1 FROM (SELECT id_usuario FROM usuarios WHERE pode_gerenciar_equipe = TRUE) AS com_marca
);

ALTER TABLE usuarios
    MODIFY COLUMN tipo ENUM('cliente', 'equipe') NOT NULL DEFAULT 'cliente',
    ADD CONSTRAINT ck_usuarios_marca_equipe CHECK (tipo = 'equipe' OR pode_gerenciar_equipe = FALSE);
