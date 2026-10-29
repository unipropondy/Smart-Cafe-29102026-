const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function run() {
  console.log("=== Placing Test QR Takeaway Order & Testing Print Output ===");

  // 1. Auto-assign takeaway table
  console.log("\n1. Auto-assigning Takeaway table...");
  const assignRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/tables/auto-assign-takeaway',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { customerName: 'Guest', pax: 1 });
  console.log("Assign Response:", assignRes.data);

  const table = assignRes.data?.table;
  if (!table) {
    console.error("Failed to assign takeaway table!");
    return;
  }

  const tableId = table.tableId;
  const tableNo = table.tableNo;
  console.log(`Assigned Table: ${tableNo} (ID: ${tableId})`);

  // 2. Fetch dishes
  console.log("\n2. Fetching dishes from menu...");
  const menuRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/menu/dishes/all',
    method: 'GET'
  });

  const dishes = Array.isArray(menuRes.data) ? menuRes.data : (menuRes.data?.dishes || []);
  const sampleDish = dishes.find(d => (d.Name || d.name || '').includes('Pasta')) || dishes[0] || { DishId: '1', Name: 'Red Sauce Pasta', Price: 0.01 };
  console.log(`Selected Dish: ${sampleDish.Name || sampleDish.name} (Price: ${sampleDish.Price || sampleDish.price})`);

  // 3. Place order
  console.log("\n3. Placing Order via /api/orders/send...");
  const sendRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/orders/send',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    tableId: tableId,
    orderType: 'TAKEAWAY',
    takeawayNo: tableNo,
    entryStatus: 'q',
    items: [{
      id: sampleDish.DishId || sampleDish.id,
      lineItemId: require('crypto').randomUUID(),
      name: sampleDish.Name || sampleDish.name,
      qty: 1,
      price: Number(sampleDish.Price || sampleDish.price || 0.01),
      status: 'SENT',
      isTakeaway: true,
      takeawayCharge: 0.01
    }]
  });
  console.log("Send Order Response:", sendRes.data);
  const orderId = sendRes.data?.orderId;
  console.log(`Created Order Number: ${orderId}`);

  if (!orderId) {
    console.error("No orderId returned!");
    return;
  }

  // 4. Mark order as Paid to trigger prints
  console.log("\n4. Marking Order as Paid via /api/orders/payment-status to trigger KOT, KDS, and Receipt prints...");
  const payRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/orders/payment-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    tableId: tableId,
    paymentStatus: 1,
    payMode: 'Yeahpay Paynow',
    orderId: orderId
  });
  console.log("Payment Status Response:", payRes.data);

  // 5. Inspect PrintJobQueue in DB to verify print contents
  console.log("\n5. Checking PrintJobQueue for Order:", orderId);
  const { poolPromise } = require('../backend/config/db');
  const sql = require('../backend/node_modules/mssql');
  const pool = await poolPromise;
  const jobsRes = await pool.request()
    .input("ordNo", sql.NVarChar(50), `%${orderId.slice(-4)}%`)
    .query(`
      SELECT TOP 5 JobId, PrinterName, PrinterIp, Content, Status, CreatedOn
      FROM PrintJobQueue
      WHERE Content LIKE @ordNo
      ORDER BY CreatedOn DESC
    `);

  console.log(`\nFound ${jobsRes.recordset.length} print jobs in PrintJobQueue:`);
  jobsRes.recordset.forEach((job, idx) => {
    console.log(`\n======================================================`);
    console.log(`[Print Job ${idx + 1}] (${job.PrinterName} -> ${job.PrinterIp}) [Status: ${job.Status}]`);
    console.log(`======================================================`);
    console.log(job.Content);
  });

  process.exit(0);
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
