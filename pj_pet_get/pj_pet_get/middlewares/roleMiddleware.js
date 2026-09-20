// Recebe um array de cargos permitidos (ex: ['admin', 'gerente'])
const checkRole = (cargosPermitidos) => {
    return (req, res, next) => {
        // req.usuario é injetado pelo seu authMiddleware após validar o JWT
        if (!req.usuario || !cargosPermitidos.includes(req.usuario.tipo)) {
            return res.status(403).json({ 
                mensagem: "Acesso negado: Não tem permissão para realizar esta operação." 
            });
        }
        next();
    };
};

module.exports = checkRole;