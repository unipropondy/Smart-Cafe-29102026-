const { io } = require("../frontend/node_modules/socket.io-client");
const { poolPromise } = require("../backend/config/db");

(async () => {
  const socket = io("http://localhost:3000");

  socket.on("connect", async () => {
    console.log("Connected to backend socket on 3000 with id:", socket.id);

    const pool = await poolPromise;
    const res = await pool.request().query(`
      SELECT TableId, TableNumber, DiningSection, Status 
      FROM TableMaster 
      WHERE TableNumber IN ('TW9', 'TW10', 'TW11', 'TW12')
    `);

    console.table(res.recordset);

    res.recordset.forEach(t => {
      const cleanTid = String(t.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      console.log(`Emitting table_status_updated for ${t.TableNumber} (${cleanTid})...`);
      // Emit both to self and via socket
      socket.emit("table_status_update", {
        tableId: cleanTid,
        tableNo: t.TableNumber,
        section: "TAKEAWAY",
        status: 0,
        orderId: "EMPTY",
        totalAmount: 0,
        startTime: 0,
        entryStatus: null,
        paymentStatus: 0,
        customerName: null,
        pax: null,
      });
    });

    socket.emit("table_config_update");

    setTimeout(() => {
      console.log("Done emitting.");
      socket.disconnect();
      process.exit(0);
    }, 1000);
  });
})();
