const { poolPromise, sql } = require('../backend/config/db');

(async () => {
  const pool = await poolPromise;
  const res = await pool.request().query(`
    SELECT TableId, TableNumber, DiningSection, Status, entry_status, PAYMENT_STATUS, CustomerName, StartTime, ModifiedOn, LockedByName, CurrentOrderId, TotalAmount
    FROM TableMaster 
    WHERE TableNumber IN ('TW1', 'TW2')
    ORDER BY TableNumber
  `);
  console.table(res.recordset);

  const tid = res.recordset[0]?.TableId;
  const tno = res.recordset[0]?.TableNumber;

  const allTables = await pool.request().query(`
    SELECT TableNumber, Status, entry_status, PAYMENT_STATUS, CustomerName, CurrentOrderId, TotalAmount
    FROM TableMaster 
    WHERE DiningSection = '4' AND TableNumber LIKE 'TW[0-9]%'
    ORDER BY CAST(REPLACE(TableNumber, 'TW', '') AS INT)
  `);
  console.table(allTables.recordset);
  const occupied = allTables.recordset.filter(t => t.Status !== 0);
  console.log(`Audit Summary: Total TW tables: ${allTables.recordset.length}, Occupied: ${occupied.length}`);
  if (occupied.length === 0) {
    console.log("✅ All takeaway tables (TW1 through TW20) are completely available and clean (Status = 0).");
  } else {
    console.log("Occupied tables:", occupied);
  }
  process.exit(0);
})();
