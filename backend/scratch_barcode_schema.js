require('dotenv').config({ path: '.env' });
const { poolPromise } = require('./config/db');

async function run() {
  const pool = await poolPromise;

  // Get columns of BarCodeMaster
  const r1 = await pool.request().query(
    "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'BarCodeMaster' ORDER BY ORDINAL_POSITION"
  );
  console.log('=== BarCodeMaster Columns ===');
  console.table(r1.recordset);

  // Sample rows
  const r2 = await pool.request().query('SELECT TOP 5 * FROM BarCodeMaster');
  console.log('=== Sample Rows ===');
  console.table(r2.recordset);

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
