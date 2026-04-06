import sql from 'mssql';
import { loadEnv } from './loadEnv.js';

loadEnv();

const config: sql.config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER!,
    database: process.env.DB_DATABASE!,
    port: parseInt(process.env.DB_PORT || '1433', 10),
    pool: {
        max: 20,
        min: 0,
        idleTimeoutMillis: 30000 // Prevent silent TCP connection drops
    },
    connectionTimeout: 30000, // 30s instead of default 15s
    requestTimeout: 30000,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('Connected to Database');
        return pool;
    })
    .catch(err => {
        console.error('Database Connection Failed! Bad Config: ', err);
        throw err;
    });

export { sql, poolPromise };
