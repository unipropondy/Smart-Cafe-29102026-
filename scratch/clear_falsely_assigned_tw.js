const { poolPromise } = require("../backend/config/db");
const { io } = require("../frontend/node_modules/socket.io-client");

(async () => {
  const pool = await poolPromise;

  console.log("Resetting all takeaway tables TW1 to TW20 in database using trigger-safe OUTPUT INTO...");
  const resetRes = await pool.request().query(`
    DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);

    UPDATE tm
    SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL, 
        tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL,
        tm.PAYMENT_STATUS = 0,
        tm.ModifiedOn = GETDATE()
    OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
    FROM TableMaster tm
    WHERE tm.DiningSection = '4' AND tm.TableNumber LIKE 'TW%';

    UPDATE RestaurantOrderCur
    SET isOrderClosed = 1
    WHERE Tableno LIKE 'TW%' AND (isOrderClosed = 0 OR isOrderClosed IS NULL);

    SELECT TableId, TableNumber, DiningSection FROM @cleared;
  `);

  console.log(`Reset ${resetRes.recordset.length} tables in DB.`);

  const socket = io("http://localhost:3000");

  socket.on("connect", () => {
    console.log("Connected to socket on port 3000. Broadcasting status 0 for all tables...");

    resetRes.recordset.forEach(tbl => {
      const cleanTid = String(tbl.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      socket.emit("table_status_update", {
        tableId: cleanTid,
        tableNo: tbl.TableNumber,
        section: "TAKEAWAY",
        status: 0,
        orderId: "EMPTY",
        totalAmount: 0,
        startTime: 0,
        entryStatus: null,
        paymentStatus: 0,
        customerName: null,
        pax: null
      });
    });

    socket.emit("tables_updated");
    socket.emit("table_config_updated");

    setTimeout(() => {
      console.log("All tables cleared and broadcasts sent successfully.");
      socket.disconnect();
      process.exit(0);
    }, 1500);
  });
})();
