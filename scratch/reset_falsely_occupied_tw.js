const { poolPromise } = require('../backend/config/db');
const ioClient = require('../backend/node_modules/socket.io-client');

(async () => {
  const pool = await poolPromise;
  
  // Find all TW tables where TotalAmount = 0 and CurrentOrderId IS NULL (falsely locked tables)
  const falseTables = await pool.request().query(`
    SELECT TableId, TableNumber, DiningSection
    FROM TableMaster
    WHERE DiningSection = '4'
      AND Status = 1
      AND (TotalAmount = 0 OR TotalAmount IS NULL)
      AND CurrentOrderId IS NULL
  `);

  console.log(`Found ${falseTables.recordset.length} falsely occupied takeaway tables:`);
  console.table(falseTables.recordset);

  if (falseTables.recordset.length > 0) {
    const resetResult = await pool.request().query(`
      UPDATE TableMaster
      SET Status = 0,
          entry_status = NULL,
          PAYMENT_STATUS = 0,
          CustomerName = NULL,
          Pax = NULL,
          StartTime = NULL,
          TotalAmount = 0,
          CurrentOrderId = NULL,
          LockedByName = NULL,
          ModifiedOn = GETDATE()
      WHERE DiningSection = '4'
        AND Status = 1
        AND (TotalAmount = 0 OR TotalAmount IS NULL)
        AND CurrentOrderId IS NULL
    `);
    console.log(`Reset ${resetResult.rowsAffected[0]} tables in DB.`);

    // Connect socket to notify frontend POS screen
    const socket = ioClient('http://localhost:3000', { reconnection: false });
    socket.on('connect', () => {
      console.log('Connected to socket server, emitting table_status_updated for cleared tables...');
      falseTables.recordset.forEach((tbl) => {
        const cleanTid = String(tbl.TableId).replace(/^\{|\}$/g, '').trim().toLowerCase();
        socket.emit('table_status_updated', {
          tableId: cleanTid,
          rawTableId: tbl.TableId,
          tableNo: tbl.TableNumber,
          section: 'TAKEAWAY',
          status: 0,
          orderId: 'EMPTY',
          totalAmount: 0,
          startTime: null,
          entryStatus: null,
          paymentStatus: 0,
          customerName: null,
          pax: null,
        });
      });
      socket.emit('tables_updated');
      setTimeout(() => {
        socket.disconnect();
        console.log('Finished clearing tables.');
        process.exit(0);
      }, 1000);
    });

    socket.on('connect_error', (err) => {
      console.warn('Socket connect error:', err.message);
      process.exit(0);
    });
  } else {
    console.log('No falsely occupied tables found.');
    process.exit(0);
  }
})();
