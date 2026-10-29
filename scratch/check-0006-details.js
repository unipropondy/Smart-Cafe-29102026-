const path = require('path');
const { poolPromise } = require(path.resolve('./backend/config/db'));

async function checkDetails() {
  const pool = await poolPromise;
  const items = await pool.request().query(`
    SELECT OrderDetailId, OrderId, DishId, DishName, Quantity, PricePerUnit, ModifiersJSON, StatusCode, CreatedOn, isTakeAway 
    FROM RestaurantOrderDetailCur 
    WHERE OrderId = '122B86AD-0AB9-4E3E-A599-8E40B663FFF8'
    ORDER BY CreatedOn ASC
  `);
  console.log('--- Order 0006 details ---');
  console.log(items.recordset);

  // Check Settlement for Order 0006
  const settle = await pool.request().query(`
    SELECT SettlementID, OrderId, TableNo, BillNo, SubTotal, TotalTax, TakeawayCharge, RoundBy, SysAmount, CreatedOn 
    FROM SettlementHeader 
    WHERE OrderId = '122B86AD-0AB9-4E3E-A599-8E40B663FFF8' OR TableNo = 'TW1'
  `);
  console.log('--- SettlementHeader for 0006/TW1 ---');
  console.log(settle.recordset);

  // Check SettlementDetail or SettlementItemDetail / SettlementPaymode
  const paymodes = await pool.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'Settlement%'
  `);
  console.log('--- Settlement Tables ---', paymodes.recordset.map(t => t.TABLE_NAME));

  process.exit(0);
}

checkDetails().catch(err => {
  console.error(err);
  process.exit(1);
});
