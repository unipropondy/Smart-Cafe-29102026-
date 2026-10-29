const path = require('path');
const { poolPromise } = require(path.resolve('./backend/config/db'));

async function check() {
  const pool = await poolPromise;
  const orders = await pool.request().query(`
    SELECT OrderId, OrderNumber, Tableno, TotalAmount, isOrderClosed, CreatedOn
    FROM RestaurantOrderCur 
    WHERE OrderNumber LIKE '%20261016-0006%' OR OrderNumber LIKE '%20261016-0007%'
    ORDER BY CreatedOn DESC
  `);
  console.log('--- Orders 0006 & 0007 ---');
  console.log(orders.recordset);

  // Check columns of SettlementHeader
  const cols = await pool.request().query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SettlementHeader'
  `);
  console.log('--- SettlementHeader Columns ---', cols.recordset.map(c => c.COLUMN_NAME).join(', '));

  // Check TableMaster for TW1 and TW2
  const tables = await pool.request().query(`
    SELECT TableNumber, TableId, Status, CurrentOrderId, PAYMENT_STATUS, DiningSection, entry_status, StartTime, ModifiedOn 
    FROM TableMaster 
    WHERE TableNumber IN ('TW1', 'TW2')
  `);
  console.log('--- TableMaster ---');
  console.log(tables.recordset);

  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
