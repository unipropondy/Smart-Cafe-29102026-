const { poolPromise } = require('../backend/config/db');

(async () => {
    const pool = await poolPromise;
    const roc = await pool.request().query(`
        SELECT TOP 20 OrderId, OrderNumber, Tableno, StatusCode, isOrderClosed, TotalAmount, CreatedOn
        FROM RestaurantOrderCur
        WHERE Tableno LIKE 'TW%'
        ORDER BY CreatedOn DESC
    `);
    console.log('RestaurantOrderCur for TW:');
    console.table(roc.recordset);

    const tables = await pool.request().query(`
        SELECT TableNumber, Status, entry_status, PAYMENT_STATUS, CustomerName, StartTime, ModifiedOn, LockedByName, CurrentOrderId, TotalAmount
        FROM TableMaster
        WHERE DiningSection = '4' AND TableNumber LIKE 'TW[0-9]%'
        ORDER BY CAST(REPLACE(TableNumber, 'TW', '') AS INT)
    `);
    console.log('TableMaster TW:');
    console.table(tables.recordset);

    process.exit(0);
})();
