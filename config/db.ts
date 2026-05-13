import sql from 'mssql';
import { loadEnv } from './loadEnv.js';

loadEnv();

const DEFAULT_DB_TIMEOUT_MS = 30000;

const toPositiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const dbConnectionTimeout = toPositiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, DEFAULT_DB_TIMEOUT_MS);
const dbRequestTimeout = toPositiveInt(process.env.DB_REQUEST_TIMEOUT_MS, DEFAULT_DB_TIMEOUT_MS);
const trustServerCertificate = process.env.DB_TRUST_SERVER_CERTIFICATE === 'true';
type SafeDbHost = string & { readonly __safeDbHost: unique symbol };
type SafeDbName = string & { readonly __safeDbName: unique symbol };

const getAllowedDbHostSuffixes = (): string[] => String(process.env.DB_ALLOWED_HOST_SUFFIXES ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const toSafeDbHost = (value: string | undefined): SafeDbHost => {
    const host = String(value ?? '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(host)) {
        throw new Error('Invalid DB_SERVER format');
    }

    const normalized = host.toLowerCase();
    const allowedSuffixes = getAllowedDbHostSuffixes();
    if (allowedSuffixes.length > 0 && !allowedSuffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))) {
        throw new Error('DB_SERVER host is not allowed');
    }

    return host as SafeDbHost;
};

const toSafeDbName = (value: string | undefined): SafeDbName => {
    const database = String(value ?? '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(database)) {
        throw new Error('Invalid DB_DATABASE format');
    }
    return database as SafeDbName;
};

const dbServer = toSafeDbHost(process.env.DB_SERVER);
const dbDatabase = toSafeDbName(process.env.DB_DATABASE);
const dbPort = toPositiveInt(process.env.DB_PORT, 1433);

if (dbPort > 65535) {
    throw new Error('Invalid DB_PORT format');
}

const config: sql.config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: dbServer,
    database: dbDatabase,
    port: dbPort,
    pool: {
        max: 20,
        min: 0,
        idleTimeoutMillis: DEFAULT_DB_TIMEOUT_MS // Prevent silent TCP connection drops
    },
    connectionTimeout: dbConnectionTimeout,
    requestTimeout: dbRequestTimeout,
    options: {
        encrypt: true,
        trustServerCertificate
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
