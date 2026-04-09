import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

import { sql, poolPromise } from './config/db.js';

async function run() {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT ApproveHistID, ApproveID, RefID, Seqno, ApproveHistStatus, ApproveHistBy FROM MP_ApproveHist WHERE RefID = 403");
        console.table(result.recordset);
    } catch (e) { console.error(e); }
    process.exit(0);
}
run();
