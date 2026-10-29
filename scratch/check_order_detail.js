const { poolPromise } = require('../backend/config/db');

(async () => {
    const pool = await poolPromise;
    const res = await pool.request().query("SELECT OrderId, OrderNumber, Tableno, isOrderClosed, TotalAmount FROM RestaurantOrderCur WHERE OrderNumber = '20261020-0010'");
    console.log('OrderCur:', res.recordset);
    const sh = await pool.request().query("SELECT BillNo, GrandTotal, SettleDate FROM SettlementHeader WHERE BillNo = '20261020-0010'");
    console.log('SettlementHeader:', sh.recordset);
    process.exit(0);
})();
