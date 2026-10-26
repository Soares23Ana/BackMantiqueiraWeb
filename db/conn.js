const { Sequelize } = require('sequelize');
const config = require('../config/ambiente');

const sequelize = new Sequelize(config.db.nome, config.db.usuario, config.db.senha, {
    host: config.db.host,
    port: config.db.porta,
    dialect: 'mysql',
    logging: false,
    timezone: config.db.timezone,
    pool: {
        max: config.db.poolMax,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    dialectOptions: {
        connectTimeout: 10000,
        charset: 'utf8mb4'
    }
});

module.exports = sequelize;
