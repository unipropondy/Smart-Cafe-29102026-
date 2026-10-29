const { poolPromise } = require("./config/db");

async function checkDetails() {
  try {
    const pool = await poolPromise;
    const ids = [
      'B97A41E6-540F-4343-93DE-6878C899A019',
      '85366B1D-85D2-477A-ABA1-4543E5F774A3',
      '4C243781-F36D-4743-90C6-DECE6B62B20E'
    ].map(id => `'${id}'`).join(',');
    
    console.log("=== SettlementDetail ===");
    const detailRes = await pool.request().query(`SELECT * FROM SettlementDetail WHERE SettlementId IN (${ids})`);
    console.dir(detailRes.recordset, { depth: null });

    console.log("\n=== SettlementTotalSales ===");
    const salesRes = await pool.request().query(`SELECT * FROM SettlementTotalSales WHERE SettlementID IN (${ids})`);
    console.dir(salesRes.recordset, { depth: null });

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkDetails();
