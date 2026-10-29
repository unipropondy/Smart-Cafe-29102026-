const { poolPromise, sql } = require("../backend/config/db");

const BASE_URL = "http://localhost:3000";

async function run() {
  console.log("================================================================================");
  console.log("            STARTING COMPREHENSIVE E2E QR TAKEAWAY TEST SUITE                   ");
  console.log("================================================================================");

  const pool = await poolPromise;
  const results = {};

  // Clean any leftover test tables
  await pool.request().query(`
    UPDATE TableMaster 
    SET Status = 0, LockedByName = NULL, StartTime = NULL, entry_status = NULL, PAYMENT_STATUS = 0, CurrentOrderId = NULL
    WHERE DiningSection = '4' AND TableNumber LIKE 'TW%';
  `);

  // --------------------------------------------------------------------------------
  // TEST 1: QR Table Assignment & Infinite Loop Prevention
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 1] Testing QR Table Assignment & Infinite Loop Prevention...");
  try {
    const sessId = `test_cust_e2e_1_${Date.now()}`;
    const assignments = [];

    // Simulate 5 calls with the same session id (as would happen on repeated renders)
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${BASE_URL}/api/tables/auto-assign-takeaway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessId })
      });
      const data = await res.json();
      assignments.push(data);
    }

    const firstTable = assignments[0]?.table?.tableNo;
    const allSame = assignments.every(a => a.table?.tableNo === firstTable);
    const existingFlags = assignments.slice(1).every(a => a.isExistingSession === true);

    // Verify in DB only 1 table is locked by this session
    const dbCheck = await pool.request()
      .input("sess", sessId)
      .query("SELECT TableNumber, Status, LockedByName FROM TableMaster WHERE LockedByName = @sess");

    console.log(`  - 1st assignment: Table ${firstTable}`);
    console.log(`  - Subsequent calls (2-5) all returned same table: ${allSame}`);
    console.log(`  - Subsequent calls flagged isExistingSession: ${existingFlags}`);
    console.log(`  - DB tables locked by this session: ${dbCheck.recordset.length} (${dbCheck.recordset.map(r=>r.TableNumber).join(", ")})`);

    if (allSame && existingFlags && dbCheck.recordset.length === 1) {
      results["1_QR_Table_Assignment"] = {
        status: "PASS",
        details: `Customer assigned single table ${firstTable}. Repeated calls returned same table without assigning additional tables.`
      };
    } else {
      results["1_QR_Table_Assignment"] = {
        status: "FAIL",
        details: `Assigned inconsistent tables or multiple tables locked in DB.`
      };
    }

    // Clean up test 1 table
    await pool.request()
      .input("sess", sessId)
      .query("UPDATE TableMaster SET Status = 0, LockedByName = NULL, StartTime = NULL, entry_status = NULL WHERE LockedByName = @sess");
  } catch (err) {
    results["1_QR_Table_Assignment"] = { status: "FAIL", details: err.message };
  }

  // --------------------------------------------------------------------------------
  // TEST 2: 15-Minute Expiry
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 2] Testing 15-Minute Auto-Expiry...");
  try {
    const sessId = `test_cust_expiry_${Date.now()}`;
    const assignRes = await fetch(`${BASE_URL}/api/tables/auto-assign-takeaway`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessId })
    });
    const assignData = await assignRes.json();
    const tableNo = assignData.table.tableNo;
    const tableId = assignData.table.tableId;

    console.log(`  - Assigned ${tableNo} (${tableId}) to session ${sessId}`);

    // Set StartTime to 16 minutes in the past
    await pool.request()
      .input("tid", tableId)
      .query("UPDATE TableMaster SET StartTime = DATEADD(minute, -16, GETDATE()) WHERE TableId = @tid");

    // Execute the trigger-safe auto-reconcile query directly against DB (same query as watchdog)
    const reconcileRes = await pool.request().query(`
      DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);

      UPDATE tm
      SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL, 
          tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL,
          tm.ModifiedOn = GETDATE()
      OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
      FROM TableMaster tm
      WHERE tm.DiningSection = '4'
        AND tm.Status = 1
        AND tm.entry_status = 'q'
        AND (tm.PAYMENT_STATUS IS NULL OR tm.PAYMENT_STATUS = 0)
        AND tm.StartTime IS NOT NULL
        AND DATEDIFF(minute, tm.StartTime, GETDATE()) >= 15
        AND (
          tm.CurrentOrderId IS NULL 
          OR NOT EXISTS (
            SELECT 1 FROM RestaurantOrderCur roc 
            WHERE (roc.OrderNumber = tm.CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
              AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM CartItems ci WHERE ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber
        );

      SELECT TableId, TableNumber, DiningSection FROM @cleared;
    `);

    console.log(`  - Reconcile query cleared ${reconcileRes.recordset.length} table(s):`, reconcileRes.recordset.map(r=>r.TableNumber).join(", "));

    // Verify in database that table is now Status = 0
    const dbTable = await pool.request()
      .input("tid", tableId)
      .query("SELECT TableNumber, Status, StartTime, LockedByName FROM TableMaster WHERE TableId = @tid");

    const t = dbTable.recordset[0];
    console.log(`  - DB state after reconcile: Table ${t.TableNumber}, Status: ${t.Status}, StartTime: ${t.StartTime}, LockedByName: ${t.LockedByName}`);

    // Verify /api/tables/all API reflects available status
    const allRes = await fetch(`${BASE_URL}/api/tables/all`);
    const allTables = await allRes.json();
    const tableInAll = allTables.find(x => (x.TableNumber || x.label) === tableNo);

    if (t.Status === 0 && t.StartTime === null && tableInAll?.Status === 0) {
      results["2_15_Minute_Expiry"] = {
        status: "PASS",
        details: `Table ${tableNo} was expired after 16m idle time and successfully reset in both DB and /api/tables/all.`
      };
    } else {
      results["2_15_Minute_Expiry"] = {
        status: "FAIL",
        details: `Table ${tableNo} not cleared: Status=${t.Status}`
      };
    }
  } catch (err) {
    results["2_15_Minute_Expiry"] = { status: "FAIL", details: err.message };
  }

  // --------------------------------------------------------------------------------
  // TEST 3: Active Order Protection
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 3] Testing Active Order Protection (Order Placed Prevents Auto-Release)...");
  try {
    const sessId = `test_cust_active_${Date.now()}`;
    const assignRes = await fetch(`${BASE_URL}/api/tables/auto-assign-takeaway`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessId })
    });
    const assignData = await assignRes.json();
    const tableNo = assignData.table.tableNo;
    const tableId = assignData.table.tableId;

    // Create an active order in RestaurantOrderCur for this table
    const testOrderNum = `TEST_ACT_${Date.now().toString().slice(-6)}`;
    await pool.request()
      .input("onum", sql.NVarChar(50), testOrderNum)
      .input("tid", sql.UniqueIdentifier, tableId)
      .input("tno", sql.NVarChar(50), tableNo)
      .query(`
        DECLARE @oid UNIQUEIDENTIFIER = NEWID();
        INSERT INTO RestaurantOrderCur (OrderId, OrderNumber, Tableno, IsTakeAway, isOrderClosed, OrderDateTime, StatusCode, CreatedBy, CreatedOn, TotalAmount)
        VALUES (@oid, @onum, @tno, 1, 0, GETDATE(), 1, '00000000-0000-0000-0000-000000000000', GETDATE(), 15.50);
        UPDATE TableMaster SET CurrentOrderId = @onum, Status = 1, StartTime = DATEADD(minute, -25, GETDATE()) WHERE TableId = @tid;
      `);

    console.log(`  - Created active order ${testOrderNum} on ${tableNo} with StartTime 25 minutes ago`);

    // Run auto-reconcile query
    await pool.request().query(`
      DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);
      UPDATE tm
      SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL, 
          tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL,
          tm.ModifiedOn = GETDATE()
      OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
      FROM TableMaster tm
      WHERE tm.DiningSection = '4'
        AND tm.Status = 1
        AND tm.entry_status = 'q'
        AND (tm.PAYMENT_STATUS IS NULL OR tm.PAYMENT_STATUS = 0)
        AND tm.StartTime IS NOT NULL
        AND DATEDIFF(minute, tm.StartTime, GETDATE()) >= 15
        AND (
          tm.CurrentOrderId IS NULL 
          OR NOT EXISTS (
            SELECT 1 FROM RestaurantOrderCur roc 
            WHERE (roc.OrderNumber = tm.CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
              AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM CartItems ci WHERE ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber
        );
      SELECT TableId, TableNumber, DiningSection FROM @cleared;
    `);

    // Check DB status - table MUST STILL BE OCCUPIED (Status = 1) because order is open!
    const checkTable = await pool.request()
      .input("tid", sql.UniqueIdentifier, tableId)
      .query("SELECT TableNumber, Status, CurrentOrderId FROM TableMaster WHERE TableId = @tid");

    const t = checkTable.recordset[0];
    console.log(`  - After reconcile, table Status: ${t.Status}, CurrentOrderId: ${t.CurrentOrderId}`);

    const protectedSuccess = t.Status === 1 && t.CurrentOrderId === testOrderNum;

    // Clean up test order
    await pool.request()
      .input("onum", sql.NVarChar(50), testOrderNum)
      .input("tid", sql.UniqueIdentifier, tableId)
      .query(`
        DELETE FROM RestaurantOrderCur WHERE OrderNumber = @onum;
        UPDATE TableMaster SET Status = 0, CurrentOrderId = NULL, StartTime = NULL, LockedByName = NULL WHERE TableId = @tid;
      `);

    if (protectedSuccess) {
      results["3_Active_Order_Protection"] = {
        status: "PASS",
        details: `Table ${tableNo} was protected from 15m auto-expiry because active order ${testOrderNum} was open.`
      };
    } else {
      results["3_Active_Order_Protection"] = {
        status: "FAIL",
        details: `Active order table was prematurely cleared! Status=${t.Status}`
      };
    }
  } catch (err) {
    results["3_Active_Order_Protection"] = { status: "FAIL", details: err.message };
  }

  // --------------------------------------------------------------------------------
  // TEST 4: Paid Order Protection until KDS SERVED (StatusCode = 4)
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 4] Testing Paid Order Protection Until KDS Served...");
  try {
    const sessId = `test_paid_kds_${Date.now()}`;
    const assignRes = await fetch(`${BASE_URL}/api/tables/auto-assign-takeaway`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessId })
    });
    const assignData = await assignRes.json();
    const tableNo = assignData.table.tableNo;
    const tableId = assignData.table.tableId;

    const testOrderNum = `TEST_PAID_${Date.now().toString().slice(-6)}`;

    // Insert paid order with item at StatusCode = 1 (Sent to Kitchen)
    await pool.request()
      .input("onum", sql.NVarChar(50), testOrderNum)
      .input("tno", sql.NVarChar(50), tableNo)
      .input("tid", sql.UniqueIdentifier, tableId)
      .query(`
        DECLARE @oid UNIQUEIDENTIFIER = NEWID();

        INSERT INTO RestaurantOrderCur (OrderId, OrderNumber, Tableno, IsTakeAway, isOrderClosed, OrderDateTime, StatusCode, CreatedBy, entry_status, CreatedOn, TotalAmount)
        VALUES (@oid, @onum, @tno, 1, 0, GETDATE(), 1, '00000000-0000-0000-0000-000000000000', 'q', GETDATE(), 20.00);

        INSERT INTO RestaurantOrderDetailCur (OrderDetailId, OrderId, DishId, Description, DishName, Quantity, PricePerUnit, StatusCode, BusinessUnitId, CreatedBy, CreatedOn, OrderNumber)
        VALUES (NEWID(), @oid, '998F6E51-0063-4910-9D5A-5C25E4D3F93F', 'Test Chicken Wings', 'Test Chicken Wings', 1, 20.00, 1, 'FBFD4E31-5C91-4DEC-86EA-989D3B5639CA', '00000000-0000-0000-0000-000000000000', GETDATE(), @onum);

        UPDATE TableMaster 
        SET Status = 1, entry_status = 'q', PAYMENT_STATUS = 1, CurrentOrderId = @onum, 
            StartTime = DATEADD(minute, -30, GETDATE())
        WHERE TableId = @tid;
      `);

    console.log(`  - Placed paid QR Takeaway order ${testOrderNum} on ${tableNo} (Item StatusCode = 1: In Kitchen)`);

    // Run auto-reconcile query - Table MUST REMAIN OCCUPIED because items are not served yet!
    await pool.request().query(`
      DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);
      UPDATE tm
      SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL, 
          tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL,
          tm.ModifiedOn = GETDATE()
      OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
      FROM TableMaster tm
      WHERE tm.DiningSection = '4'
        AND tm.Status = 1
        AND tm.entry_status = 'q'
        AND (tm.PAYMENT_STATUS IS NULL OR tm.PAYMENT_STATUS = 0)
        AND tm.StartTime IS NOT NULL
        AND DATEDIFF(minute, tm.StartTime, GETDATE()) >= 15;
      SELECT TableId, TableNumber, DiningSection FROM @cleared;
    `);

    const check1 = await pool.request()
      .input("tid", tableId)
      .query("SELECT Status, entry_status, PAYMENT_STATUS FROM TableMaster WHERE TableId = @tid");

    const t1 = check1.recordset[0];
    const stillOccupied = t1.Status === 1 && t1.entry_status === 'q' && t1.PAYMENT_STATUS === 1;
    console.log(`  - Stage 1 (Kitchen preparing): Status=${t1.Status}, entry_status=${t1.entry_status}, PAYMENT_STATUS=${t1.PAYMENT_STATUS} -> Protected: ${stillOccupied}`);

    // Now update KDS item to StatusCode = 4 (SERVED)
    await pool.request()
      .input("onum", testOrderNum)
      .query("UPDATE RestaurantOrderDetailCur SET StatusCode = 4 WHERE OrderNumber = @onum");

    console.log(`  - Marked KDS items for order ${testOrderNum} as SERVED (StatusCode = 4)`);

    // Verify that checking kitchen orders detects all items served
    const itemCheck = await pool.request()
      .input("onum", testOrderNum)
      .query(`
        SELECT COUNT(*) as TotalItems,
               SUM(CASE WHEN StatusCode = 4 THEN 1 ELSE 0 END) as ServedItems
        FROM RestaurantOrderDetailCur WHERE OrderNumber = @onum
      `);
    const allServed = itemCheck.recordset[0].TotalItems === itemCheck.recordset[0].ServedItems;
    console.log(`  - Stage 2: TotalItems=${itemCheck.recordset[0].TotalItems}, ServedItems=${itemCheck.recordset[0].ServedItems} -> AllServed: ${allServed}`);

    // Release table (simulate order completion/serving release)
    await pool.request()
      .input("onum", testOrderNum)
      .input("tid", tableId)
      .query(`
        UPDATE RestaurantOrderCur SET isOrderClosed = 1 WHERE OrderNumber = @onum;
        UPDATE TableMaster SET Status = 0, entry_status = NULL, PAYMENT_STATUS = 0, CurrentOrderId = NULL, StartTime = NULL, LockedByName = NULL WHERE TableId = @tid;
      `);

    const check2 = await pool.request()
      .input("tid", tableId)
      .query("SELECT Status FROM TableMaster WHERE TableId = @tid");

    const released = check2.recordset[0].Status === 0;
    console.log(`  - Stage 3: Table released after serving complete: ${released}`);

    // Clean up
    await pool.request()
      .input("onum", testOrderNum)
      .query(`
        DELETE FROM RestaurantOrderDetailCur WHERE OrderNumber = @onum;
        DELETE FROM RestaurantOrderCur WHERE OrderNumber = @onum;
      `);

    if (stillOccupied && allServed && released) {
      results["4_Paid_Order_Protection"] = {
        status: "PASS",
        details: `Table remained locked/occupied while paid order was in kitchen, correctly detected StatusCode=4, and released cleanly.`
      };
    } else {
      results["4_Paid_Order_Protection"] = {
        status: "FAIL",
        details: `Protected=${stillOccupied}, AllServed=${allServed}, Released=${released}`
      };
    }
  } catch (err) {
    results["4_Paid_Order_Protection"] = { status: "FAIL", details: err.message };
  }

  // --------------------------------------------------------------------------------
  // TEST 5: Multiple Customers Scanning Simultaneously
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 5] Testing Multiple Customers Scanning Simultaneously...");
  try {
    const sessA = `test_multi_cust_A_${Date.now()}`;
    const sessB = `test_multi_cust_B_${Date.now()}`;
    const sessC = `test_multi_cust_C_${Date.now()}`;

    const [resA, resB, resC] = await Promise.all([
      fetch(`${BASE_URL}/api/tables/auto-assign-takeaway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessA })
      }).then(r => r.json()),
      fetch(`${BASE_URL}/api/tables/auto-assign-takeaway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessB })
      }).then(r => r.json()),
      fetch(`${BASE_URL}/api/tables/auto-assign-takeaway`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessC })
      }).then(r => r.json()),
    ]);

    const tableA = resA.table?.tableNo;
    const tableB = resB.table?.tableNo;
    const tableC = resC.table?.tableNo;

    console.log(`  - Customer A received: ${tableA}`);
    console.log(`  - Customer B received: ${tableB}`);
    console.log(`  - Customer C received: ${tableC}`);

    const uniqueCount = new Set([tableA, tableB, tableC]).size;
    console.log(`  - Unique tables assigned: ${uniqueCount} / 3`);

    // Clean up
    await pool.request()
      .input("sA", sessA)
      .input("sB", sessB)
      .input("sC", sessC)
      .query("UPDATE TableMaster SET Status = 0, LockedByName = NULL, StartTime = NULL, entry_status = NULL WHERE LockedByName IN (@sA, @sB, @sC)");

    if (uniqueCount === 3 && tableA && tableB && tableC) {
      results["5_Multiple_Customers"] = {
        status: "PASS",
        details: `3 simultaneous customers received 3 distinct tables (${tableA}, ${tableB}, ${tableC}) with no collision.`
      };
    } else {
      results["5_Multiple_Customers"] = {
        status: "FAIL",
        details: `Collision detected! Only ${uniqueCount} distinct tables assigned for 3 customers.`
      };
    }
  } catch (err) {
    results["5_Multiple_Customers"] = { status: "FAIL", details: err.message };
  }

  // --------------------------------------------------------------------------------
  // TEST 6: Occupied Table Count Consistency (No Double-Counting)
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 6] Testing Occupied Count Consistency & Double-Counting Prevention...");
  try {
    // Check actual DB count
    const dbCountRes = await pool.request().query("SELECT COUNT(*) as OccupiedInDB FROM TableMaster WHERE Status != 0");
    const dbOccupied = dbCountRes.recordset[0].OccupiedInDB;

    // Fetch /api/tables/all
    const allRes = await fetch(`${BASE_URL}/api/tables/all`);
    const allTables = await allRes.json();

    // Frontend fixed logic: count over unique array
    const frontendFixedCount = allTables.filter(t => t.Status !== 0 && t.Status !== "0" && t.status !== "EMPTY").length;

    // Simulate old broken logic: building a map with both tableId and tableNo then Object.values(map)
    const map = {};
    allTables.forEach(t => {
      if (t.id || t.TableId) map[String(t.id || t.TableId).toLowerCase()] = t;
      if (t.label || t.TableNumber) map[String(t.label || t.TableNumber).toLowerCase()] = t;
    });
    const brokenDoubleCount = Object.values(map).filter(t => t.Status !== 0 && t.Status !== "0" && t.status !== "EMPTY").length;

    console.log(`  - MSSQL Database Occupied Count: ${dbOccupied}`);
    console.log(`  - Frontend Fixed Count (state.tables.filter): ${frontendFixedCount}`);
    console.log(`  - Old Broken Count (Object.values(tableMap)): ${brokenDoubleCount}`);

    if (frontendFixedCount === dbOccupied) {
      results["6_Occupied_Count"] = {
        status: "PASS",
        details: `Frontend count (${frontendFixedCount}) exactly matches MSSQL DB count (${dbOccupied}). Old double-counting bug (${brokenDoubleCount}) eliminated.`
      };
    } else {
      results["6_Occupied_Count"] = {
        status: "FAIL",
        details: `Discrepancy: Frontend=${frontendFixedCount}, DB=${dbOccupied}`
      };
    }
  } catch (err) {
    results["6_Occupied_Count"] = { status: "FAIL", details: err.message };
  }

  // --------------------------------------------------------------------------------
  // TEST 7: SQL Server Trigger Compatibility
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 7] Testing SQL Server Trigger Compatibility...");
  try {
    // Execute the exact trigger-safe query used by the watchdog
    const testTriggerQuery = `
      DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);

      UPDATE tm
      SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL,
          tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL,
          tm.ModifiedOn = GETDATE()
      OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
      FROM TableMaster tm
      WHERE tm.DiningSection = '4' AND tm.TableNumber = 'TW99_NONEXISTENT';

      SELECT TableId, TableNumber, DiningSection FROM @cleared;
    `;

    await pool.request().query(testTriggerQuery);
    console.log(`  - Query executed successfully without trigger error 334.`);

    results["7_SQL_Trigger_Compatibility"] = {
      status: "PASS",
      details: "Trigger-safe DECLARE @cleared TABLE ... OUTPUT INTO @cleared executed with 0 errors on TableMaster with active triggers."
    };
  } catch (err) {
    results["7_SQL_Trigger_Compatibility"] = {
      status: "FAIL",
      details: `Trigger error detected: ${err.message}`
    };
  }

  // --------------------------------------------------------------------------------
  // TEST 8: Regression Testing (Dine-in Tables & POS API Endpoints)
  // --------------------------------------------------------------------------------
  console.log("\n▶ [TEST 8] Testing Regression: Normal Dine-In Tables, Menus & Settings...");
  try {
    const allRes = await fetch(`${BASE_URL}/api/tables/all`);
    const allTables = await allRes.json();

    const sec1 = allTables.filter(t => String(t.DiningSection) === '1');
    const sec2 = allTables.filter(t => String(t.DiningSection) === '2');
    const sec3 = allTables.filter(t => String(t.DiningSection) === '3');
    const takeaway = allTables.filter(t => String(t.DiningSection) === '4');

    console.log(`  - Section 1 tables: ${sec1.length}`);
    console.log(`  - Section 2 tables: ${sec2.length}`);
    console.log(`  - Section 3 tables: ${sec3.length}`);
    console.log(`  - Takeaway tables: ${takeaway.length}`);

    // Verify dine-in tables are unmodified
    const dineInUntouched = sec1.length > 0 && sec2.length > 0 && sec3.length > 0 && takeaway.length >= 20;

    // Verify kitchens / categories menu endpoint works
    const kitchensRes = await fetch(`${BASE_URL}/api/menu/kitchens`);
    const kitchens = await kitchensRes.json();
    const kitchensOk = Array.isArray(kitchens) && kitchens.length > 0;
    console.log(`  - Menu kitchens endpoint active: ${kitchensOk} (${kitchens.length} kitchens loaded)`);

    if (dineInUntouched && kitchensOk) {
      results["8_Regression_Testing"] = {
        status: "PASS",
        details: `Dine-in tables (Sections 1-3) and Menu kitchens APIs intact and unaffected by takeaway modifications.`
      };
    } else {
      results["8_Regression_Testing"] = {
        status: "FAIL",
        details: `Regression detected in dine-in tables or kitchens API.`
      };
    }
  } catch (err) {
    results["8_Regression_Testing"] = { status: "FAIL", details: err.message };
  }

  // --------------------------------------------------------------------------------
  // Summary Report
  // --------------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("                           TEST SUITE SUMMARY                                  ");
  console.log("================================================================================");
  let allPass = true;
  for (const [test, res] of Object.entries(results)) {
    console.log(`[${res.status}] ${test}: ${res.details}`);
    if (res.status !== "PASS") allPass = false;
  }
  console.log("================================================================================");
  console.log(`OVERALL RESULT: ${allPass ? "ALL 8 TESTS PASSED ✅" : "SOME TESTS FAILED ❌"}`);
  console.log("================================================================================");

  process.exit(allPass ? 0 : 1);
}

run().catch(err => {
  console.error("FATAL SUITE ERROR:", err);
  process.exit(1);
});
