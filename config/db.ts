import sql from 'mssql';
import { loadEnv } from './loadEnv.js';

loadEnv();

const toPositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const dbConnectionTimeout = toPositiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, 30000);
const dbRequestTimeout = toPositiveInt(process.env.DB_REQUEST_TIMEOUT_MS, 30000);

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
    connectionTimeout: dbConnectionTimeout,
    requestTimeout: dbRequestTimeout,
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
