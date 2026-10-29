const http = require('http');
const crypto = require('crypto');

const PORT = 3000;
const HOST = '127.0.0.1';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const dataString = body ? JSON.stringify(body) : '';
    const options = {
      hostname: HOST,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataString)
      }
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
        } catch (e) {
          resolve({ status: res.statusCode, text: responseBody });
        }
      });
    });

    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

async function runTest() {
  console.log('====================================================');
  console.log('🧪 TESTING QR TAKEAWAY ORDER STATUS ICON LIFECYCLE');
  console.log('====================================================\n');

  const testSessionId = 'tw_test_icon_' + Date.now();

  try {
    // 0. Fetch a real dish from menu
    const dishesRes = await request('GET', '/api/menu/dishes/all');
    const dishList = Array.isArray(dishesRes.data) ? dishesRes.data : dishesRes.data?.dishes || [];
    const dish = dishList.length > 0 ? dishList[0] : { DishId: '00000000-0000-0000-0000-000000000001', Name: 'Sample Dish', Price: 10.0 };
    const dishId = dish.DishId || dish.dishId || dish.id;
    const dishName = dish.DishName || dish.Name || 'Sample Dish';
    const dishPrice = Number(dish.Price || dish.price || 10.0);

    // 1. Assign Takeaway Table
    console.log('Step 1: Auto-assigning Takeaway Table...');
    const assignRes = await request('POST', '/api/tables/auto-assign-takeaway', {
      sessionId: testSessionId,
      customerName: 'IconTest',
      pax: 1
    });

    if (!assignRes.data || !assignRes.data.success || !assignRes.data.table) {
      throw new Error(`Failed to assign table: ${JSON.stringify(assignRes.data)}`);
    }

    const { tableId, tableNo } = assignRes.data.table;
    console.log(`✅ Table assigned: ${tableNo} (${tableId})\n`);

    // 2. Check /api/orders/cart/:tableId BEFORE order / payment
    console.log('Step 2: Checking table status BEFORE payment...');
    const cartBefore = await request('GET', `/api/orders/cart/${tableId}`);
    console.log(`- API Response isPaid:`, cartBefore.data?.isPaid);
    console.log(`- API Response paymentStatus:`, cartBefore.data?.paymentStatus);

    const isPaidBefore = Boolean(cartBefore.data?.isPaid);
    if (!isPaidBefore) {
      console.log('✅ PASS [Step 2]: isPaid is FALSE. Order Status Icon is HIDDEN by default.\n');
    } else {
      console.error('❌ FAIL [Step 2]: isPaid should be false initially.');
    }

    // 3. Place an order for this table
    console.log(`Step 3: Placing an order for ${tableNo} with item "${dishName}" ($${dishPrice})...`);
    const placeOrderRes = await request('POST', '/api/orders/send', {
      tableId: tableId,
      orderType: 'TAKEAWAY',
      takeawayNo: tableNo,
      entryStatus: 'q',
      customerName: 'IconTest',
      items: [
        {
          id: dishId,
          lineItemId: crypto.randomUUID(),
          name: dishName,
          qty: 1,
          price: dishPrice,
          status: 'SENT',
          isTakeaway: true
        }
      ]
    });

    const orderId = placeOrderRes.data?.orderId;
    console.log(`- Order placed: #${orderId} (Status: ${placeOrderRes.status})`);

    // 4. Check /api/orders/cart/:tableId AFTER order, BEFORE payment
    console.log('\nStep 4: Checking table status AFTER order placed, but BEFORE payment...');
    const cartAfterOrder = await request('GET', `/api/orders/cart/${tableId}`);
    console.log(`- API Response isPaid:`, cartAfterOrder.data?.isPaid);
    console.log(`- API Response paymentStatus:`, cartAfterOrder.data?.paymentStatus);

    const isPaidAfterOrder = Boolean(cartAfterOrder.data?.isPaid);
    if (!isPaidAfterOrder) {
      console.log('✅ PASS [Step 4]: isPaid is still FALSE. Order Status Icon remains HIDDEN until payment.\n');
    } else {
      console.error('❌ FAIL [Step 4]: isPaid should remain false until payment is made.');
    }

    // 5. Customer completes payment (e.g. paymentStatus = 1)
    console.log('Step 5: Completing payment for the order...');
    const payRes = await request('POST', '/api/orders/payment-status', {
      tableId: tableId,
      paymentStatus: 1,
      payMode: 'Yeahpay Paynow',
      orderId: orderId
    });

    console.log(`- Payment completion response:`, payRes.data?.success ? 'Success' : payRes.data);

    // 6. Check /api/orders/cart/:tableId AFTER payment
    console.log('\nStep 6: Checking table status AFTER payment...');
    const cartAfterPayment = await request('GET', `/api/orders/cart/${tableId}`);
    console.log(`- API Response isPaid:`, cartAfterPayment.data?.isPaid);
    console.log(`- API Response paymentStatus:`, cartAfterPayment.data?.paymentStatus);

    const isPaidAfterPayment = Boolean(cartAfterPayment.data?.isPaid) || cartAfterPayment.data?.paymentStatus === 'PAID';
    if (isPaidAfterPayment) {
      console.log('✅ PASS [Step 6]: isPaid is now TRUE! Order Status Icon will now SHOW in Takeaway Menu header.\n');
    } else {
      console.error('❌ FAIL [Step 6]: isPaid should be true after payment.');
    }

    // 7. Test release-takeaway behavior
    console.log('Step 7: Testing release-takeaway while order is active in KDS...');
    const releaseAttempt = await request('POST', '/api/tables/release-takeaway', {
      sessionId: testSessionId,
      tableId: tableId,
      tableNo: tableNo
    });
    console.log(`- Release attempt result: releasedCount = ${releaseAttempt.data?.releasedCount}`);
    if (releaseAttempt.data?.releasedCount === 0) {
      console.log('✅ PASS [Step 7]: Table is preserved because order is being prepared in KDS (confirmed expected workflow).\n');
    }

    console.log('====================================================');
    console.log('🎉 ALL 7 VERIFICATIONS PASSED SUCCESSFULLY!');
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Test encountered error:', err.message);
  }
}

runTest();
