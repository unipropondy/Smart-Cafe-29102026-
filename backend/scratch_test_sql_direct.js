const { poolPromise } = require("./config/db");

async function testSql() {
  const pool = await poolPromise;
  
  const fDate = '2026-09-29';
  const tDate = '2026-09-29';
  const dateFilter = `CAST(COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE)) AS DATE) BETWEEN CAST('${fDate}' AS DATE) AND CAST('${tDate}' AS DATE)`;

  const query = `
    SELECT
      ISNULL(SUM(sh.SubTotal),0) AS SubTotal,
      ISNULL(SUM(sh.DiscountAmount),0) AS DiscountAmount,
      ISNULL(SUM(sh.ServiceCharge),0) AS ServiceCharge,
      ISNULL(SUM(sh.TakeawayCharge),0) AS TakeawayCharge,
      ISNULL(SUM(sh.TotalTax),0) AS TotalTax,
      ISNULL(SUM(sh.RoundedBy),0) AS RoundedBy,
      COUNT(sh.SettlementID) AS InvoiceCount,
      ISNULL(SUM(sh.SysAmount),0) AS NetTotal
    FROM SettlementHeader sh
    WHERE (sh.IsCancelled = 0 OR sh.IsCancelled IS NULL)
      AND ${dateFilter}
  `;

  const result = await pool.request().query(query);
  console.log("Settlement Header Total Sales output:");
  console.log(result.recordset[0]);
  process.exit(0);
}

testSql().catch(console.error);
