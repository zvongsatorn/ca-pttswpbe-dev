import { sql, poolPromise } from './config/db.js';
async function runTest() {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query("SELECT TOP 1 * FROM MP_TransactionFile ORDER BY CreateDate DESC");
        console.log("Last file:", result.recordset);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
runTest();
