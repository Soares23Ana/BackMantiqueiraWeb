const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '29181407',
    database: 'mantiqueira_db'
});

module.exports = pool.promise();