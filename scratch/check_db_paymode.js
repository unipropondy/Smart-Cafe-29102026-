const { poolPromise } = require('../backend/config/db');

async function check() {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Paymode'");
    console.log('Paymode columns:', res.recordset);
    const paymodes = await pool.request().query('SELECT * FROM Paymode');
    console.log('Current paymodes:', paymodes.recordset);
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

check();
