require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');
async function run() {
  try {
    const pool = await sql.connect({
      server: process.env.DB_SERVER,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      options: { encrypt: false, trustServerCertificate: true },
      port: 1433
    });
    const res = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT
      FROM information_schema.columns 
      WHERE table_name = 'MP_DocumentRemark'
    `);
    console.log('Columns:');
    console.table(res.recordset);
    
    const sp = await pool.request().query("EXEC sp_helptext 'mp_DocumentRemarkInsert'");
    console.log('\nSP:');
    console.log(sp.recordset.map(r => r.Text).join(''));
    process.exit(0);
  } catch(e) { console.error(e); process.exit(1); }
}
run();

// Also check MP_TransactionFile
async function checkTransFile() {
  try {
    const pool = await sql.connect({
      server: process.env.DB_SERVER,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      options: { encrypt: false, trustServerCertificate: true },
      port: 1433
    });
    const res = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns WHERE table_name = 'MP_TransactionFile' ORDER BY ORDINAL_POSITION
    `);
    console.table(res.recordset);
    process.exit(0);
  } catch(e) { console.error(e); process.exit(1); }
}
