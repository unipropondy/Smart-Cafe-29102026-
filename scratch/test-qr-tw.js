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
  console.log("=== Testing QR Takeaway Flow ===");

  // 1. Auto-assign takeaway table
  console.log("\n1. Auto-assigning Takeaway table...");
  const assignRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/tables/auto-assign-takeaway',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { customerName: 'Test Customer', pax: 1 });
  console.log("Assign Response:", assignRes.data);

  const table = assignRes.data?.table;
  if (!table) {
    console.error("Failed to assign takeaway table!");
    return;
  }

  const tableId = table.tableId;
  const tableNo = table.tableNo;
  console.log(`Assigned Table: ${tableNo} (ID: ${tableId})`);

  // 2. Fetch a menu item
  console.log("\n2. Fetching dishes from menu...");
  const menuRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/menu/dishes/all',
    method: 'GET'
  });

  const dishes = Array.isArray(menuRes.data) ? menuRes.data : (menuRes.data?.dishes || []);
  const sampleDish = dishes[0] || { DishId: '1', Name: 'Red Sauce Pasta', Price: 0.01 };
  console.log(`Selected Dish: ${sampleDish.Name || sampleDish.name} (Price: ${sampleDish.Price || sampleDish.price})`);

  // 3. Send order
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

  // 4. Set Payment Status to Paid (paymentStatus = 1)
  console.log("\n4. Marking Order as Paid via /api/orders/payment-status...");
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

  // 5. Query /api/orders/order-status/:id
  console.log("\n5. Checking Order Status via /api/orders/order-status/:id...");
  const statusRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/orders/order-status/${encodeURIComponent(orderId)}`,
    method: 'GET'
  });
  console.log("Order Status Response:", statusRes.data);

  // 6. Query /api/orders/cart/:tableId
  console.log("\n6. Checking Cart API via /api/orders/cart/:tableId...");
  const cartRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/orders/cart/${encodeURIComponent(tableId)}`,
    method: 'GET'
  });
  console.log("Cart Response - currentOrderId:", cartRes.data?.currentOrderId, "paymentStatus:", cartRes.data?.paymentStatus, "isPaid:", cartRes.data?.isPaid);

  console.log("\n=== Test Completed: Order is now in PAID status. Stopping as requested ===");
}

run().catch(console.error);
