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

const results = [];

function record(name, steps, expected, actual, passed, details = {}) {
  results.push({ name, steps, expected, actual, passed, details });
  const mark = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`\n==================================================`);
  console.log(`${mark} : ${name}`);
  console.log(`Expected: ${expected}`);
  console.log(`Actual  : ${actual}`);
  if (Object.keys(details).length) {
    console.log(`Details :`, JSON.stringify(details, null, 2));
  }
}

async function runAllTests() {
  const pool = await poolPromise;
  console.log('🚀 Starting Complete QR Takeaway Table Release Verification...\n');

  // ─────────────────────────────────────────────────────────────
  // TEST 1: Customer Scans but Does Nothing
  // ─────────────────────────────────────────────────────────────
  try {
    const sess1 = 'sess_test1_cust1_' + Date.now();
    const sess2 = 'sess_test1_cust2_' + Date.now();

    // Customer 1 scans
    const res1 = await post('/api/tables/auto-assign-takeaway', {
      sessionId: sess1,
      customerName: 'Cust1',
      pax: 1
    });

    const table1 = res1.data.table;

    // Customer 2 scans
    const res2 = await post('/api/tables/auto-assign-takeaway', {
      sessionId: sess2,
      customerName: 'Cust2',
      pax: 1
    });

    const table2 = res2.data.table;

    // Verify Customer 1 reconnects / does not get overwritten
    const res1Again = await post('/api/tables/auto-assign-takeaway', {
      sessionId: sess1,
      customerName: 'Cust1',
      pax: 1
    });
    const table1Again = res1Again.data.table;

    // Check DB
    const dbCheck = await pool.request()
      .input('t1', sql.NVarChar(50), table1.tableNo)
      .input('t2', sql.NVarChar(50), table2.tableNo)
      .query(`
        SELECT TableNumber, Status, entry_status, CustomerName, LockedByName
        FROM TableMaster WHERE TableNumber IN (@t1, @t2)
      `);

    const passed = (
      table1.tableNo !== table2.tableNo &&
      table1Again.tableNo === table1.tableNo &&
      res1Again.data.isExistingSession === true &&
      dbCheck.recordset.length === 2 &&
      dbCheck.recordset.every(r => r.Status === 1 && r.entry_status === 'q')
    );

    record(
      'Test 1: Customer Scans but Does Nothing',
      '1. Cust1 scans -> gets table. 2. Cust1 does nothing. 3. Cust2 scans -> gets table. 4. Cust1 requests again -> preserves table.',
      'Cust1 and Cust2 receive different tables; Cust1 session is preserved and not overwritten on re-access.',
      passed 
        ? `Cust1 got ${table1.tableNo}, Cust2 got ${table2.tableNo}. Cust1 re-scan returned ${table1Again.tableNo} (re-used).` 
        : `Duplicate or overwriting observed: ${table1.tableNo} vs ${table2.tableNo}`,
      passed,
      {
        cust1Session: sess1,
        cust1Table: table1.tableNo,
        cust2Session: sess2,
        cust2Table: table2.tableNo,
        cust1RecheckTable: table1Again.tableNo,
        dbRows: dbCheck.recordset
      }
    );

    // Clean up Test 1 tables
    await post('/api/tables/release-takeaway', { sessionId: sess1, tableNo: table1.tableNo });
    await post('/api/tables/release-takeaway', { sessionId: sess2, tableNo: table2.tableNo });
  } catch (err) {
    record('Test 1: Customer Scans but Does Nothing', 'Run steps', 'Success', `Error: ${err.message}`, false);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Simultaneous QR Scans (Concurrency)
  // ─────────────────────────────────────────────────────────────
  try {
    const ts = Date.now();
    // 2 simultaneous scans
    const sessA = `sess_test2_A_${ts}`;
    const sessB = `sess_test2_B_${ts}`;

    const [resA, resB] = await Promise.all([
      post('/api/tables/auto-assign-takeaway', { sessionId: sessA, customerName: 'SimulA', pax: 1 }),
      post('/api/tables/auto-assign-takeaway', { sessionId: sessB, customerName: 'SimulB', pax: 1 }),
    ]);

    const tblA = resA.data?.table?.tableNo;
    const tblB = resB.data?.table?.tableNo;

    // 4 simultaneous scans
    const sessC = `sess_test2_C_${ts}`;
    const sessD = `sess_test2_D_${ts}`;
    const sessE = `sess_test2_E_${ts}`;
    const sessF = `sess_test2_F_${ts}`;

    const [resC, resD, resE, resF] = await Promise.all([
      post('/api/tables/auto-assign-takeaway', { sessionId: sessC, customerName: 'SimulC', pax: 1 }),
      post('/api/tables/auto-assign-takeaway', { sessionId: sessD, customerName: 'SimulD', pax: 1 }),
      post('/api/tables/auto-assign-takeaway', { sessionId: sessE, customerName: 'SimulE', pax: 1 }),
      post('/api/tables/auto-assign-takeaway', { sessionId: sessF, customerName: 'SimulF', pax: 1 }),
    ]);

    const tblC = resC.data?.table?.tableNo;
    const tblD = resD.data?.table?.tableNo;
    const tblE = resE.data?.table?.tableNo;
    const tblF = resF.data?.table?.tableNo;

    const assigned4 = [tblC, tblD, tblE, tblF];
    const unique4 = new Set(assigned4);

    const passed = (
      tblA && tblB && tblA !== tblB &&
      assigned4.every(Boolean) &&
      unique4.size === 4
    );

    record(
      'Test 2: Simultaneous QR Scans',
      '1. Fire 2 simultaneous requests. 2. Verify unique tables. 3. Fire 4 simultaneous requests. 4. Verify all 4 unique.',
      'All concurrent scans receive unique available tables without any race conditions or collisions.',
      passed
        ? `Pair: [${tblA}, ${tblB}] distinct. Quad: [${assigned4.join(', ')}] all 4 unique.`
        : `Duplicate detected: Pair [${tblA}, ${tblB}], Quad [${assigned4.join(', ')}]`,
      passed,
      {
        pairSessions: { [sessA]: tblA, [sessB]: tblB },
        quadSessions: { [sessC]: tblC, [sessD]: tblD, [sessE]: tblE, [sessF]: tblF },
        quadUniqueCount: unique4.size
      }
    );

    // Clean up Test 2 tables
    for (const [s, t] of [[sessA, tblA], [sessB, tblB], [sessC, tblC], [sessD, tblD], [sessE, tblE], [sessF, tblF]]) {
      if (t) await post('/api/tables/release-takeaway', { sessionId: s, tableNo: t });
    }
  } catch (err) {
    record('Test 2: Simultaneous QR Scans', 'Run concurrency', 'Success', `Error: ${err.message}`, false);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Logout and Table Release
  // ─────────────────────────────────────────────────────────────
  try {
    const sess3 = 'sess_test3_' + Date.now();
    // 1. Scan and get table
    const assignRes = await post('/api/tables/auto-assign-takeaway', {
      sessionId: sess3,
      customerName: 'LogoutUser',
      pax: 1
    });
    const assignedTable = assignRes.data.table;
    const tNo = assignedTable.tableNo;
    const tId = assignedTable.tableId;

    // Check DB status before logout
    const beforeCheck = await pool.request().query(`
      SELECT TableNumber, Status, entry_status, CustomerName, TotalAmount
      FROM TableMaster WHERE TableNumber = '${tNo}'
    `);
    const statusBefore = beforeCheck.recordset[0]?.Status;
    const entryStatusBefore = beforeCheck.recordset[0]?.entry_status;

    // 2. Customer logs out before ordering
    const releaseRes = await post('/api/tables/release-takeaway', {
      sessionId: sess3,
      tableId: tId,
      tableNo: tNo
    });

    // 3. Verify DB and API status after logout
    const afterCheck = await pool.request().query(`
      SELECT TableNumber, Status, entry_status, CustomerName, TotalAmount, LockedByName
      FROM TableMaster WHERE TableNumber = '${tNo}'
    `);
    const statusAfter = afterCheck.recordset[0]?.Status;
    const entryStatusAfter = afterCheck.recordset[0]?.entry_status;
    const lockedByAfter = afterCheck.recordset[0]?.LockedByName;

    // Check POS all tables API
    const posAll = await get('/api/tables/all?section=TAKEAWAY');
    const posTable = posAll.data?.find?.(t => t.label === tNo);

    // 4. Scan again with new customer -> verify released table is reassigned
    const sessNext = 'sess_test3_next_' + Date.now();
    const nextAssign = await post('/api/tables/auto-assign-takeaway', {
      sessionId: sessNext,
      customerName: 'NewCust',
      pax: 1
    });
    const nextTableNo = nextAssign.data?.table?.tableNo;

    const passed = (
      statusBefore === 1 &&
      entryStatusBefore === 'q' &&
      releaseRes.data?.success === true &&
      releaseRes.data?.releasedCount === 1 &&
      statusAfter === 0 &&
      entryStatusAfter === null &&
      lockedByAfter === null &&
      posTable?.Status === 0 &&
      nextTableNo === tNo
    );

    record(
      'Test 3: Logout and Table Release',
      '1. Scan and reserve table. 2. Verify Status=1 in DB. 3. Log out (release-takeaway). 4. Verify Status=0 in DB and POS API. 5. Scan with new customer and verify re-assignment.',
      'Unused table is released on logout, Status becomes 0, and table is immediately re-assignable to a new customer.',
      passed
        ? `Table ${tNo} was Status 1 ('q'), released to Status 0 (null), POS API reported Status 0, and next customer was assigned ${nextTableNo}.`
        : `Release failed: before=${statusBefore}, after=${statusAfter}, releasedCount=${releaseRes.data?.releasedCount}, next=${nextTableNo}`,
      passed,
      {
        tableNo: tNo,
        statusBefore,
        entryStatusBefore,
        releaseResponse: releaseRes.data,
        statusAfter,
        entryStatusAfter,
        posApiStatus: posTable?.Status,
        nextCustomerTable: nextTableNo
      }
    );

    // Clean up
    if (nextTableNo) {
      await post('/api/tables/release-takeaway', { sessionId: sessNext, tableNo: nextTableNo });
    }
  } catch (err) {
    record('Test 3: Logout and Table Release', 'Run logout test', 'Success', `Error: ${err.message}`, false);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Active Order Protection
  // ─────────────────────────────────────────────────────────────
  try {
    const sess4 = 'sess_test4_' + Date.now();
    // 1. Assign table
    const assignRes = await post('/api/tables/auto-assign-takeaway', {
      sessionId: sess4,
      customerName: 'Protected',
      pax: 1
    });
    const tNo = assignRes.data.table.tableNo;
    const tId = assignRes.data.table.tableId;

    // Find a valid active dish from DishMaster
    const dishQuery = await pool.request().query(`
      SELECT TOP 1 DishId, Name as DishName, currentcost as Price FROM DishMaster WHERE IsActive = 1 ORDER BY currentcost DESC
    `);
    const dish = dishQuery.recordset[0] || { DishId: '1', DishName: 'Test Food', Price: 5.00 };

    // 2. Send order to kitchen
    const sendRes = await post('/api/orders/send', {
      tableId: tId,
      orderType: 'TAKEAWAY',
      takeawayNo: tNo,
      entryStatus: 'q',
      customerName: 'Protected',
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

    const orderId = sendRes.data?.orderId;

    // 3. Complete payment status -> Paid (paymentStatus: 1)
    await post('/api/orders/payment-status', {
      tableId: tId,
      paymentStatus: 1,
      payMode: 'Cash Test',
      orderId: orderId
    });

    // 4. Verify order in DB before release attempt
    const orderInDb = await pool.request()
      .input('oid', sql.NVarChar(50), String(orderId))
      .query(`
        SELECT roc.OrderId, roc.OrderNumber, roc.Tableno, roc.isOrderClosed, roc.TotalAmount,
               (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = roc.OrderId AND d.StatusCode <> 0) as ItemCount
        FROM RestaurantOrderCur roc
        WHERE roc.OrderNumber = @oid
      `);

    const activeOrder = orderInDb.recordset[0];

    // 5. Customer attempts to log out / release-takeaway
    const releaseAttempt = await post('/api/tables/release-takeaway', {
      sessionId: sess4,
      tableId: tId,
      tableNo: tNo
    });

    // 6. Check TableMaster status
    const tableMasterAfter = await pool.request()
      .input('tno', sql.NVarChar(50), tNo)
      .query(`
        SELECT TableNumber, Status, entry_status, CustomerName, CurrentOrderId, TotalAmount, PAYMENT_STATUS
        FROM TableMaster WHERE TableNumber = @tno
      `);
    const tblAfter = tableMasterAfter.recordset[0];

    const passed = (
      orderId &&
      activeOrder &&
      (activeOrder.isOrderClosed === 0 || activeOrder.isOrderClosed === false) &&
      releaseAttempt.data?.releasedCount === 0 &&
      tblAfter.Status === 1 &&
      tblAfter.entry_status === 'q' &&
      tblAfter.CustomerName === 'Protected' &&
      Number(tblAfter.TotalAmount) > 0
    );

    record(
      'Test 4: Active Order Protection',
      '1. Reserve table. 2. Place & send active order. 3. Mark paid. 4. Attempt release-takeaway. 5. Confirm release is skipped and table/order data is preserved.',
      'Table with active unclosed order is protected against release; releaseCount=0; Status=1 and order data remain untouched.',
      passed
        ? `Protection verified. Order #${orderId} active. release-takeaway skipped (releasedCount=0). Table ${tNo} remains Status=1 with TotalAmount=${tblAfter.TotalAmount}.`
        : `Protection failure: releasedCount=${releaseAttempt.data?.releasedCount}, Status=${tblAfter?.Status}`,
      passed,
      {
        tableNo: tNo,
        orderId,
        activeOrderInDb: activeOrder,
        releaseAttemptResult: releaseAttempt.data,
        tableMasterAfter: tblAfter
      }
    );

    // Clean up test order safely by closing it
    await pool.request()
      .input('oid', sql.NVarChar(50), String(orderId))
      .query(`
        UPDATE RestaurantOrderCur SET isOrderClosed = 1, ModifiedOn = GETDATE()
        WHERE OrderNumber = @oid;
        UPDATE RestaurantOrderDetailCur SET StatusCode = 4 
        WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @oid);
      `);
    // Now that order is closed, release table
    await post('/api/tables/release-takeaway', { sessionId: sess4, tableId: tId, tableNo: tNo });
  } catch (err) {
    record('Test 4: Active Order Protection', 'Run active order test', 'Success', `Error: ${err.message}`, false);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 5: Session Expiration and Abandoned Sessions
  // ─────────────────────────────────────────────────────────────
  try {
    const sess5 = 'sess_test5_abandon_' + Date.now();
    // 1. Assign table
    const assignRes = await post('/api/tables/auto-assign-takeaway', {
      sessionId: sess5,
      customerName: 'Abandon',
      pax: 1
    });
    const tNo = assignRes.data.table.tableNo;
    const tId = assignRes.data.table.tableId;

    // Verify initial assignment
    const initCheck = await pool.request().query(`
      SELECT Status, entry_status, CustomerName FROM TableMaster WHERE TableNumber = '${tNo}'
    `);
    const initStatus = initCheck.recordset[0]?.Status;

    // 2. Simulate 16 minutes of inactivity by backdating StartTime and ModifiedOn
    await pool.request().query(`
      UPDATE TableMaster
      SET StartTime = DATEADD(MINUTE, -16, GETDATE()),
          ModifiedOn = DATEADD(MINUTE, -16, GETDATE())
      WHERE TableNumber = '${tNo}';
    `);

    // 3. Call GET /api/tables/all?section=TAKEAWAY (triggers auto-reconcile for idle >15m)
    await get('/api/tables/all?section=TAKEAWAY');

    // 4. Verify abandoned table is cleared in DB
    const afterExpire = await pool.request().query(`
      SELECT Status, entry_status, CustomerName, TotalAmount, LockedByName
      FROM TableMaster WHERE TableNumber = '${tNo}'
    `);
    const expiredStatus = afterExpire.recordset[0]?.Status;

    // 5. Ensure existing active orders (TW1 / TW2) were NOT cleared by the cleanup process
    const activeOrdersCheck = await pool.request().query(`
      SELECT TableNumber, Status, TotalAmount, CurrentOrderId
      FROM TableMaster WHERE TableNumber IN ('TW1', 'TW2')
    `);

    const tw1 = activeOrdersCheck.recordset.find(r => r.TableNumber === 'TW1');
    const tw2 = activeOrdersCheck.recordset.find(r => r.TableNumber === 'TW2');

    const passed = (
      initStatus === 1 &&
      expiredStatus === 0 &&
      tw1 && tw1.Status === 1 && Number(tw1.TotalAmount) > 0 &&
      tw2 && tw2.Status === 1 && Number(tw2.TotalAmount) > 0
    );

    record(
      'Test 5: Session Expiration and Abandoned Sessions',
      '1. Assign table. 2. Backdate StartTime/ModifiedOn >15m. 3. Call GET /api/tables/all to trigger reconcile. 4. Verify abandoned table becomes Status=0. 5. Confirm TW1 & TW2 active orders unaffected.',
      'Abandoned idle reservations (>15 mins with no order) are safely auto-released; active customer orders are never cleared.',
      passed
        ? `Abandoned table ${tNo} auto-released to Status 0. Active tables TW1 ($${tw1.TotalAmount}) and TW2 ($${tw2.TotalAmount}) remained intact.`
        : `Expiration check failed: init=${initStatus}, expired=${expiredStatus}`,
      passed,
      {
        tableNo: tNo,
        initialStatus: initStatus,
        statusAfterExpirationReconcile: expiredStatus,
        activeOrdersPreserved: {
          TW1: { status: tw1?.Status, total: tw1?.TotalAmount, orderId: tw1?.CurrentOrderId },
          TW2: { status: tw2?.Status, total: tw2?.TotalAmount, orderId: tw2?.CurrentOrderId }
        }
      }
    );
  } catch (err) {
    record('Test 5: Session Expiration and Abandoned Sessions', 'Run expiration test', 'Success', `Error: ${err.message}`, false);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 6: Regression Testing
  // ─────────────────────────────────────────────────────────────
  try {
    // 1. Check cart endpoint
    const cartRes = await get('/api/orders/cart/TW1');
    const cartOk = cartRes.status === 200;

    // 2. Check tables API
    const tablesRes = await get('/api/tables/all?section=TAKEAWAY');
    const tablesOk = tablesRes.status === 200 && Array.isArray(tablesRes.data);

    // 3. Check public menu API and company settings
    const menuRes = await get('/api/menu/kitchens');
    const menuOk = menuRes.status === 200;
    const settingsRes = await get('/api/company-settings/1');
    const settingsOk = settingsRes.status === 200;

    // 4. Verify production web build files exist
    const fs = require('fs');
    const path = require('path');
    const distPath = path.resolve(__dirname, '../backend/dist');
    const menuHtmlExists = fs.existsSync(path.join(distPath, 'qr-takeaway/menu.html'));
    const orderStatusHtmlExists = fs.existsSync(path.join(distPath, 'qr-takeaway/order-status.html'));
    const indexHtmlExists = fs.existsSync(path.join(distPath, 'index.html'));
    const webBuildOk = menuHtmlExists && orderStatusHtmlExists && indexHtmlExists;

    // 5. Check real-time table status query
    const tableMasterOk = await pool.request().query(`
      SELECT COUNT(*) as cnt FROM TableMaster WHERE DiningSection = '4' AND Status = 1
    `);
    const occupiedCount = tableMasterOk.recordset[0]?.cnt;

    const passed = (cartOk && tablesOk && menuOk && settingsOk && webBuildOk && occupiedCount >= 2);

    record(
      'Test 6: Regression Testing',
      '1. Verify /api/orders/cart/:tableId. 2. Verify /api/tables/all. 3. Verify /api/menu/kitchens. 4. Verify /api/company-settings/1. 5. Verify production web build. 6. Verify active Section 4 tables.',
      'All endpoints, web bundles, KDS/POS queries, and table operations function smoothly without regressions.',
      passed
        ? `Cart API (HTTP ${cartRes.status}), Tables API (HTTP ${tablesRes.status}, ${tablesRes.data.length} tables), Menu API (HTTP ${menuRes.status}), Settings API (HTTP ${settingsRes.status}), Web build files present, Active Section 4 tables: ${occupiedCount}.`
        : `Regression failure detected.`,
      passed,
      {
        cartApiStatus: cartRes.status,
        tablesApiStatus: tablesRes.status,
        tablesCount: tablesRes.data?.length,
        menuApiStatus: menuRes.status,
        settingsApiStatus: settingsRes.status,
        webBuildFiles: { menuHtmlExists, orderStatusHtmlExists, indexHtmlExists },
        section4OccupiedCount: occupiedCount
      }
    );
  } catch (err) {
    record('Test 6: Regression Testing', 'Run regression tests', 'Success', `Error: ${err.message}`, false);
  }

  // Final Summary Output
  console.log('\n==================================================');
  console.log('🏁 FINAL TEST SUITE RESULTS:');
  console.log('==================================================');
  const allPassed = results.every(r => r.passed);
  results.forEach((r, idx) => {
    console.log(`${idx + 1}. [${r.passed ? 'PASS' : 'FAIL'}] ${r.name}`);
  });
  console.log(`\nOVERALL: ${allPassed ? 'ALL TESTS PASSED ✅' : 'SOME TESTS FAILED ❌'}`);
  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch(e => {
  console.error('Test execution fatal error:', e);
  process.exit(1);
});
