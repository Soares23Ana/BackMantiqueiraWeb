-- ===================================================
-- Mantiqueira Distribuidora - instalação nova do banco
-- ARQUIVO GERADO por "npm run schema:gerar" a partir de migrations/. Não edite à mão.
-- Para bancos existentes, use "npm run migrar".
-- Dados de exemplo ficam em seeds/ (ver README).
-- ===================================================

CREATE DATABASE IF NOT EXISTS mantiqueira_db CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE mantiqueira_db;

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `schema_migrations` (
  `versao` varchar(20) NOT NULL,
  `nome` varchar(200) NOT NULL,
  `checksum` char(64) NOT NULL,
  `aplicado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `duracao_ms` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`versao`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `categorias` (
  `id_categoria` int NOT NULL AUTO_INCREMENT,
  `nome` varchar(100) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `ordem` int NOT NULL DEFAULT '0',
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_categoria`),
  UNIQUE KEY `uk_categorias_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `enderecos` (
  `id_endereco` int NOT NULL AUTO_INCREMENT,
  `id_usuario` int NOT NULL,
  `cep` varchar(9) NOT NULL,
  `logradouro` varchar(150) NOT NULL,
  `numero` varchar(20) NOT NULL,
  `complemento` varchar(100) DEFAULT NULL,
  `bairro` varchar(100) NOT NULL,
  `cidade` varchar(100) NOT NULL,
  `estado` char(2) NOT NULL,
  `referencia` varchar(200) DEFAULT NULL,
  `principal` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id_endereco`),
  KEY `fk_enderecos_usuario` (`id_usuario`),
  CONSTRAINT `fk_enderecos_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `fornecedores` (
  `id_fornecedor` int NOT NULL AUTO_INCREMENT,
  `nome_fantasia` varchar(100) NOT NULL,
  `cnpj` varchar(18) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id_fornecedor`),
  UNIQUE KEY `cnpj` (`cnpj`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `itens_pedido` (
  `id_pedido` int NOT NULL,
  `id_produto` int NOT NULL,
  `quantidade` int NOT NULL,
  PRIMARY KEY (`id_pedido`,`id_produto`),
  KEY `fk_itens_produto` (`id_produto`),
  CONSTRAINT `fk_itens_pedido` FOREIGN KEY (`id_pedido`) REFERENCES `pedidos` (`id_pedido`) ON DELETE CASCADE,
  CONSTRAINT `fk_itens_produto` FOREIGN KEY (`id_produto`) REFERENCES `produtos` (`id_produto`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `marcas` (
  `id_marca` int NOT NULL AUTO_INCREMENT,
  `nome` varchar(100) NOT NULL,
  `slug` varchar(120) NOT NULL,
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_marca`),
  UNIQUE KEY `uk_marcas_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `movimentacoes_estoque` (
  `id_movimentacao` int NOT NULL AUTO_INCREMENT,
  `id_produto` int NOT NULL,
  `tipo` enum('ajuste','pedido','cancelamento','importacao') NOT NULL,
  `quantidade` int NOT NULL,
  `estoque_anterior` int NOT NULL,
  `estoque_novo` int NOT NULL,
  `observacao` varchar(500) DEFAULT NULL,
  `id_usuario` int DEFAULT NULL,
  `id_pedido` int DEFAULT NULL,
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_movimentacao`),
  KEY `idx_movimentacoes_produto` (`id_produto`,`criado_em`),
  KEY `fk_movimentacoes_usuario` (`id_usuario`),
  KEY `fk_movimentacoes_pedido` (`id_pedido`),
  CONSTRAINT `fk_movimentacoes_pedido` FOREIGN KEY (`id_pedido`) REFERENCES `pedidos` (`id_pedido`) ON DELETE SET NULL,
  CONSTRAINT `fk_movimentacoes_produto` FOREIGN KEY (`id_produto`) REFERENCES `produtos` (`id_produto`),
  CONSTRAINT `fk_movimentacoes_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `produtos` (
  `id_produto` int NOT NULL AUTO_INCREMENT,
  `sku` varchar(40) NOT NULL,
  `id_fornecedor` int DEFAULT NULL,
  `id_categoria` int DEFAULT NULL,
  `id_marca` int DEFAULT NULL,
  `nome` varchar(150) NOT NULL,
  `descricao` text,
  `destaques` json DEFAULT NULL,
  `imagem_url` varchar(2048) DEFAULT NULL,
  `preco` decimal(10,2) DEFAULT NULL,
  `quantidade_estoque` int NOT NULL DEFAULT '0',
  `estoque_minimo` int NOT NULL DEFAULT '10',
  `multiplo_venda` int NOT NULL DEFAULT '1',
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_produto`),
  UNIQUE KEY `uk_produtos_sku` (`sku`),
  KEY `fk_produtos_fornecedor` (`id_fornecedor`),
  KEY `idx_produtos_ativo_nome` (`ativo`,`nome`),
  KEY `fk_produtos_categoria` (`id_categoria`),
  KEY `fk_produtos_marca` (`id_marca`),
  CONSTRAINT `fk_produtos_categoria` FOREIGN KEY (`id_categoria`) REFERENCES `categorias` (`id_categoria`) ON DELETE SET NULL,
  CONSTRAINT `fk_produtos_fornecedor` FOREIGN KEY (`id_fornecedor`) REFERENCES `fornecedores` (`id_fornecedor`) ON DELETE SET NULL,
  CONSTRAINT `fk_produtos_marca` FOREIGN KEY (`id_marca`) REFERENCES `marcas` (`id_marca`) ON DELETE SET NULL,
  CONSTRAINT `ck_produtos_estoque` CHECK ((`quantidade_estoque` >= 0)),
  CONSTRAINT `ck_produtos_estoque_minimo` CHECK ((`estoque_minimo` >= 0)),
  CONSTRAINT `ck_produtos_multiplo` CHECK ((`multiplo_venda` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `blocos_cms` (
  `id_bloco` int NOT NULL AUTO_INCREMENT,
  `chave` varchar(60) NOT NULL,
  `titulo` varchar(150) DEFAULT NULL,
  `conteudo` text NOT NULL,
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_bloco`),
  UNIQUE KEY `uk_blocos_chave` (`chave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `campanhas` (
  `id_campanha` int NOT NULL AUTO_INCREMENT,
  `titulo` varchar(120) NOT NULL,
  `selo` varchar(40) DEFAULT NULL,
  `inicio_em` datetime NOT NULL,
  `fim_em` datetime NOT NULL,
  `id_usuario` int DEFAULT NULL,
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_campanha`),
  KEY `idx_campanhas_periodo` (`inicio_em`,`fim_em`),
  KEY `fk_campanhas_usuario` (`id_usuario`),
  CONSTRAINT `fk_campanhas_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL,
  CONSTRAINT `ck_campanhas_periodo` CHECK ((`fim_em` > `inicio_em`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `configuracoes` (
  `chave` varchar(60) NOT NULL,
  `valor` text,
  `publica` tinyint(1) NOT NULL DEFAULT '0',
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `id_usuario` int DEFAULT NULL,
  PRIMARY KEY (`chave`),
  KEY `fk_configuracoes_usuario` (`id_usuario`),
  CONSTRAINT `fk_configuracoes_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `conteudo_cms` (
  `id_banner` int NOT NULL AUTO_INCREMENT,
  `titulo` varchar(150) NOT NULL,
  `link` varchar(2048) DEFAULT NULL,
  `imagem_url` varchar(2048) NOT NULL,
  `ordem` int NOT NULL DEFAULT '0',
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `inicio_em` datetime DEFAULT NULL,
  `fim_em` datetime DEFAULT NULL,
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_banner`),
  KEY `idx_banners_exibicao` (`ativo`,`ordem`),
  CONSTRAINT `ck_banners_janela` CHECK (((`inicio_em` is null) or (`fim_em` is null) or (`fim_em` > `inicio_em`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pedido_historico` (
  `id_historico` int NOT NULL AUTO_INCREMENT,
  `id_pedido` int NOT NULL,
  `status_anterior` enum('Aguardando Separação','Em Separação','Saiu para Entrega','Entregue','Cancelado') DEFAULT NULL,
  `status_novo` enum('Aguardando Separação','Em Separação','Saiu para Entrega','Entregue','Cancelado') NOT NULL,
  `id_usuario` int DEFAULT NULL,
  `observacao` varchar(500) DEFAULT NULL,
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_historico`),
  KEY `idx_historico_pedido` (`id_pedido`,`criado_em`),
  KEY `fk_historico_usuario` (`id_usuario`),
  CONSTRAINT `fk_historico_pedido` FOREIGN KEY (`id_pedido`) REFERENCES `pedidos` (`id_pedido`) ON DELETE CASCADE,
  CONSTRAINT `fk_historico_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `sincronizacoes_log` (
  `id_sincronizacao` int NOT NULL AUTO_INCREMENT,
  `tipo` enum('importacao_manual','carga_completa','estoque') NOT NULL,
  `origem` varchar(255) NOT NULL,
  `simulado` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('em_andamento','sucesso','parcial','falha') NOT NULL DEFAULT 'em_andamento',
  `linhas` int NOT NULL DEFAULT '0',
  `criados` int NOT NULL DEFAULT '0',
  `atualizados` int NOT NULL DEFAULT '0',
  `inalterados` int NOT NULL DEFAULT '0',
  `desativados` int NOT NULL DEFAULT '0',
  `com_erro` int NOT NULL DEFAULT '0',
  `movimentacoes_estoque` int NOT NULL DEFAULT '0',
  `relatorio` json DEFAULT NULL,
  `mensagem` varchar(500) DEFAULT NULL,
  `id_usuario` int DEFAULT NULL,
  `iniciado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finalizado_em` datetime DEFAULT NULL,
  `duracao_ms` int DEFAULT NULL,
  PRIMARY KEY (`id_sincronizacao`),
  KEY `idx_sincronizacoes_tipo_data` (`tipo`,`iniciado_em`),
  KEY `fk_sincronizacoes_usuario` (`id_usuario`),
  CONSTRAINT `fk_sincronizacoes_usuario` FOREIGN KEY (`id_usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `campanhas_produtos` (
  `id_campanha` int NOT NULL,
  `id_produto` int NOT NULL,
  PRIMARY KEY (`id_campanha`,`id_produto`),
  KEY `idx_campanhas_produtos_produto` (`id_produto`),
  CONSTRAINT `fk_campanhas_produtos_campanha` FOREIGN KEY (`id_campanha`) REFERENCES `campanhas` (`id_campanha`) ON DELETE CASCADE,
  CONSTRAINT `fk_campanhas_produtos_produto` FOREIGN KEY (`id_produto`) REFERENCES `produtos` (`id_produto`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `eventos` (
  `id_evento` bigint NOT NULL AUTO_INCREMENT,
  `tipo` enum('busca','busca_sem_resultado','produto_visto','carrinho_adicionar','checkout_iniciado','pedido_concluido','banner_clique','campanha_clique') NOT NULL,
  `id_usuario` int DEFAULT NULL,
  `sessao` varchar(64) DEFAULT NULL,
  `termo` varchar(100) DEFAULT NULL,
  `resultados` int DEFAULT NULL,
  `id_produto` int DEFAULT NULL,
  `quantidade` int DEFAULT NULL,
  `id_pedido` int DEFAULT NULL,
  `id_banner` int DEFAULT NULL,
  `id_campanha` int DEFAULT NULL,
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_evento`),
  KEY `idx_eventos_tipo_data` (`tipo`,`criado_em`),
  KEY `idx_eventos_data` (`criado_em`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pedidos` (
  `id_pedido` int NOT NULL AUTO_INCREMENT,
  `id_cliente` int NOT NULL,
  `chave_idempotencia` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `id_funcionario` int DEFAULT NULL,
  `id_endereco` int DEFAULT NULL,
  `endereco_entrega` json DEFAULT NULL,
  `observacao` varchar(500) DEFAULT NULL,
  `data_pedido` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `data_entrega_desejada` date DEFAULT NULL,
  `data_entrega` datetime DEFAULT NULL,
  `status` enum('Aguardando Separação','Em Separação','Saiu para Entrega','Entregue','Cancelado') NOT NULL DEFAULT 'Aguardando Separação',
  `motivo_cancelamento` varchar(500) DEFAULT NULL,
  `atualizado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_pedido`),
  UNIQUE KEY `uq_pedidos_cliente_chave` (`id_cliente`,`chave_idempotencia`),
  KEY `fk_pedidos_funcionario` (`id_funcionario`),
  KEY `idx_pedidos_status_data` (`status`,`data_pedido`),
  KEY `idx_pedidos_cliente_data` (`id_cliente`,`data_pedido`),
  KEY `fk_pedidos_endereco` (`id_endereco`),
  CONSTRAINT `fk_pedidos_cliente` FOREIGN KEY (`id_cliente`) REFERENCES `usuarios` (`id_usuario`),
  CONSTRAINT `fk_pedidos_endereco` FOREIGN KEY (`id_endereco`) REFERENCES `enderecos` (`id_endereco`) ON DELETE SET NULL,
  CONSTRAINT `fk_pedidos_funcionario` FOREIGN KEY (`id_funcionario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `usuarios` (
  `id_usuario` int NOT NULL AUTO_INCREMENT,
  `nome` varchar(100) NOT NULL,
  `razao_social` varchar(150) DEFAULT NULL,
  `email` varchar(100) NOT NULL,
  `senha` varchar(255) NOT NULL,
  `senha_alterada_em` datetime DEFAULT NULL,
  `cnpj` varchar(14) DEFAULT NULL,
  `cnpj_original` varchar(18) DEFAULT NULL,
  `telefone` varchar(20) DEFAULT NULL,
  `tipo` enum('cliente','equipe') NOT NULL DEFAULT 'cliente',
  `pode_gerenciar_equipe` tinyint(1) NOT NULL DEFAULT '0',
  `ativo` tinyint(1) NOT NULL DEFAULT '1',
  `cargo` varchar(50) DEFAULT NULL,
  `criado_em` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_usuario`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `uk_usuarios_cnpj` (`cnpj`),
  CONSTRAINT `ck_usuarios_cnpj` CHECK (((`cnpj` is null) or regexp_like(`cnpj`,_utf8mb4'^[0-9]{14}$'))),
  CONSTRAINT `ck_usuarios_marca_equipe` CHECK (((`tipo` = _utf8mb4'equipe') or (`pode_gerenciar_equipe` = false)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- Marca as migrations como aplicadas para que "npm run migrar" continue a partir daqui.
INSERT INTO schema_migrations (versao, nome, checksum) VALUES
('001', 'estrutura_base', 'cd0cc3e155651a44ece0755cd0a9200850feb1ea2f269166201a174ffd55a95b'),
('002', 'normalizar_estrutura', '84f0ff32e8c849f2995d050734ffde5fcea6c0224957bc36889377a44d8fcad9'),
('003', 'catalogo', 'dbbb60290a47a4ab6b6f3790a1dc2e0d5fdc0c077815a004b1b3c2783f5c5c56'),
('004', 'autenticacao_b2b', '88bd98595b6de344c817744c8a4710dea2c23fd93668edbc695a7b8819cd5069'),
('005', 'coluna_cnpj', '8a5d7ba4d1f2eb61684c6c6fade49369744d812d0d943c34621ff3d5b024ca9f'),
('006', 'pedidos', 'd1399aba1a98f090112b3989aa9bee2a1e0dd18b65da23fb92324388099c15da'),
('007', 'perfis_cliente_equipe', 'ece3b96f65fab70c24ab937552b739d59f63c48876995f34a795b3ca7fdf72b2'),
('008', 'operacao', '6782d706ec5d18105f84e7daf60553c1cef6107bd5e106400cceb58518547daa'),
('009', 'campanhas', 'd0cf2e273a5be6c2060402809c19bdaa4e94649b8200f56d11a26129488c5f5b'),
('010', 'eventos', 'cd242ad5fd578e83c32f28c87b0790e60ae8f7c3c0c2c623f87936227c3b002c'),
('011', 'idempotencia_pedidos', '14d036b1423cd701d659bf5829f194403767a23d8494e27c4c14618cf8d11852'),
('012', 'senha_alterada_em', 'eb3b1c6617b4f579775cbef86417acbecd6c01b44d29b897a94d1a9d04dc9a15');
