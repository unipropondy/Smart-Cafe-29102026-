const http = require('http');
const { poolPromise } = require('../backend/config/db');

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
  const pool = await poolPromise;
  
  // 1. Find Order 0037
  const res = await pool.request().query(`
    SELECT TOP 5 OrderId, OrderNumber, Tableno, TotalAmount, CreatedOn
    FROM RestaurantOrderCur
    WHERE OrderNumber LIKE '%0037'
    ORDER BY CreatedOn DESC
  `);
  console.log('Order 0037 details:', res.recordset);

  if (res.recordset.length === 0) {
    console.log('No order found ending in 0037. Checking recent orders:');
    const recent = await pool.request().query(`
      SELECT TOP 5 OrderId, OrderNumber, Tableno, TotalAmount, CreatedOn
      FROM RestaurantOrderCur
      ORDER BY CreatedOn DESC
    `);
    console.log('Recent orders:', recent.recordset);
    process.exit(0);
  }

  const order = res.recordset[0];
  const orderNumber = order.OrderNumber;
  const tableNo = order.Tableno;

  // 2. Find Table
  const tableRes = await pool.request()
    .input('ordNo', orderNumber)
    .input('tblNo', tableNo)
    .query(`
      SELECT TableId, TableNumber, Status, PAYMENT_STATUS, CurrentOrderId
      FROM TableMaster
      WHERE CurrentOrderId = @ordNo OR TableNumber = @tblNo
    `);
  console.log('Table details:', tableRes.recordset);

  const table = tableRes.recordset[0];
  const tableId = table ? table.TableId : tableNo;

  // 3. Mark as paid via API to ensure socket emit + settlement + auto-print (if configured)
  console.log(`\nCalling /api/orders/payment-status for Table ${tableNo} (${tableId}), Order ${orderNumber}...`);
  const payRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/orders/payment-status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    tableId: String(tableId),
    paymentStatus: 1,
    payMode: 'Yeahpay Paynow',
    orderId: orderNumber
  });

  console.log('Payment API Response:', payRes.data);
  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
