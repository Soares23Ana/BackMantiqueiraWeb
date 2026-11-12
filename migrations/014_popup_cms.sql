-- Pop-up do site: usa o bloco de conteúdo de chave reservada "popup". Os campos extras (imagem, destino e janela de
-- exibição) ficam em "dados"; título, texto (conteudo) e ativo continuam nas colunas de sempre.

ALTER TABLE blocos_cms ADD COLUMN dados JSON NULL AFTER conteudo;
