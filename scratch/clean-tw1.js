const { poolPromise } = require('./backend/config/db');

async function clean() {
  const pool = await poolPromise;
  await pool.request().query(`
    DELETE FROM RestaurantOrderDetailCur WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE Tableno = 'TW1');
    DELETE FROM RestaurantOrderCur WHERE Tableno = 'TW1';
    DELETE FROM SettlementDetail WHERE SettlementID IN (SELECT SettlementID FROM SettlementHeader WHERE Tableno = 'TW1');
    DELETE FROM SettlementHeader WHERE Tableno = 'TW1';
    UPDATE TableMaster SET Status = 0, CurrentOrderId = NULL, PAYMENT_STATUS = 0, StartTime = NULL WHERE TableNumber = 'TW1';
  `);
  console.log('✅ Cleanup successful for TW1');
  process.exit(0);
}

clean().catch(err => {
  console.error(err);
  process.exit(1);
});
