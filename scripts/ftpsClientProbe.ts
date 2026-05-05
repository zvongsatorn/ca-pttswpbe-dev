import { Client } from 'basic-ftp';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { poolPromise, sql } from '../config/db.js';

type ConfigKey =
    | 'SendToSAP_username'
    | 'SendToSAP_password'
    | 'SendToSAP_hostip'
    | 'SendToSAP_port'
    | 'SendToSAP_remotefile';

const toText = (value: unknown): string => String(value ?? '').trim();

const getConfigValue = async (keyName: ConfigKey): Promise<string> => {
    const pool = await poolPromise;
    const request = new sql.Request(pool);
    request.input('KeyName', sql.NVarChar(200), keyName);
    const result = await request.execute('MP_ConfigGetByKeyName');
    const row = (result.recordset || [])[0] as Record<string, unknown> | undefined;
    return toText(row?.Value1);
};

const normalizeHost = (value: string): { host: string; scheme: 'ftp' | 'ftps' | null } => {
    const trimmed = toText(value);
    if (!trimmed) return { host: '', scheme: null };

    if (/^ftps:\/\//i.test(trimmed)) {
        return {
            host: trimmed.replace(/^ftps:\/\//i, '').replace(/\/+$/, ''),
            scheme: 'ftps'
        };
    }

    if (/^ftp:\/\//i.test(trimmed)) {
        return {
            host: trimmed.replace(/^ftp:\/\//i, '').replace(/\/+$/, ''),
            scheme: 'ftp'
        };
    }

    return { host: trimmed.replace(/\/+$/, ''), scheme: null };
};

const resolveRemoteDir = (remoteFile: string): string => {
    const fromEnv = toText(process.env.FTPS_TEST_REMOTE_DIR);
    if (fromEnv) return fromEnv.startsWith('/') ? fromEnv : `/${fromEnv}`;
    const parsed = path.posix.dirname(remoteFile || '/PTT-WorkforceManagement_Test/Outbound/Input_ZHROMI040.txt');
    return parsed.startsWith('/') ? parsed : `/${parsed}`;
};

const shouldDeleteAfterTest = (): boolean => {
    const value = toText(process.env.FTPS_TEST_DELETE_AFTER).toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'y';
};

const run = async () => {
    const username = await getConfigValue('SendToSAP_username');
    const password = await getConfigValue('SendToSAP_password');
    const hostConfig = await getConfigValue('SendToSAP_hostip');
    const portConfig = await getConfigValue('SendToSAP_port');
    const remoteFile = await getConfigValue('SendToSAP_remotefile');

    if (!username || !password || !hostConfig) {
        throw new Error('Missing SendToSAP config values in database.');
    }

    const { host, scheme } = normalizeHost(hostConfig);
    const port = Number.parseInt(portConfig, 10) || 990;
    const secureMode: boolean | 'implicit' = scheme === 'ftps' || port === 990 ? 'implicit' : true;
    const remoteDir = resolveRemoteDir(remoteFile);
    const fileName = `basic-ftp-test-${Date.now()}.txt`;
    const localPath = path.join(os.tmpdir(), fileName);
    const downloadedPath = path.join(os.tmpdir(), `${fileName}.downloaded`);
    const remotePath = path.posix.join(remoteDir, fileName);
    const payload = `basic-ftp probe ${new Date().toISOString()}\n`;

    await fs.writeFile(localPath, payload, 'utf8');

    const client = new Client(30_000);
    client.ftp.verbose = false;

    console.log('[FTPS Test] Connecting...');
    console.log(`[FTPS Test] host=${host} port=${port} secure=${secureMode}`);
    console.log(`[FTPS Test] remoteDir=${remoteDir}`);
    console.log(`[FTPS Test] remotePath=${remotePath}`);

    try {
        const allowInsecureTls = process.env.FTPS_TEST_ALLOW_INSECURE_TLS === 'true';

        await client.access({
            host,
            port,
            user: username,
            password,
            secure: secureMode,
            secureOptions: {
                rejectUnauthorized: !allowInsecureTls
            }
        });

        await client.cd(remoteDir);
        await client.uploadFrom(localPath, fileName);
        console.log('[FTPS Test] Upload complete.');

        const uploadedSize = await client.size(fileName);
        await client.downloadTo(downloadedPath, fileName);
        const downloadedContent = await fs.readFile(downloadedPath, 'utf8');

        console.log(`[FTPS Test] Uploaded size: ${uploadedSize} bytes`);
        console.log(`[FTPS Test] Downloaded content: ${JSON.stringify(downloadedContent)}`);
        console.log(`[FTPS Test] SUCCESS: npm FTPS client is working.`);

        if (shouldDeleteAfterTest()) {
            await client.remove(fileName);
            console.log('[FTPS Test] Deleted remote test file (FTPS_TEST_DELETE_AFTER=true).');
        } else {
            console.log('[FTPS Test] Remote test file kept for inspection.');
        }
    } finally {
        client.close();
        await fs.rm(localPath, { force: true });
        await fs.rm(downloadedPath, { force: true });
    }
};

run().catch((error) => {
    console.error('[FTPS Test] FAILED:', error);
    process.exit(1);
}).finally(async () => {
    try {
        const pool = await poolPromise;
        await pool.close();
    } catch {
        // ignore close errors for probe script
    }
});
