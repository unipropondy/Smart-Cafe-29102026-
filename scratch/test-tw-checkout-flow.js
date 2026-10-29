const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const url = new URL(path, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runCheckoutTest() {
  console.log('========================================================');
  console.log('🧪 VERIFYING COMPLETE CHECKOUT FLOW FOR MULTI-CUSTOMER');
  console.log('========================================================\n');

  // Fetch available dish
  const dishesRes = await request('GET', '/api/menu/dishes/all');
  const dishList = Array.isArray(dishesRes.body) ? dishesRes.body : dishesRes.body?.dishes || [];
  const dish = dishList.length > 0 ? dishList[0] : null;
  if (!dish) {
    console.log('No dishes found in DB, skipping cart send step.');
    return;
  }
  const dishId = dish.DishId || dish.dishId || dish.id;
  const dishName = dish.DishName || dish.dishName || dish.name || 'Sample Dish';
  const dishPrice = dish.Price || dish.price || 5.0;

  console.log(`Using dish: "${dishName}" ($${dishPrice}) [${dishId}]`);

  // Step 1: Customer A assigns table
  const sessA = 'sess_chk_A_' + Date.now();
  const assignA = await request('POST', '/api/tables/auto-assign-takeaway', {
    sessionId: sessA,
    customerName: 'Alice',
    pax: 1
  });
  const tableA = assignA.body?.table;
  console.log(`\n1. Customer Alice assigned: ${tableA?.tableNo} (${tableA?.tableId})`);

  // Step 2: Customer B assigns table concurrently
  const sessB = 'sess_chk_B_' + Date.now();
  const assignB = await request('POST', '/api/tables/auto-assign-takeaway', {
    sessionId: sessB,
    customerName: 'Bob',
    pax: 1
  });
  const tableB = assignB.body?.table;
  console.log(`2. Customer Bob assigned: ${tableB?.tableNo} (${tableB?.tableId})`);

  if (tableA?.tableNo === tableB?.tableNo) {
    console.error('❌ FAIL: Both customers received same table!');
    return;
  }
  console.log('✅ PASS: Alice and Bob received different tables!');

  // Step 3: Alice sends order
  console.log(`\n3. Sending order for Alice on ${tableA?.tableNo}...`);
  const orderAlice = await request('POST', '/api/orders/send', {
    tableId: tableA.tableId,
    orderType: 'TAKEAWAY',
    takeawayNo: tableA.tableNo,
    entryStatus: 'q',
    customerName: 'Alice',
    items: [
      {
        id: dishId,
        lineItemId: require('crypto').randomUUID(),
        name: dishName,
        qty: 1,
        price: dishPrice,
        status: 'SENT',
        isTakeaway: true
      }
    ]
  });

  console.log(`   Alice Order HTTP Status: ${orderAlice.status}`, orderAlice.body);

  // Step 4: Bob sends order
  console.log(`\n4. Sending order for Bob on ${tableB?.tableNo}...`);
  const orderBob = await request('POST', '/api/orders/send', {
    tableId: tableB.tableId,
    orderType: 'TAKEAWAY',
    takeawayNo: tableB.tableNo,
    entryStatus: 'q',
    customerName: 'Bob',
    items: [
      {
        id: dishId,
        lineItemId: require('crypto').randomUUID(),
        name: dishName,
        qty: 2,
        price: dishPrice,
        status: 'SENT',
        isTakeaway: true
      }
    ]
  });

  console.log(`   Bob Order HTTP Status: ${orderBob.status}`, orderBob.body);

  // Step 5: Verify table assignments remain correct
  const tablesAfter = await request('GET', '/api/tables/all');
  const tList = Array.isArray(tablesAfter.body) ? tablesAfter.body : [];
  const aliceTableDb = tList.find(t => t.id?.toLowerCase() === tableA.tableId?.toLowerCase());
  const bobTableDb = tList.find(t => t.id?.toLowerCase() === tableB.tableId?.toLowerCase());

  console.log(`\n5. Verifying Tables State in DB:`);
  console.log(`   Alice Table (${tableA.tableNo}): Status = ${aliceTableDb?.Status}, Customer = ${aliceTableDb?.customerName}, Label = ${aliceTableDb?.label}`);
  console.log(`   Bob Table (${tableB.tableNo}): Status = ${bobTableDb?.Status}, Customer = ${bobTableDb?.customerName}, Label = ${bobTableDb?.label}`);

  if (aliceTableDb?.label === tableA.tableNo && bobTableDb?.label === tableB.tableNo && aliceTableDb.label !== bobTableDb.label) {
    console.log(`\n✅ ALL CHECKS PASSED: Table assignments remained distinct and intact throughout checkout!`);
  } else {
    console.error(`\n❌ State mismatch in DB!`);
  }
}

runCheckoutTest().catch(console.error);
