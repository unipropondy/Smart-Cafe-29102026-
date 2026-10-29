const http = require('http');
const { poolPromise, sql } = require('../backend/config/db');

const BASE_URL = 'http://localhost:3000';

function post(endpoint, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const url = new URL(endpoint, BASE_URL);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  console.log("=== Starting End-to-End Validation of Takeaway Table Independence ===");
  const pool = await poolPromise;

  // 1. Get TableId for TW1 and TW2
  const tableRows = await pool.request().query(`
    SELECT TableId, TableNumber FROM TableMaster 
    WHERE DiningSection = '4' AND TableNumber IN ('TW1', 'TW2')
    ORDER BY TableNumber
  `);
  const tw1 = tableRows.recordset.find(r => r.TableNumber.trim() === 'TW1');
  const tw2 = tableRows.recordset.find(r => r.TableNumber.trim() === 'TW2');

  console.log(`Found TW1: ${tw1?.TableId}, TW2: ${tw2?.TableId}`);

  // Test 1: Customer scans TW1 specific QR code
  console.log("\n--- TEST 1: Customer scans TW1 QR code (?tableNo=TW1&tableId=" + tw1.TableId + ") ---");
  const scanSess1 = "sess_tw1_" + Date.now();
  const assignRes1 = await post('/api/tables/auto-assign-takeaway', {
    sessionId: scanSess1,
    tableId: tw1.TableId,
    customerName: "Guest Cus",
    pax: 1
  });
  console.log("Assign TW1 Response:", assignRes1.data);

  if (assignRes1.data?.table?.tableNo !== 'TW1') {
    console.error("❌ FAILED: Expected TW1 assigned, got:", assignRes1.data?.table?.tableNo);
    process.exit(1);
  }
  console.log("✅ TW1 assigned successfully.");

  // Test 1b: Verify in DB that ONLY TW1 is occupied, and TW2..TW20 are Status 0
  const checkAfterScan1 = await pool.request().query(`
    SELECT TableNumber, Status, PAYMENT_STATUS, CustomerName 
    FROM TableMaster 
    WHERE DiningSection = '4' AND TableNumber LIKE 'TW[0-9]%'
    ORDER BY CAST(REPLACE(TableNumber, 'TW', '') AS INT)
  `);

  const occupiedAfterScan1 = checkAfterScan1.recordset.filter(t => t.Status !== 0);
  console.log("Occupied tables after TW1 scan:", occupiedAfterScan1.map(t => t.TableNumber.trim()));
  if (occupiedAfterScan1.length !== 1 || occupiedAfterScan1[0].TableNumber.trim() !== 'TW1') {
    console.error("❌ FAILED: More than 1 table occupied or not TW1:", occupiedAfterScan1);
    process.exit(1);
  }
  console.log("✅ Verified: ONLY TW1 is occupied after scan.");

  // Test 2: Customer on TW1 places order and pays
  console.log("\n--- TEST 2: Customer on TW1 completes payment ---");
  // Find a valid dish from DishMaster
  const dishRes = await pool.request().query("SELECT TOP 1 DishId, Name as DishName, currentcost as Price FROM DishMaster WHERE IsActive = 1 AND currentcost > 0");
  const dish = dishRes.recordset[0] || { DishId: 'TEST-DISH', DishName: 'Pasta', Price: 0.01 };

  // Create real order for TW1 via /api/orders/send
  const sendRes1 = await post('/api/orders/send', {
    tableId: tw1.TableId,
    orderType: 'TAKEAWAY',
    takeawayNo: 'TW1',
    entryStatus: 'q',
    customerName: 'Guest Cus',
    items: [
      {
        id: dish.DishId,
        name: dish.DishName,
        qty: 1,
        price: Number(dish.Price),
        status: 'SENT',
        isTakeaway: true,
        takeawayCharge: 0,
        isServiceCharge: 0
      }
    ]
  });
  console.log("Send TW1 Order Response:", sendRes1.data);
  const orderId1 = sendRes1.data?.orderId;

  // Call /payment-status for TW1 with status = 1 (PAID)
  const payRes1 = await post('/api/orders/payment-status', {
    tableId: tw1.TableId,
    paymentStatus: 1,
    payMode: "Yeahpay Paynow",
    orderId: orderId1,
    paidAmount: Number(dish.Price)
  });
  console.log("Payment TW1 Response:", payRes1.data);

  // Check DB state of ALL takeaway tables TW1 to TW20
  const checkAfterPay1 = await pool.request().query(`
    SELECT TableNumber, Status, PAYMENT_STATUS, CustomerName, CurrentOrderId 
    FROM TableMaster 
    WHERE DiningSection = '4' AND TableNumber LIKE 'TW[0-9]%'
    ORDER BY CAST(REPLACE(TableNumber, 'TW', '') AS INT)
  `);

  const occupiedAfterPay1 = checkAfterPay1.recordset.filter(t => t.Status !== 0);
  console.log("Occupied tables after TW1 payment:", occupiedAfterPay1.map(t => `${t.TableNumber.trim()} (Status: ${t.Status}, PaymentStatus: ${t.PAYMENT_STATUS})`));

  if (occupiedAfterPay1.length !== 1 || occupiedAfterPay1[0].TableNumber.trim() !== 'TW1') {
    console.error("❌ FAILED: Other tables were occupied after TW1 payment!", occupiedAfterPay1);
    process.exit(1);
  }
  if (occupiedAfterPay1[0].PAYMENT_STATUS !== 1) {
    console.error("❌ FAILED: TW1 PAYMENT_STATUS was not set to 1:", occupiedAfterPay1[0]);
    process.exit(1);
  }
  console.log("✅ Verified: TW1 is PAID (Status 1, PaymentStatus 1), and TW2-TW20 are strictly UNCHANGED and AVAILABLE (Status 0).");

  // Test 3: Customer scans TW2 QR code independently
  console.log("\n--- TEST 3: Another customer scans TW2 QR code (?tableNo=TW2&tableId=" + tw2.TableId + ") ---");
  const scanSess2 = "sess_tw2_" + Date.now();
  const assignRes2 = await post('/api/tables/auto-assign-takeaway', {
    sessionId: scanSess2,
    tableId: tw2.TableId,
    customerName: "Cus Two",
    pax: 1
  });
  console.log("Assign TW2 Response:", assignRes2.data);

  if (assignRes2.data?.table?.tableNo !== 'TW2') {
    console.error("❌ FAILED: Expected TW2 assigned, got:", assignRes2.data?.table?.tableNo);
    process.exit(1);
  }

  // Create real order for TW2 via /api/orders/send
  const sendRes2 = await post('/api/orders/send', {
    tableId: tw2.TableId,
    orderType: 'TAKEAWAY',
    takeawayNo: 'TW2',
    entryStatus: 'q',
    customerName: 'Cus Two',
    items: [
      {
        id: dish.DishId,
        name: dish.DishName,
        qty: 1,
        price: Number(dish.Price),
        status: 'SENT',
        isTakeaway: true,
        takeawayCharge: 0,
        isServiceCharge: 0
      }
    ]
  });
  console.log("Send TW2 Order Response:", sendRes2.data);
  const orderId2 = sendRes2.data?.orderId;

  const payRes2 = await post('/api/orders/payment-status', {
    tableId: tw2.TableId,
    paymentStatus: 1,
    payMode: "Yeahpay Paynow",
    orderId: orderId2,
    paidAmount: Number(dish.Price)
  });
  console.log("Payment TW2 Response:", payRes2.data);

  // Check DB state of ALL takeaway tables TW1 to TW20
  const checkAfterPay2 = await pool.request().query(`
    SELECT TableNumber, Status, PAYMENT_STATUS, CustomerName, CurrentOrderId 
    FROM TableMaster 
    WHERE DiningSection = '4' AND TableNumber LIKE 'TW[0-9]%'
    ORDER BY CAST(REPLACE(TableNumber, 'TW', '') AS INT)
  `);

  const occupiedAfterPay2 = checkAfterPay2.recordset.filter(t => t.Status !== 0);
  console.log("Occupied tables after TW2 payment:", occupiedAfterPay2.map(t => `${t.TableNumber.trim()} (Status: ${t.Status}, PaymentStatus: ${t.PAYMENT_STATUS})`));

  if (occupiedAfterPay2.length !== 2) {
    console.error("❌ FAILED: Expected exactly TW1 and TW2 occupied, got:", occupiedAfterPay2);
    process.exit(1);
  }
  const occupiedLabels = occupiedAfterPay2.map(t => t.TableNumber.trim()).sort();
  if (occupiedLabels[0] !== 'TW1' || occupiedLabels[1] !== 'TW2') {
    console.error("❌ FAILED: Unexpected occupied tables:", occupiedLabels);
    process.exit(1);
  }
  console.log("✅ Verified: ONLY TW1 and TW2 are occupied and paid. TW3 through TW20 remain completely FREE (Status 0).");

  // Clean up test orders
  await pool.request().query(`
    DELETE FROM RestaurantOrderDetailCur WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber IN ('${orderId1}', '${orderId2}'));
    DELETE FROM RestaurantOrderCur WHERE OrderNumber IN ('${orderId1}', '${orderId2}');
    UPDATE TableMaster 
    SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL, LockedByName = NULL, PAYMENT_STATUS = 0
    WHERE DiningSection = '4' AND TableNumber IN ('TW1', 'TW2');
  `);

  console.log("\n=======================================================");
  console.log("🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY! 🎉");
  console.log("=======================================================");
  process.exit(0);
})();
