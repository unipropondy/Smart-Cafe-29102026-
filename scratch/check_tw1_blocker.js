const { poolPromise } = require('../backend/config/db');

(async () => {
    const pool = await poolPromise;
    const res = await pool.request().query(`
        SELECT tm.TableNumber, tm.Status, tm.entry_status, tm.StartTime, tm.ModifiedOn, tm.CurrentOrderId,
               (SELECT COUNT(*) FROM RestaurantOrderCur roc WHERE RTRIM(LTRIM(roc.Tableno)) = RTRIM(LTRIM(tm.TableNumber)) AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)) as OpenOrders,
               (SELECT COUNT(*) FROM CartItems ci WHERE ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber) as CartItems
        FROM TableMaster tm
        WHERE tm.TableNumber IN ('TW1', 'TW2', 'TW3')
    `);
    console.table(res.recordset);

    const carts = await pool.request().query("SELECT * FROM CartItems WHERE CartId LIKE '%TW%' OR CartId IN (SELECT CAST(TableId AS NVARCHAR(128)) FROM TableMaster WHERE DiningSection = '4')");
    console.log('Cart items for TW:');
    console.table(carts.recordset);

    const orders = await pool.request().query("SELECT OrderId, OrderNumber, Tableno, isOrderClosed, TotalAmount FROM RestaurantOrderCur WHERE Tableno IN ('TW1', 'TW2', 'TW3') AND (isOrderClosed = 0 OR isOrderClosed IS NULL)");
    console.log('Open orders for TW1/TW2/TW3:');
    console.table(orders.recordset);

    process.exit(0);
})();
