const { poolPromise } = require('../backend/config/db');

async function cleanup() {
  const pool = await poolPromise;
  await pool.request().query("UPDATE RestaurantOrderCur SET isOrderClosed = 1 WHERE OrderNumber = '20261016-0003'");
  await pool.request().query("UPDATE TableMaster SET Status = 0, entry_status = NULL, PAYMENT_STATUS = NULL, CurrentOrderId = NULL, TotalAmount = 0 WHERE TableNumber = 'TW1'");
  console.log('✅ Cleaned up test order and reset Table TW1.');
  process.exit(0);
}

cleanup();
