-- Nome original do portfólio (como veio na planilha). O "nome" continua sendo o texto de exibição, gerado a partir
-- dele pelo dicionário config/abreviacoes.json e editável à mão: a importação só troca o "nome" se ele ainda for igual
-- ao que seria gerado do nome_erp anterior.

ALTER TABLE produtos ADD COLUMN nome_erp VARCHAR(255) NULL AFTER nome;
