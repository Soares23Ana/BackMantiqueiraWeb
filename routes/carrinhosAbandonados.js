const express = require('express');
const controlador = require('../controllers/carrinhoAbandonadoControlador');
const autenticarToken = require('../middlewares/authMiddleware');
const { exigirEquipe } = require('../middlewares/roleMiddleware');

const router = express.Router();
router.use(autenticarToken, exigirEquipe);

router.get('/', controlador.listar);
router.patch('/:id_cliente/contatado', controlador.registrarContato);

module.exports = router;
