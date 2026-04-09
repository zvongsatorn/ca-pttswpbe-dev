import dotenv from 'dotenv';
dotenv.config({ path: `.env.local` });

import { sql, poolPromise } from './config/database';

async function run() {
    try {
        const pool = await poolPromise;
        await pool.request().query("UPDATE MP_ApproveHist SET ApproveHistStatus = 0 WHERE RefID = 403 AND Seqno = 0");
        console.log("Reset RefID 403 Seqno 0 to ApproveHistStatus = 0");
    } catch (e) { console.error(e); }
    process.exit(0);
}
run();
