// requerer a model do User
const User = require('../models/Users')
// requer a bibliote bcrypt
const bcrypt = require('bcrypt')

module.exports = class UserController {
    
    static async register(req, res) {
        const {name, email, password, image, phone} = req.body

        // criptografar a senha
        const salt = await bcrypt.genSalt(12)
        const passwordHash = await bcrypt.hash(password, salt)

        // criar o novo usuario
        try {
            await User.create({
                name: name,
                email: email,
                password: passwordHash,
                phone: phone
            })
            res.status(200).json({message: 'Usuario cadastrado com sucesso'})
        } catch (error) {
            res.status(500).json({message: error})
        }
    }

    // metodo para listar todos os usuarios
    static async listAll(req, res) {
        try {
            const users = await User.findAll()
            res.status(200).json({users})
        } catch (error) {
            res.status(500).json({error: error})
        }
    }

    // Rota inicial para testar se a API está respondendo
    static async ping(req, res) {
        res.status(200).json({ 
            message: "API do projeto Pet Get está funcionando perfeitamente!" 
        });
    }

}