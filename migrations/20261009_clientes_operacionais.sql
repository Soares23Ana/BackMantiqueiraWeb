-- Execute uma vez em bancos existentes criados com a versão anterior do esquema.
ALTER TABLE usuarios
    CHANGE COLUMN cpf_cnpj cnpj_cpf VARCHAR(18) NULL,
    ADD COLUMN razao_social VARCHAR(150) NULL;

UPDATE usuarios
SET razao_social = nome
WHERE tipo = 'cliente' AND razao_social IS NULL;

CREATE TABLE IF NOT EXISTS enderecos (
    id_endereco INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    cep VARCHAR(9) NOT NULL,
    logradouro VARCHAR(150) NOT NULL,
    numero VARCHAR(20) NOT NULL,
    complemento VARCHAR(100),
    bairro VARCHAR(100) NOT NULL,
    cidade VARCHAR(100) NOT NULL,
    estado CHAR(2) NOT NULL,
    referencia VARCHAR(200),
    principal BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
);

ALTER TABLE pedidos
    ADD COLUMN data_entrega DATETIME NULL;
