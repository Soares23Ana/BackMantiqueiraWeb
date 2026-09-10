const express = require('express');
const app = express();
const rotasProdutos = require('./routes/produtos');

app.use(express.json());

// Configurando a rota principal de produtos
app.use('/produtos', rotasProdutos);

app.listen(3000, () => {
    console.log('API da Mantiqueira rodando na porta 3000!');
});