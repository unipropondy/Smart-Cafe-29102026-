const { poolPromise } = require("../backend/config/db.js");

async function check() {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        sh.BillNo,
        sts.PayMode,
        sts.SysAmount as sts_SysAmount,
        sh.SysAmount as sh_SysAmount
      FROM SettlementHeader sh
      LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
      INNER JOIN RestaurantInvoiceCur ric ON sh.SettlementID = ric.RestaurantBillId
      WHERE ric.start_date = '2026-08-28' AND (sh.IsCancelled = 0 OR sh.IsCancelled IS NULL)
    `);
    console.log("SettlementTotalSales rows:", result.recordset);
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

check();
