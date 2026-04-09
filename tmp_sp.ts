import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

import { sql, poolPromise } from './config/db.js';

async function run() {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("sp_helptext 'mp_ManDriverSendMailNext'");
        console.log(result.recordset.map(r => r.Text).join(''));
    } catch (e) { console.error(e); }
    process.exit(0);
}
run();
