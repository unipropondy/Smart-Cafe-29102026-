const { poolPromise } = require('../backend/config/db');

const API_BASE = 'http://localhost:3000';

async function post(url, data) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return { status: res.status, data: await res.json() };
}

(async () => {
  console.log("=== Setting Up Two Test Tables with Paid Status ===");
  const pool = await poolPromise;

  // Let's use TW1 and TW2
  const tableData = await pool.request().query(`
    SELECT TableId, TableNumber, DiningSection FROM TableMaster WHERE TableNumber IN ('TW1', 'TW2')
  `);
  const tw1 = tableData.recordset.find(t => t.TableNumber.trim() === 'TW1');
  const tw2 = tableData.recordset.find(t => t.TableNumber.trim() === 'TW2');

  console.log(`TW1: ${tw1.TableId}, TW2: ${tw2.TableId}`);

  // Fetch top 2 dishes from DishMaster
  const dishRes = await pool.request().query(`
    SELECT TOP 2 DishId, Name as DishName, currentcost as Price FROM DishMaster WHERE IsActive = 1 AND currentcost > 0 ORDER BY currentcost DESC
  `);
  const dish1 = dishRes.recordset[0] || { DishId: 'D1', DishName: 'Dish 1', Price: 15.00 };
  const dish2 = dishRes.recordset[1] || { DishId: 'D2', DishName: 'Dish 2', Price: 22.00 };

  // 1. Assign & Send Order for TW1
  console.log("\n1. Setting up TW1 order...");
  const sess1 = 'sess_paid_test_' + Date.now() + '_1';
  await post('/api/tables/auto-assign-takeaway', {
    sessionId: sess1,
    tableId: tw1.TableId,
    customerName: 'Customer A',
    pax: 1
  });

  const send1 = await post('/api/orders/send', {
    tableId: tw1.TableId,
    orderType: 'TAKEAWAY',
    takeawayNo: 'TW1',
    entryStatus: 'q',
    customerName: 'Customer A',
    items: [
      {
        id: dish1.DishId,
        name: dish1.DishName,
        qty: 1,
        price: Number(dish1.Price),
        status: 'SENT',
        isTakeaway: true,
        takeawayCharge: 0,
        isServiceCharge: 0
      }
    ]
  });
  const orderId1 = send1.data?.orderId;
  console.log(`TW1 Order created: ${orderId1}`);

  // Mark TW1 as Paid
  const pay1 = await post('/api/orders/payment-status', {
    tableId: tw1.TableId,
    paymentStatus: 1,
    payMode: 'Yeahpay Paynow',
    orderId: orderId1,
    paidAmount: Number(dish1.Price)
  });
  console.log(`TW1 marked Paid:`, pay1.data);

  // 2. Assign & Send Order for TW2
  console.log("\n2. Setting up TW2 order...");
  const sess2 = 'sess_paid_test_' + Date.now() + '_2';
  await post('/api/tables/auto-assign-takeaway', {
    sessionId: sess2,
    tableId: tw2.TableId,
    customerName: 'Customer B',
    pax: 2
  });

  const send2 = await post('/api/orders/send', {
    tableId: tw2.TableId,
    orderType: 'TAKEAWAY',
    takeawayNo: 'TW2',
    entryStatus: 'q',
    customerName: 'Customer B',
    items: [
      {
        id: dish2.DishId,
        name: dish2.DishName,
        qty: 2,
        price: Number(dish2.Price),
        status: 'SENT',
        isTakeaway: true,
        takeawayCharge: 0,
        isServiceCharge: 0
      }
    ]
  });
  const orderId2 = send2.data?.orderId;
  console.log(`TW2 Order created: ${orderId2}`);

  // Mark TW2 as Paid
  const pay2 = await post('/api/orders/payment-status', {
    tableId: tw2.TableId,
    paymentStatus: 1,
    payMode: 'Credit Card',
    orderId: orderId2,
    paidAmount: Number(dish2.Price) * 2
  });
  console.log(`TW2 marked Paid:`, pay2.data);

  // Check state of all TW tables in TableMaster
  console.log("\n=== Checking TableMaster Takeaway Tables Status ===");
  const check = await pool.request().query(`
    SELECT TableNumber, Status, entry_status, PAYMENT_STATUS, CustomerName, CurrentOrderId, TotalAmount
    FROM TableMaster
    WHERE DiningSection = '4' AND TableNumber LIKE 'TW[0-9]%'
    ORDER BY CAST(REPLACE(TableNumber, 'TW', '') AS INT)
  `);
  console.table(check.recordset);

  process.exit(0);
})();
