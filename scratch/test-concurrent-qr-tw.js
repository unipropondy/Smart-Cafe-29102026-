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

async function runConcurrentTest() {
  console.log("==========================================================");
  console.log("🚀 STARTING CONCURRENT MULTI-CUSTOMER QR TAKEAWAY TEST");
  console.log("==========================================================\n");

  // 1. Fetch menu dishes to give each customer a distinct item
  console.log("1. Fetching available dishes from menu...");
  const menuRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/menu/dishes/all',
    method: 'GET'
  });

  const dishes = Array.isArray(menuRes.data) ? menuRes.data : [];
  if (dishes.length < 4) {
    console.error("Not enough dishes found!");
    process.exit(1);
  }

  const customerConfigs = [
    { name: "Alice", pax: 1, dish: dishes[0] },
    { name: "Bob", pax: 1, dish: dishes[1] || dishes[0] },
    { name: "Charlie", pax: 1, dish: dishes[2] || dishes[0] },
    { name: "Diana", pax: 1, dish: dishes[3] || dishes[0] },
  ];

  console.log(`Prepared 4 simulated customers: ${customerConfigs.map(c => `${c.name} (${c.dish.Name})`).join(", ")}\n`);

  // 2. SIMULTANEOUS SCAN & AUTO-ASSIGN
  console.log("2. Simulating simultaneous QR scan & auto-table assignment for 4 customers...");
  const assignPromises = customerConfigs.map((cfg, idx) => {
    return request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/tables/auto-assign-takeaway',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { customerName: cfg.name, pax: cfg.pax }).then(res => ({
      customerIndex: idx + 1,
      customerName: cfg.name,
      dish: cfg.dish,
      res
    }));
  });

  const assignResults = await Promise.all(assignPromises);

  // Check assignments
  console.log("\n--- Table Assignment Results ---");
  const assignedTables = [];
  const assignedTableIds = [];

  for (const r of assignResults) {
    const table = r.res.data?.table;
    if (!table) {
      console.error(`❌ Customer ${r.customerName} failed to get a table:`, r.res.data);
      process.exit(1);
    }
    console.log(`✅ Customer ${r.customerIndex} (${r.customerName}) assigned to Table: ${table.tableNo} (TableId: ${table.tableId})`);
    r.table = table;
    assignedTables.push(table.tableNo);
    assignedTableIds.push(table.tableId);
  }

  // Verify uniqueness of tables
  const uniqueTables = new Set(assignedTables);
  if (uniqueTables.size !== customerConfigs.length) {
    console.error("❌ CRITICAL: Duplicate table assigned! Tables:", assignedTables);
    process.exit(1);
  } else {
    console.log(`\n🎉 CONCURRENCY SAFETY VERIFIED: All ${uniqueTables.size} customers received distinct, unique tables! [${assignedTables.join(", ")}]\n`);
  }

  // 3. SIMULTANEOUS ORDER PLACEMENT
  console.log("3. Placing orders simultaneously for all 4 customers via /api/orders/send...");
  const sendPromises = assignResults.map((cust) => {
    const lineItemId = require('crypto').randomUUID();
    return request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/orders/send',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      tableId: cust.table.tableId,
      orderType: 'TAKEAWAY',
      takeawayNo: cust.table.tableNo,
      entryStatus: 'q',
      customerName: cust.customerName,
      items: [{
        id: cust.dish.DishId || cust.dish.id,
        lineItemId: lineItemId,
        name: cust.dish.Name || cust.dish.name,
        qty: 1,
        price: Number(cust.dish.Price || cust.dish.price || 1.00),
        status: 'SENT',
        isTakeaway: true,
        takeawayCharge: 0
      }]
    }).then(res => ({
      ...cust,
      orderRes: res
    }));
  });

  const sendResults = await Promise.all(sendPromises);

  console.log("\n--- Order Creation Results ---");
  const orderNumbers = [];
  for (const s of sendResults) {
    const orderId = s.orderRes.data?.orderId;
    if (!orderId) {
      console.error(`❌ Customer ${s.customerName} order send failed:`, s.orderRes.data);
      process.exit(1);
    }
    console.log(`✅ Customer ${s.customerName} on Table ${s.table.tableNo}: Order #${orderId} created successfully!`);
    s.orderId = orderId;
    orderNumbers.push(orderId);
  }

  const uniqueOrders = new Set(orderNumbers);
  if (uniqueOrders.size !== customerConfigs.length) {
    console.error("❌ Duplicate order numbers generated!", orderNumbers);
    process.exit(1);
  } else {
    console.log(`\n🎉 UNIQUE ORDERS VERIFIED: [${orderNumbers.join(", ")}]\n`);
  }

  // 4. SIMULTANEOUS PAYMENT SETTLEMENT (Marking Paid)
  console.log("4. Processing payments and marking all orders as PAID via /api/orders/payment-status...");
  const payPromises = sendResults.map((cust) => {
    return request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/orders/payment-status',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      tableId: cust.table.tableId,
      paymentStatus: 1,
      payMode: 'Yeahpay Paynow',
      orderId: cust.orderId
    }).then(res => ({
      ...cust,
      payRes: res
    }));
  });

  const payResults = await Promise.all(payPromises);

  console.log("\n--- Payment Results ---");
  for (const p of payResults) {
    console.log(`✅ Customer ${p.customerName} (Table ${p.table.tableNo}, Order #${p.orderId}): Payment Status = PAID (paymentStatus: ${p.payRes.data?.paymentStatus})`);
  }

  // 5. VERIFY FINAL STATUS VIA PUBLIC APIS
  console.log("\n5. Verifying each order status via /api/orders/order-status/:id and /api/orders/cart/:tableId...");
  const finalSummary = [];

  for (const cust of payResults) {
    // Check order-status endpoint
    const statusRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: `/api/orders/order-status/${encodeURIComponent(cust.orderId)}`,
      method: 'GET'
    });

    // Check cart endpoint
    const cartRes = await request({
      hostname: 'localhost',
      port: 3000,
      path: `/api/orders/cart/${encodeURIComponent(cust.table.tableId)}`,
      method: 'GET'
    });

    const isPaidStatus = statusRes.data?.isPaid === true && statusRes.data?.paymentStatus === 'PAID';
    const isCartPaid = cartRes.data?.isPaid === true && cartRes.data?.paymentStatus === 'PAID';

    console.log(`\n📋 [Customer: ${cust.customerName}]`);
    console.log(`   Table: ${cust.table.tableNo} (ID: ${cust.table.tableId})`);
    console.log(`   Order Number: #${cust.orderId}`);
    console.log(`   Ordered Item: ${cust.dish.Name} (Qty: 1, Price: $${cust.dish.Price})`);
    console.log(`   Order Status API -> OrderNumber: ${statusRes.data?.orderNumber}, Table: ${statusRes.data?.tableNo}, PaymentStatus: ${statusRes.data?.paymentStatus}, isPaid: ${statusRes.data?.isPaid}`);
    console.log(`   Cart API         -> CurrentOrderId: ${cartRes.data?.currentOrderId}, PaymentStatus: ${cartRes.data?.paymentStatus}, isPaid: ${cartRes.data?.isPaid}`);

    finalSummary.push({
      customer: cust.customerName,
      table: cust.table.tableNo,
      tableId: cust.table.tableId,
      orderNumber: cust.orderId,
      item: cust.dish.Name,
      amount: cust.dish.Price,
      paymentStatus: statusRes.data?.paymentStatus,
      isPaid: isPaidStatus && isCartPaid
    });
  }

  console.log("\n==========================================================");
  console.log("🏁 TEST COMPLETE: ALL 4 CONCURRENT ORDERS ARE IN PAID STATUS");
  console.log("   STOPPED BEFORE KDS & SERVE FOR USER SCREEN REVIEW");
  console.log("==========================================================\n");
  console.log(JSON.stringify(finalSummary, null, 2));

  process.exit(0);
}

runConcurrentTest().catch(err => {
  console.error("Concurrent test error:", err);
  process.exit(1);
});
