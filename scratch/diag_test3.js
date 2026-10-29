const { poolPromise, sql } = require("../backend/config/db");

(async () => {
  const pool = await poolPromise;
  const tableId = '806F6ADC-4AE8-4791-9640-E3038005338D';
  const tableNo = 'TW1';
  const testOrderNum = 'TEST_ACT_123456';

  try {
    console.log('1. inserting order...');
    await pool.request()
      .input('onum', sql.NVarChar(50), testOrderNum)
      .input('tno', sql.NVarChar(50), tableNo)
      .input('tid', sql.UniqueIdentifier, tableId)
      .query(`
        DECLARE @oid UNIQUEIDENTIFIER = NEWID();
        INSERT INTO RestaurantOrderCur (OrderId, OrderNumber, Tableno, IsTakeAway, isOrderClosed, OrderDateTime, StatusCode, CreatedBy, CreatedOn, TotalAmount)
        VALUES (@oid, @onum, @tno, 1, 0, GETDATE(), 1, 'admin', GETDATE(), 15.50);
        UPDATE TableMaster SET CurrentOrderId = @onum, Status = 1, StartTime = DATEADD(minute, -25, GETDATE()) WHERE TableId = @tid;
      `);
    console.log('1. success');
  } catch(e) {
    console.error('Step 1 error:', e.message, e.stack);
  }

  try {
    console.log('2. running reconcile...');
    const res = await pool.request().query(`
      DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);
      UPDATE tm
      SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL, 
          tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL,
          tm.ModifiedOn = GETDATE()
      OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
      FROM TableMaster tm
      WHERE tm.DiningSection = '4'
        AND tm.Status = 1
        AND tm.entry_status = 'q'
        AND (tm.PAYMENT_STATUS IS NULL OR tm.PAYMENT_STATUS = 0)
        AND tm.StartTime IS NOT NULL
        AND DATEDIFF(minute, tm.StartTime, GETDATE()) >= 15
        AND (
          tm.CurrentOrderId IS NULL 
          OR NOT EXISTS (
            SELECT 1 FROM RestaurantOrderCur roc 
            WHERE (roc.OrderNumber = tm.CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
              AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM CartItems ci WHERE ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber
        );
      SELECT TableId, TableNumber, DiningSection FROM @cleared;
    `);
    console.log('2. success, cleared:', res.recordset);
  } catch(e) {
    console.error('Step 2 error:', e.message, e.stack);
  }

  try {
    console.log('3. cleaning up...');
    await pool.request()
      .input('onum', sql.NVarChar(50), testOrderNum)
      .input('tid', sql.UniqueIdentifier, tableId)
      .query(`
        DELETE FROM RestaurantOrderCur WHERE OrderNumber = @onum;
        UPDATE TableMaster SET Status = 0, CurrentOrderId = NULL, StartTime = NULL, LockedByName = NULL WHERE TableId = @tid;
      `);
    console.log('3. success');
  } catch(e) {
    console.error('Step 3 error:', e.message, e.stack);
  }

  process.exit(0);
})();
