const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { getHoldOvertimeMinutes } = require("../utils/settingsCache");

// In-memory table locks
const tableLocks = new Map();

// Clear old locks every minute (older than 30 mins)
setInterval(() => {
  const now = Date.now();
  for (const [tableId, lock] of tableLocks.entries()) {
    if (now - lock.lockedAt > 30 * 60 * 1000) {
      tableLocks.delete(tableId);
    }
  }
}, 60 * 1000);

/* ================= IN-MEMORY LOCKS ================= */
router.post("/lock", (req, res) => {
  const { tableId, userId } = req.body;
  if (!tableId || !userId) return res.status(400).json({ error: "Missing parameters" });

  const existingLock = tableLocks.get(tableId);
  if (existingLock && existingLock.lockedBy !== userId) {
    return res.status(409).json({
      success: false,
      message: "Table is heavily occupied by another user.",
      lockedBy: existingLock.lockedBy,
    });
  }

  tableLocks.set(tableId, { lockedBy: userId, lockedAt: Date.now() });
  res.json({ success: true });
});

router.post("/unlock", (req, res) => {
  const { tableId, userId } = req.body;
  const existingLock = tableLocks.get(tableId);
  if (existingLock && existingLock.lockedBy === userId) {
    tableLocks.delete(tableId);
  }
  res.json({ success: true });
});

router.get("/locks", (req, res) => {
  const locks = {};
  for (const [key, value] of tableLocks.entries()) {
    locks[key] = value.lockedBy;
  }
  res.json(locks);
});

/* ================= PERSISTENT TABLES ================= */
router.get("/all", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { section } = req.query;

    const SECTION_MAP = {
      SECTION_1: "1",
      SECTION_2: "2",
      SECTION_3: "3",
      TAKEAWAY: "4",
    };

    const holdMinutes = await getHoldOvertimeMinutes();

    // 🛡️ AUTO-RECONCILE: Clear ghost/stale tables whose orders are closed or fully paid
    // NOTE: Protect active Takeaway QR sessions (DiningSection 4, entry_status 'q') within 15 mins
    try {
      const reconcileResult = await pool.request().query(`
        DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);

        UPDATE tm
        SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL, tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL
        OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
        FROM TableMaster tm
        WHERE tm.Status IN (1, 2, 3, 4)
          -- 🛡️ DO NOT clear active Takeaway QR sessions (DiningSection 4) within active timeout (15 mins) with active session lock
          AND NOT (
            CAST(tm.DiningSection AS VARCHAR(10)) = '4' 
            AND tm.entry_status = 'q' 
            AND tm.LockedByName IS NOT NULL
            AND DATEDIFF(MINUTE, ISNULL(tm.StartTime, tm.ModifiedOn), GETDATE()) < 15
          )
          AND (
            (tm.CurrentOrderId IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM RestaurantOrderCur roc 
              WHERE (roc.OrderNumber = tm.CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
                AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
            ))
            OR
            (NOT EXISTS (
              SELECT 1 FROM CartItems ci WHERE ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber
            ) AND NOT EXISTS (
              SELECT 1 FROM RestaurantOrderCur roc 
              WHERE (roc.Tableno = tm.TableNumber OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
                AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
            ))
          );

        SELECT TableId, TableNumber, DiningSection FROM @cleared;
      `);

      if (reconcileResult.recordset && reconcileResult.recordset.length > 0) {
        const io = req.app.get("io");
        if (io) {
          const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
          reconcileResult.recordset.forEach((tbl) => {
            const cleanTid = String(tbl.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
            const secStr = sectionMap[String(tbl.DiningSection)] || "TAKEAWAY";
            io.emit("table_status_updated", {
              tableId: cleanTid,
              tableNo: tbl.TableNumber,
              section: secStr,
              status: 0,
              orderId: "EMPTY",
              totalAmount: 0,
              startTime: 0,
              entryStatus: null,
              paymentStatus: 0,
              customerName: null,
              pax: null,
            });
          });
          io.emit("tables_updated");
        }
      }
    } catch (reconcileErr) {
      console.warn("Table auto-reconciliation warning:", reconcileErr.message);
    }
    let query = `
      SELECT TableId AS id, CAST(TableNumber AS VARCHAR(50)) AS label,
      CAST(DiningSection AS VARCHAR(10)) AS DiningSection, LockedByName as lockedByName,
      Status, CONVERT(VARCHAR, StartTime, 126) as StartTime, ISNULL(TotalAmount, 0) as totalAmount, CurrentOrderId as currentOrderId,
      entry_status AS entryStatus, ISNULL(PAYMENT_STATUS, 0) AS paymentStatus, CustomerName as customerName, Pax as pax,
      TableType, Seats, XSize, YSize, XPos, YPos,
      CASE 
        WHEN Status IN (1, 2, 3) AND StartTime IS NOT NULL AND StartTime > '2000-01-01' AND DATEDIFF(MINUTE, StartTime, GETDATE()) >= 60 THEN 1 
        ELSE 0 
      END AS isOvertime,
      CASE 
        WHEN Status = 3 AND ModifiedOn IS NOT NULL AND DATEDIFF(MINUTE, ModifiedOn, GETDATE()) >= @holdMinutes THEN 1 
        ELSE 0 
      END AS isHoldOvertime,
      CONVERT(VARCHAR, ModifiedOn, 126) as ModifiedOn
      FROM TableMaster
    `;

    const request = pool.request().input("holdMinutes", sql.Int, holdMinutes);
    if (section && SECTION_MAP[section] !== undefined) {
      request.input("DiningSection", SECTION_MAP[section]);
      query += ` WHERE CAST(DiningSection AS VARCHAR(10)) = @DiningSection`;
    }
    query += ` ORDER BY SortCode`;

    const result = await request.query(query);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("TABLES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/locked", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TableId as tableId, TableNumber as tableNumber, DiningSection, LockedByName as lockedByName, Status as status
      FROM TableMaster WHERE Status = 5
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/lock-persistent", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { tableId, lockedByName } = req.body;
    const userId = req.body.userId || req.body.UserId || req.body.USERID;
    if (!tableId) return res.status(400).json({ error: "tableId is required" });

    const cleanTableId = tableId.replace(/^\{|\}$/g, "").trim();
    const request = pool.request(); // ✅ Fixed: request was not defined
    request.input("tableId", sql.VarChar(50), cleanTableId);
    request.input("lockedByName", sql.NVarChar, lockedByName || null);
    request.input("ModifiedBy", sql.UniqueIdentifier, userId || null);

    const result = await request.query(`
      DECLARE @temp TABLE (TableNumber NVARCHAR(50), DiningSection VARCHAR(10), ModifiedOn VARCHAR(50));

      UPDATE TableMaster 
      SET Status = 5, LockedByName = @lockedByName, TotalAmount = 0, StartTime = NULL, ModifiedBy = @ModifiedBy, ModifiedOn = GETDATE(), CustomerName = NULL, Pax = NULL
      OUTPUT INSERTED.TableNumber, INSERTED.DiningSection, CONVERT(VARCHAR, INSERTED.ModifiedOn, 126) AS ModifiedOn
      INTO @temp
      WHERE TableId = @tableId;

      SELECT * FROM @temp;
    `);

    // ✅ Clear CartItems for this table when locked
    await pool.request()
      .input("tableId", sql.VarChar(50), cleanTableId)
      .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @tableId");

    // 🔥 Emit socket event
    const io = req.app.get("io");
    if (io) {
      const row = result.recordset[0];
      const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
      io.emit("table_status_updated", { 
        tableId: cleanTableId, 
        status: 5, 
        totalAmount: 0, 
        startTime: null,
        lockedByName: lockedByName || null,
        customerName: null,
        pax: null,
        tableNo: row?.TableNumber,
        section: sectionMap[String(row?.DiningSection)] || row?.DiningSection,
        modifiedOn: row?.ModifiedOn
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/unlock-persistent", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { tableId } = req.body;
    const userId = req.body.userId || req.body.UserId || req.body.USERID;
    if (!tableId) return res.status(400).json({ error: "tableId is required" });

    const cleanTableId = tableId.replace(/^\{|\}$/g, "").trim();
    const result = await pool.request()
      .input("tableId", sql.VarChar(50), cleanTableId)
      .input("ModifiedBy", sql.UniqueIdentifier, userId || null)
      .query(`
        DECLARE @temp TABLE (TableNumber NVARCHAR(50), DiningSection VARCHAR(10), ModifiedOn VARCHAR(50));

        UPDATE TableMaster 
        SET Status = 0, entry_status = NULL, LockedByName = NULL, TotalAmount = 0, StartTime = NULL, ModifiedBy = @ModifiedBy, ModifiedOn = GETDATE(), CustomerName = NULL, Pax = NULL
        OUTPUT INSERTED.TableNumber, INSERTED.DiningSection, CONVERT(VARCHAR, INSERTED.ModifiedOn, 126) AS ModifiedOn
        INTO @temp
        WHERE TableId = @tableId;

        SELECT * FROM @temp;
      `);

    // ✅ Clear any items in CartItems for this table when unlocked
    await pool.request()
      .input("tableId", sql.VarChar(50), cleanTableId)
      .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @tableId");

    // 🔥 Emit socket event
    const io = req.app.get("io");
    if (io) {
      const row = result.recordset[0];
      const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
      io.emit("table_status_updated", { 
        tableId: cleanTableId, 
        status: 0, 
        totalAmount: 0,
        startTime: null,
        lockedByName: null,
        customerName: null,
        pax: null,
        tableNo: row?.TableNumber,
        section: sectionMap[String(row?.DiningSection)] || row?.DiningSection,
        modifiedOn: row?.ModifiedOn
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ New route: POST /api/tables/save-guest
router.post("/save-guest", async (req, res) => {
  const { tableId, customerName, pax } = req.body;
  const userId = req.body.userId || req.body.UserId || req.body.USERID;

  try {
    const pool = await poolPromise;
    if (!tableId) return res.status(400).json({ error: "tableId is required" });

    const cleanTableId = tableId.replace(/^\{|\}$/g, "").trim();
    const guestNameVal = customerName && customerName.trim() ? customerName.trim().substring(0, 9) : null;
    const paxVal = pax ? parseInt(pax) : null;

    const request = pool.request();
    request.input("tableId", sql.VarChar(50), cleanTableId);
    request.input("customerName", sql.NVarChar, guestNameVal);
    request.input("pax", sql.Int, paxVal);
    request.input("ModifiedBy", sql.UniqueIdentifier, userId || null);

    // Update TableMaster
    const updateTM = await request.query(`
      DECLARE @temp TABLE (
        TableNumber NVARCHAR(50), 
        DiningSection VARCHAR(10), 
        Status INT,
        TotalAmount DECIMAL(18, 2),
        StartTime VARCHAR(50),
        ModifiedOn VARCHAR(50),
        entryStatus VARCHAR(50)
      );

      UPDATE TableMaster
      SET CustomerName = @customerName,
          Pax = @pax,
          Status = CASE WHEN Status = 0 THEN 1 ELSE Status END,
          StartTime = CASE WHEN StartTime IS NULL THEN GETDATE() ELSE StartTime END,
          entry_status = CASE WHEN entry_status IS NULL THEN 'q' ELSE entry_status END,
          ModifiedBy = @ModifiedBy,
          ModifiedOn = GETDATE()
      OUTPUT 
        INSERTED.TableNumber, 
        INSERTED.DiningSection, 
        INSERTED.Status,
        INSERTED.TotalAmount,
        CONVERT(VARCHAR, INSERTED.StartTime, 126) AS StartTime,
        CONVERT(VARCHAR, INSERTED.ModifiedOn, 126) AS ModifiedOn,
        INSERTED.entry_status AS entryStatus
      INTO @temp
      WHERE TableId = @tableId;

      SELECT * FROM @temp;
    `);

    if (updateTM.recordset.length === 0) {
      return res.status(404).json({ error: "Table not found" });
    }

    const row = updateTM.recordset[0];

    // If there is an active order on RestaurantOrderCur for this table, update it as well
    await pool.request()
      .input("tableNo", sql.NVarChar, row.TableNumber)
      .input("customerName", sql.NVarChar, guestNameVal)
      .input("pax", sql.Int, paxVal)
      .query(`
        UPDATE RestaurantOrderCur
        SET CustomerName = @customerName, Pax = @pax
        WHERE Tableno = @tableNo AND isOrderClosed = 0
      `);

    // 🔥 Emit socket event with customerName and pax
    const io = req.app.get("io");
    if (io) {
      const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
      io.emit("table_status_updated", { 
        tableId: cleanTableId, 
        status: row.Status,
        totalAmount: row.TotalAmount,
        startTime: row.StartTime,
        tableNo: row.TableNumber,
        section: sectionMap[String(row.DiningSection)] || row.DiningSection,
        modifiedOn: row.ModifiedOn,
        entryStatus: row.entryStatus || null,
        customerName: guestNameVal,
        pax: paxVal
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("SAVE GUEST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// In-memory tracking of active takeaway sessions to preserve table for the same client session
// Map<sessionId, { tableId: string, tableNo: string, assignedAt: number }>
const takeawaySessionMap = new Map();
const TAKEAWAY_SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// ✅ Route: POST /api/tables/auto-assign-takeaway
// Concurrency-safe, session-aware automatic table assignment for Takeaway QR orders (TW1 to TW20)
router.post("/auto-assign-takeaway", async (req, res) => {
  const { customerName, pax, sessionId, tableId } = req.body;
  const guestNameVal = customerName && customerName.trim() ? customerName.trim().substring(0, 9) : "Takeaway";
  const paxVal = pax ? parseInt(pax) : 1;
  const cleanSessionId = sessionId && String(sessionId).trim() !== "" ? String(sessionId).trim() : null;
  const cleanTableId = tableId && String(tableId).trim() !== "" ? String(tableId).replace(/^\{|\}$/g, "").trim() : null;

  try {
    const pool = await poolPromise;
    const now = Date.now();

    // 1. Purge expired sessions from memory
    for (const [sId, sess] of takeawaySessionMap.entries()) {
      if (now - sess.assignedAt > TAKEAWAY_SESSION_TIMEOUT_MS) {
        takeawaySessionMap.delete(sId);
      }
    }

    // 2. Check if this client session already holds an active table (by tableId, in-memory, or in TableMaster.LockedByName)
    let existingTableId = cleanTableId || (cleanSessionId ? takeawaySessionMap.get(cleanSessionId)?.tableId : null);
    if (existingTableId || cleanSessionId) {
      try {
        const verifyReq = pool.request();
        let verifySql = `
          SELECT TableId, TableNumber, DiningSection, Status, entry_status, PAYMENT_STATUS, CurrentOrderId, CustomerName, Pax, TotalAmount
          FROM TableMaster
          WHERE DiningSection = '4'
        `;
        if (existingTableId && cleanSessionId) {
          verifyReq.input("tid", sql.NVarChar(100), existingTableId);
          verifyReq.input("sessId", sql.NVarChar(100), cleanSessionId);
          verifySql += ` AND (
            (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
            OR TableNumber = @tid
            OR LockedByName = @sessId
          )`;
        } else if (existingTableId) {
          verifyReq.input("tid", sql.NVarChar(100), existingTableId);
          verifySql += ` AND (
            (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
            OR TableNumber = @tid
          )`;
        } else if (cleanSessionId) {
          verifyReq.input("sessId", sql.NVarChar(100), cleanSessionId);
          verifySql += ` AND LockedByName = @sessId`;
        }
        verifySql += `
            AND Status = 1 
            AND entry_status = 'q'
            AND (PAYMENT_STATUS = 0 OR PAYMENT_STATUS IS NULL)
            AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15
            AND (
              CurrentOrderId IS NULL 
              OR (
                NOT EXISTS (
                  SELECT 1 FROM RestaurantOrderCur roc 
                  WHERE (roc.OrderNumber = CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(CurrentOrderId AS NVARCHAR(100)))
                    AND roc.isOrderClosed = 1
                )
                AND NOT EXISTS (
                  SELECT 1 FROM SettlementHeader sh WHERE sh.BillNo = CurrentOrderId
                )
              )
            );
        `;

        const verifyResult = await verifyReq.query(verifySql);

        if (verifyResult.recordset && verifyResult.recordset.length > 0) {
          const existingRow = verifyResult.recordset[0];
          if (cleanSessionId) {
            takeawaySessionMap.set(cleanSessionId, {
              tableId: existingRow.TableId,
              tableNo: existingRow.TableNumber,
              assignedAt: now,
              customerName: guestNameVal,
            });
          }

          // Update customerName in DB if a real name is now provided
          if (guestNameVal && guestNameVal !== "Takeaway") {
            try {
              await pool.request()
                .input("tid", sql.UniqueIdentifier, existingRow.TableId)
                .input("cname", sql.NVarChar(50), guestNameVal)
                .query(`UPDATE TableMaster SET CustomerName = @cname, ModifiedOn = GETDATE() WHERE TableId = @tid`);

              const io = req.app.get("io");
              if (io) {
                io.emit("table_status_updated", {
                  tableId: String(existingRow.TableId).toLowerCase(),
                  status: 1,
                  totalAmount: existingRow.TotalAmount || 0,
                  tableNo: existingRow.TableNumber,
                  section: "TAKEAWAY",
                  diningSection: "4",
                  customerName: guestNameVal,
                  entryStatus: "q",
                });
              }
            } catch (nameErr) {
              console.warn("Failed to update takeaway customer name:", nameErr.message);
            }
          }

          console.log(`♻️ [Auto-Assign Takeaway] Re-using active table ${existingRow.TableNumber} for existing session "${cleanSessionId || existingTableId}"`);
          return res.json({
            success: true,
            isExistingSession: true,
            table: {
              tableId: String(existingRow.TableId),
              tableNo: existingRow.TableNumber,
              section: "TAKEAWAY",
              diningSection: "4",
              customerName: guestNameVal,
              pax: paxVal,
            },
          });
        } else if (cleanSessionId) {
          takeawaySessionMap.delete(cleanSessionId);
        }
      } catch (checkErr) {
        console.warn("Session table check warning:", checkErr.message);
      }
    }

    // 3. Concurrency-safe atomic reservation of a new table from TW1 to TW20
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      let candidateQuery = '';
      const candidateReq = transaction.request();

      if (cleanTableId) {
        candidateReq.input("requestedTid", sql.NVarChar(100), cleanTableId);
        candidateQuery = `
          SELECT TOP 1
            tm.TableId,
            tm.TableNumber,
            tm.DiningSection,
            CAST(REPLACE(tm.TableNumber, 'TW', '') AS INT) as TwNum
          FROM TableMaster tm WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
          WHERE tm.DiningSection = '4'
            AND (
              (TRY_CAST(@requestedTid AS UNIQUEIDENTIFIER) IS NOT NULL AND tm.TableId = TRY_CAST(@requestedTid AS UNIQUEIDENTIFIER))
              OR tm.TableNumber = @requestedTid
            )
            AND (
              -- Either completely empty/free
              (tm.Status = 0 OR tm.Status IS NULL)
              -- OR an abandoned session (> 15 minutes inactive with NO order and NO cart items)
              OR (
                tm.Status = 1 
                AND tm.entry_status = 'q'
                AND DATEDIFF(MINUTE, ISNULL(tm.StartTime, tm.ModifiedOn), GETDATE()) >= 15
                AND NOT EXISTS (
                  SELECT 1 FROM RestaurantOrderCur roc WITH (NOLOCK)
                  WHERE (roc.Tableno = tm.TableNumber OR roc.OrderNumber = tm.CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
                    AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
                )
                AND NOT EXISTS (
                  SELECT 1 FROM CartItems ci WITH (NOLOCK)
                  WHERE (ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber)
                )
              )
            )
            -- Ensure NO active unclosed order exists on this table
            AND NOT EXISTS (
              SELECT 1 FROM RestaurantOrderCur rocActive WITH (NOLOCK)
              WHERE RTRIM(LTRIM(rocActive.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
                AND (rocActive.isOrderClosed = 0 OR rocActive.isOrderClosed IS NULL)
            )
            -- Ensure NO items in CartItems
            AND NOT EXISTS (
              SELECT 1 FROM CartItems ci WITH (NOLOCK)
              WHERE (ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber)
            );
        `;
      } else {
        // Find the first available table between TW1 and TW20 ordered by number (1 to 20).
        // Uses UPDLOCK, ROWLOCK, HOLDLOCK to guarantee atomic selection and lock out race conditions.
        candidateQuery = `
          SELECT TOP 1
            tm.TableId,
            tm.TableNumber,
            tm.DiningSection,
            CAST(REPLACE(tm.TableNumber, 'TW', '') AS INT) as TwNum
          FROM TableMaster tm WITH (UPDLOCK, ROWLOCK, HOLDLOCK)
          WHERE tm.DiningSection = '4'
            AND tm.TableNumber LIKE 'TW[0-9]%'
            AND CAST(REPLACE(tm.TableNumber, 'TW', '') AS INT) BETWEEN 1 AND 20
            AND (
              -- Either completely empty/free
              (tm.Status = 0 OR tm.Status IS NULL)
              -- OR an abandoned session (> 15 minutes inactive with NO order and NO cart items)
              OR (
                tm.Status = 1 
                AND tm.entry_status = 'q'
                AND DATEDIFF(MINUTE, ISNULL(tm.StartTime, tm.ModifiedOn), GETDATE()) >= 15
                AND NOT EXISTS (
                  SELECT 1 FROM RestaurantOrderCur roc WITH (NOLOCK)
                  WHERE (roc.Tableno = tm.TableNumber OR roc.OrderNumber = tm.CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
                    AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
                )
                AND NOT EXISTS (
                  SELECT 1 FROM CartItems ci WITH (NOLOCK)
                  WHERE (ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber)
                )
              )
            )
            -- Ensure NO active unclosed order exists on this table
            AND NOT EXISTS (
              SELECT 1 FROM RestaurantOrderCur rocActive WITH (NOLOCK)
              WHERE RTRIM(LTRIM(rocActive.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
                AND (rocActive.isOrderClosed = 0 OR rocActive.isOrderClosed IS NULL)
            )
            -- Ensure NO items in CartItems
            AND NOT EXISTS (
              SELECT 1 FROM CartItems ci WITH (NOLOCK)
              WHERE (ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber)
            )
          ORDER BY CAST(REPLACE(tm.TableNumber, 'TW', '') AS INT) ASC;
        `;
      }

      const candidateResult = await candidateReq.query(candidateQuery);

      if (!candidateResult.recordset || candidateResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          error: "NO_TABLES_AVAILABLE",
          message: cleanTableId
            ? `Takeaway table ${cleanTableId} is currently occupied or unavailable. Please choose another table or place your order at the counter.`
            : "All takeaway tables (TW1–TW20) are currently occupied. Please wait a moment or place your order at the counter.",
        });
      }

      const assigned = candidateResult.recordset[0];
      const assignedTableId = assigned.TableId;
      const assignedTableNo = assigned.TableNumber;

      // 4. Reserve / assign this table atomically: set Status = 1, entry_status = 'q', customerName, StartTime, clear stale OrderId
      await transaction.request()
        .input("tableId", sql.UniqueIdentifier, assignedTableId)
        .input("customerName", sql.NVarChar(50), guestNameVal)
        .input("pax", sql.Int, paxVal)
        .input("sessionId", sql.NVarChar(100), cleanSessionId)
        .query(`
          UPDATE TableMaster
          SET Status = 1,
              entry_status = 'q',
              PAYMENT_STATUS = 0,
              CustomerName = @customerName,
              Pax = @pax,
              StartTime = GETDATE(),
              ModifiedOn = GETDATE(),
              CurrentOrderId = NULL,
              TotalAmount = 0,
              LockedByName = @sessionId
          WHERE TableId = @tableId;
        `);

      const selectResult = await transaction.request()
        .input("tableId", sql.UniqueIdentifier, assignedTableId)
        .query(`
          SELECT 
            TableId,
            TableNumber,
            DiningSection,
            Status,
            TotalAmount,
            CONVERT(VARCHAR, StartTime, 126) AS StartTime,
            CONVERT(VARCHAR, ModifiedOn, 126) AS ModifiedOn,
            entry_status AS entryStatus
          FROM TableMaster
          WHERE TableId = @tableId;
        `);

      await transaction.commit();

      const row = selectResult.recordset[0];

      // 5. Store session in memory
      if (cleanSessionId) {
        takeawaySessionMap.set(cleanSessionId, {
          tableId: assignedTableId,
          tableNo: assignedTableNo,
          assignedAt: now,
          customerName: guestNameVal,
        });
      }

      // 6. Emit real-time socket event so POS, KDS, and waitstaff screens update immediately
      const io = req.app.get("io");
      if (io) {
        io.emit("table_status_updated", {
          tableId: String(assignedTableId).toLowerCase(),
          status: 1,
          totalAmount: 0,
          startTime: row?.StartTime,
          tableNo: assignedTableNo,
          section: "TAKEAWAY",
          modifiedOn: row?.ModifiedOn,
          entryStatus: "q",
          customerName: guestNameVal,
          pax: paxVal,
        });
      }

      console.log(`✅ [Auto-Assign Takeaway] Successfully assigned table ${assignedTableNo} (${assignedTableId}) to customer "${guestNameVal}" (Session: ${cleanSessionId || 'none'})`);

      return res.json({
        success: true,
        table: {
          tableId: String(assignedTableId),
          tableNo: assignedTableNo,
          section: "TAKEAWAY",
          diningSection: "4",
          customerName: guestNameVal,
          pax: paxVal,
        },
      });
    } catch (txnErr) {
      await transaction.rollback();
      throw txnErr;
    }
  } catch (err) {
    console.error("❌ AUTO-ASSIGN TAKEAWAY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Route: ALL /api/tables/auto-reconcile-takeaway
// Auto-releases QR takeaway tables whose sessions expired (> 15 mins) without placing an order
router.all("/auto-reconcile-takeaway", async (req, res) => {
  try {
    const pool = await poolPromise;
    const expiredRes = await pool.request().query(`
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

    const cleared = expiredRes.recordset || [];
    const io = req.app.get("io");
    if (io && cleared.length > 0) {
      cleared.forEach(tbl => {
        const cleanTid = String(tbl.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
        io.emit("table_status_updated", {
          tableId: cleanTid,
          tableNo: tbl.TableNumber,
          section: "TAKEAWAY",
          status: 0,
          orderId: "EMPTY",
          totalAmount: 0,
          startTime: 0,
          entryStatus: null,
          paymentStatus: 0,
          customerName: null,
          pax: null,
        });
      });
      io.emit("tables_updated");
    }

    res.json({ success: true, clearedCount: cleared.length, clearedTables: cleared });
  } catch (err) {
    console.error("❌ AUTO-RECONCILE TAKEAWAY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Route: POST /api/tables/release-takeaway
// Releases an un-ordered or closed Takeaway QR table immediately upon logout or session termination
router.post("/release-takeaway", async (req, res) => {
  const { tableId, tableNo, sessionId } = req.body;
  if (!tableId && !tableNo && !sessionId) {
    return res.status(400).json({ error: "tableId, tableNo, or sessionId required" });
  }

  try {
    const pool = await poolPromise;
    const cleanSessionId = sessionId && String(sessionId).trim() !== "" ? String(sessionId).trim() : null;
    const cleanTableNo = tableNo && String(tableNo).trim() !== "" ? String(tableNo).trim() : null;
    const cleanTableId = tableId && String(tableId).trim() !== "" ? String(tableId).replace(/^\{|\}$/g, "").trim() : null;

    // 1. Find the table row(s) in TableMaster
    const findReq = pool.request();
    let findSql = `
      SELECT TableId, TableNumber, DiningSection, Status, entry_status, CurrentOrderId, CustomerName, LockedByName
      FROM TableMaster
      WHERE DiningSection = '4'
    `;

    const conditions = [];
    if (cleanTableId) {
      findReq.input("tid", sql.UniqueIdentifier, cleanTableId);
      conditions.push("TableId = @tid");
    }
    if (cleanTableNo) {
      findReq.input("tno", sql.NVarChar(50), cleanTableNo);
      conditions.push("TableNumber = @tno");
    }
    if (cleanSessionId) {
      findReq.input("sessId", sql.NVarChar(100), cleanSessionId);
      conditions.push("LockedByName = @sessId");
    }

    if (conditions.length === 0) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    findSql += ` AND (${conditions.join(" OR ")})`;

    const findRes = await findReq.query(findSql);
    const tablesToRelease = findRes.recordset || [];

    const io = req.app.get("io");
    let releasedCount = 0;

    for (const tbl of tablesToRelease) {
      const tId = tbl.TableId;
      const tNo = tbl.TableNumber;

      // 2. Check if an active unclosed order exists with active items
      const checkReq = pool.request()
        .input("tid", sql.UniqueIdentifier, tId)
        .input("tno", sql.NVarChar(50), tNo);

      const checkSql = `
        SELECT TOP 1 roc.OrderId
        FROM RestaurantOrderCur roc WITH (NOLOCK)
        WHERE (RTRIM(LTRIM(roc.Tableno)) = RTRIM(LTRIM(@tno)) OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(@tid AS NVARCHAR(100)))
          AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
          AND EXISTS (
            SELECT 1 FROM RestaurantOrderDetailCur d WITH (NOLOCK)
            WHERE d.OrderId = roc.OrderId AND d.StatusCode <> 0
          )
      `;
      const activeRes = await checkReq.query(checkSql);

      if (activeRes.recordset && activeRes.recordset.length > 0) {
        console.log(`ℹ️ [Release Takeaway] Table ${tNo} has active unclosed order (${activeRes.recordset[0].OrderId}). Skipping release.`);
        continue;
      }

      // 3. Table is free of active orders -> Release it completely
      await pool.request()
        .input("tid", sql.UniqueIdentifier, tId)
        .input("tno", sql.NVarChar(50), tNo)
        .query(`
          UPDATE TableMaster
          SET Status = 0,
              entry_status = NULL,
              PAYMENT_STATUS = 0,
              CustomerName = NULL,
              Pax = NULL,
              StartTime = NULL,
              CurrentOrderId = NULL,
              TotalAmount = 0,
              LockedByName = NULL,
              ModifiedOn = GETDATE()
          WHERE TableId = @tid AND DiningSection = '4';

          -- Also clear any draft cart items for this table
          DELETE FROM CartItems
          WHERE CartId = CAST(@tid AS NVARCHAR(128)) OR CartId = @tno;
        `);

      // 4. Remove session from in-memory tracking
      for (const [sId, sess] of takeawaySessionMap.entries()) {
        if (sess.tableId === tId || sess.tableNo === tNo || (cleanSessionId && sId === cleanSessionId)) {
          takeawaySessionMap.delete(sId);
        }
      }

      // 5. Emit real-time table status update to POS so table turns white immediately
      if (io) {
        io.emit("table_status_updated", {
          tableId: String(tId).toLowerCase(),
          status: 0,
          totalAmount: 0,
          startTime: null,
          tableNo: tNo,
          section: "TAKEAWAY",
          diningSection: "4",
          customerName: null,
          entryStatus: null,
        });
      }

      releasedCount++;
      console.log(`✅ [Release Takeaway] Table ${tNo} (${tId}) released successfully.`);
    }

    if (cleanSessionId) {
      takeawaySessionMap.delete(cleanSessionId);
    }

    res.json({ success: true, releasedCount });
  } catch (err) {
    console.error("RELEASE TAKEAWAY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Route to create a new Table
router.post("/create", async (req, res) => {
  const { tableNumber, diningSection, seats, tableType, xSize, ySize } = req.body;
  try {
    const pool = await poolPromise;
    if (!tableNumber) return res.status(400).json({ error: "tableNumber is required" });
    if (!diningSection) return res.status(400).json({ error: "diningSection is required" });

    const request = pool.request();
    request.input("tableNumber", sql.VarChar(50), String(tableNumber));
    request.input("diningSection", sql.VarChar(10), String(diningSection));
    request.input("seats", sql.Int, Number(seats) || 4);
    request.input("tableType", sql.VarChar(50), tableType || "Rectangular");
    request.input("xSize", sql.Int, Number(xSize) || 100);
    request.input("ySize", sql.Int, Number(ySize) || 80);

    // Let's get the max SortCode to append it to the end
    const maxSortResult = await pool.request().query("SELECT ISNULL(MAX(SortCode), 0) as maxSort FROM TableMaster");
    const nextSortCode = (maxSortResult.recordset[0]?.maxSort || 0) + 1;
    request.input("sortCode", sql.Int, nextSortCode);

    await request.query(`
      INSERT INTO TableMaster (
        TableId, TableNumber, DiningSection, Seats, TableType, XSize, YSize,
        SortCode, ReservationAllowed, Status, IstakeAway, IsLocked, TotalAmount,
        CreatedOn, ModifiedOn, PrintSection, Row, Col
      )
      VALUES (
        NEWID(), @tableNumber, @diningSection, @seats, @tableType, @xSize, @ySize,
        @sortCode, 0, 0, 0, 0, 0,
        GETDATE(), GETDATE(), 1, 0, 0
      )
    `);

    // Broadcast change
    const io = req.app.get("io");
    if (io) {
      io.emit("table_config_updated", {});
    }

    res.json({ success: true, message: "Table created successfully" });
  } catch (err) {
    console.error("CREATE TABLE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Route to update Table visual configurations (Seats, TableType, XSize, YSize)
router.put("/update-config", async (req, res) => {
  const { tableId, seats, tableType, xSize, ySize } = req.body;
  try {
    const pool = await poolPromise;
    if (!tableId) return res.status(400).json({ error: "tableId is required" });

    const cleanTableId = tableId.replace(/^\{|\}$/g, "").trim();
    const request = pool.request();
    request.input("tableId", sql.VarChar(50), cleanTableId);
    request.input("seats", sql.Int, Number(seats));
    request.input("tableType", sql.VarChar(50), tableType);
    request.input("xSize", sql.Int, Number(xSize));
    request.input("ySize", sql.Int, Number(ySize));

    await request.query(`
      UPDATE TableMaster
      SET Seats = @seats,
          TableType = @tableType,
          XSize = @xSize,
          YSize = @ySize,
          ModifiedOn = GETDATE()
      WHERE TableId = TRY_CAST(@tableId AS UNIQUEIDENTIFIER) OR CAST(TableNumber AS VARCHAR(50)) = @tableId
    `);

    // Broadcast update via socket
    const io = req.app.get("io");
    if (io) {
      io.emit("table_config_updated", { tableId: cleanTableId });
    }

    res.json({ success: true, message: "Table configuration updated successfully" });
  } catch (err) {
    console.error("UPDATE CONFIG ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
// ✅ Route to update multiple table layout positions (XPos, YPos) in bulk
router.put("/save-positions", async (req, res) => {
  const { positions } = req.body; // Array of { id, xPos, yPos }
  console.log("📥 [API] save-positions received:", positions ? positions.length : 0, "positions");
  if (!Array.isArray(positions)) {
    return res.status(400).json({ error: "positions array is required" });
  }

  try {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      for (const pos of positions) {
        const cleanTableId = String(pos.id).replace(/^\{|\}$/g, "").trim();
        await transaction.request()
          .input("tableId", sql.VarChar(50), cleanTableId)
          .input("xPos", sql.Int, Math.round(Number(pos.xPos)))
          .input("yPos", sql.Int, Math.round(Number(pos.yPos)))
          .input("tableType", sql.VarChar(50), pos.tableType || null)
          .input("xSize", sql.Int, pos.xSize !== undefined ? Number(pos.xSize) : null)
          .input("ySize", sql.Int, pos.ySize !== undefined ? Number(pos.ySize) : null)
          .input("seats", sql.Int, pos.seats !== undefined ? Number(pos.seats) : null)
          .query(`
            UPDATE TableMaster
            SET XPos = @xPos,
                YPos = @yPos,
                TableType = ISNULL(@tableType, TableType),
                XSize = ISNULL(@xSize, XSize),
                YSize = ISNULL(@ySize, YSize),
                Seats = ISNULL(@seats, Seats),
                ModifiedOn = GETDATE()
            WHERE TableId = TRY_CAST(@tableId AS UNIQUEIDENTIFIER) OR CAST(TableNumber AS VARCHAR(50)) = @tableId
          `);
      }
      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    // Broadcast layout update via socket
    const io = req.app.get("io");
    if (io) {
      io.emit("table_config_updated", {});
    }

    res.json({ success: true, message: "Table positions saved successfully" });
  } catch (err) {
    console.error("SAVE POSITIONS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ New route to match user's snippet: PUT /api/tables/status
router.put("/status", async (req, res) => {
  const { tableId, status } = req.body;
  const userId = req.body.userId || req.body.UserId || req.body.USERID;

  try {
    const pool = await poolPromise;
    if (!tableId) return res.status(400).json({ error: "tableId is required" });
    if (status === undefined) return res.status(400).json({ error: "status is required" });

    const holdMinutes = await getHoldOvertimeMinutes();
    const cleanTableId = tableId.replace(/^\{|\}$/g, "").trim();
    const request = pool.request();
    request.input("tableId", sql.VarChar(50), cleanTableId);
    request.input("status", sql.Int, Number(status));
    request.input("ModifiedBy", sql.UniqueIdentifier, userId || null);
    request.input("holdMinutes", sql.Int, holdMinutes);

    const updateResult = await request.query(`
      DECLARE @temp TABLE (
        TotalAmount DECIMAL(18, 2),
        StartTime VARCHAR(50),
        TableNumber NVARCHAR(50),
        DiningSection VARCHAR(10),
        entryStatus VARCHAR(50),
        customerName NVARCHAR(255),
        pax INT,
        ModifiedOn VARCHAR(50),
        isOvertime INT,
        isHoldOvertime INT
      );

      UPDATE TableMaster 
      SET Status = @status,
          ModifiedBy = @ModifiedBy,
          entry_status = CASE WHEN @status = 0 OR @status = 5 THEN NULL ELSE entry_status END,
          StartTime = CASE 
            WHEN (@status = 1 OR @status = 2 OR @status = 3) AND (StartTime IS NULL OR StartTime < '2000-01-01') THEN GETDATE() 
            WHEN @status = 0 OR @status = 5 THEN NULL 
            ELSE StartTime 
          END,
          TotalAmount = CASE 
            WHEN @status = 0 OR @status = 5 THEN 0 
            ELSE TotalAmount 
          END,
          CustomerName = CASE 
            WHEN @status = 0 OR @status = 5 THEN NULL 
            ELSE CustomerName 
          END,
          Pax = CASE 
            WHEN @status = 0 OR @status = 5 THEN NULL 
            ELSE Pax 
          END,
          ModifiedOn = GETDATE()
      OUTPUT 
        INSERTED.TotalAmount, 
        CONVERT(VARCHAR, INSERTED.StartTime, 126) AS StartTime,
        INSERTED.TableNumber,
        INSERTED.DiningSection,
        INSERTED.entry_status AS entryStatus,
        INSERTED.CustomerName AS customerName,
        INSERTED.Pax AS pax,
        CONVERT(VARCHAR, INSERTED.ModifiedOn, 126) AS ModifiedOn,
        CASE 
          WHEN INSERTED.Status IN (1, 2, 3) AND INSERTED.StartTime IS NOT NULL AND INSERTED.StartTime > '2000-01-01' AND DATEDIFF(MINUTE, INSERTED.StartTime, GETDATE()) >= 60 THEN 1 
          ELSE 0 
        END AS isOvertime,
        CASE 
          WHEN INSERTED.Status = 3 AND INSERTED.ModifiedOn IS NOT NULL AND DATEDIFF(MINUTE, INSERTED.ModifiedOn, GETDATE()) >= @holdMinutes THEN 1 
          ELSE 0 
        END AS isHoldOvertime
      INTO @temp
      WHERE TableId = @tableId;

      SELECT * FROM @temp;
    `);
    
    const row = updateResult.recordset[0];

    // ✅ Clear CartItems if status is 0 (Available) or 5 (Locked)
    if (Number(status) === 0 || Number(status) === 5) {
      await pool.request()
        .input("tableId", sql.VarChar(50), cleanTableId)
        .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @tableId");
    }
    const currentTotal = row?.TotalAmount || 0;
    const currentStartTime = row?.StartTime || null;
    const currentIsOvertime = row?.isOvertime || 0;

    // 🔥 Emit socket event with TotalAmount, StartTime, customerName, pax and isOvertime
    const io = req.app.get("io");
    if (io) {
      const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
      io.emit("table_status_updated", { 
        tableId: cleanTableId, 
        status: Number(status),
        totalAmount: currentTotal,
        startTime: currentStartTime,
        tableNo: row?.TableNumber,
        section: sectionMap[String(row?.DiningSection)] || row?.DiningSection,
        modifiedOn: row?.ModifiedOn,
        isOvertime: currentIsOvertime,
        isHoldOvertime: row?.isHoldOvertime || 0,
        entryStatus: row?.entryStatus || null,
        customerName: row?.customerName || null,
        pax: row?.pax || null
      });
    }

    res.json({ success: true, totalAmount: currentTotal });
  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    res.status(500).json({ error: "Error updating" });
  }
});

// Unused duplicate PUT /:tableId/status removed

// ✅ GET Single Table by ID
router.get("/:tableId", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { tableId } = req.params;
    const cleanTableId = tableId.replace(/^\{|\}$/g, "").trim();

    const result = await pool.request()
      .input("tableId", sql.VarChar(50), cleanTableId)
      .query(`
        SELECT 
          tm.TableId AS id, 
          tm.TableNumber AS label,
          tm.DiningSection, 
          tm.Status, 
          CONVERT(VARCHAR, tm.StartTime, 126) as StartTime, 
          ISNULL(tm.TotalAmount, 0) as totalAmount, 
          tm.CurrentOrderId as currentOrderId,
          tm.LockedByName as lockedByName,
          tm.entry_status AS entryStatus,
          ISNULL(NULLIF(tm.CustomerName, 'Guest'), h.CustomerName) as customerName,
          h.CustomerId as customerId,
          h.MobileNo as mobileNo,
          tm.Pax as pax
        FROM TableMaster tm
        OUTER APPLY (
          SELECT TOP 1 CustomerId, CustomerName, MobileNo 
          FROM RestaurantOrderCur 
          WHERE (OrderNumber = tm.CurrentOrderId 
                 OR (RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(tm.TableNumber)) AND (isOrderClosed = 0 OR isOrderClosed IS NULL)))
          ORDER BY CASE WHEN OrderNumber = tm.CurrentOrderId THEN 0 ELSE 1 END, CreatedOn DESC
        ) h
        WHERE tm.TableId = @tableId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Table not found" });
    }

    res.json({ success: true, table: result.recordset[0] });
  } catch (err) {
    console.error("GET TABLE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/diagnostic", async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT TOP 10 TableId, TableNumber, DiningSection, Status,
        CustomerName, Pax,
        CAST(TableId AS VARCHAR(50)) AS TableId_AsString
        FROM TableMaster
      `);
      res.json(result.recordset);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

// ✅ POST /api/tables/move — Transfer cart + order from one table to another
router.post("/move", async (req, res) => {
  const { sourceTableId, destTableId } = req.body;
  const userId = req.body.userId || req.body.UserId || req.body.USERID;

  if (!sourceTableId || !destTableId) {
    return res.status(400).json({ error: "sourceTableId and destTableId are required" });
  }

  const cleanSource = String(sourceTableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
  const cleanDest   = String(destTableId).replace(/^\{|\}$/g, "").trim().toLowerCase();

  if (cleanSource === cleanDest) {
    return res.status(400).json({ error: "Source and destination tables must be different" });
  }

  try {
    const pool = await poolPromise;

    // ── 1. Fetch both table rows ──────────────────────────────────────────
    const tableRes = await pool.request()
      .input("src", sql.UniqueIdentifier, cleanSource)
      .input("dst", sql.UniqueIdentifier, cleanDest)
      .query(`
        SELECT
          TableId, TableNumber, DiningSection, Status,
          TotalAmount, CurrentOrderId, CustomerName, Pax, entry_status
        FROM TableMaster
        WHERE TableId IN (@src, @dst)
      `);

    const rows = tableRes.recordset;
    const srcRow = rows.find(r => String(r.TableId).toLowerCase() === cleanSource);
    const dstRow = rows.find(r => String(r.TableId).toLowerCase() === cleanDest);

    if (!srcRow) return res.status(404).json({ error: "Source table not found" });
    if (!dstRow) return res.status(404).json({ error: "Destination table not found" });

    // ── 2. Validate states ───────────────────────────────────────────────
    // Source must be occupied (1=Dining, 2=Checkout, 3=Hold)
    if (![1, 2, 3].includes(Number(srcRow.Status))) {
      return res.status(400).json({ error: `Source table is not occupied (status=${srcRow.Status})` });
    }
    // Destination must be available (0) or the same move attempt ignored
    if (Number(dstRow.Status) !== 0) {
      return res.status(400).json({ error: "Destination table is not available" });
    }

    const srcTableNo = srcRow.TableNumber;
    const dstTableNo = dstRow.TableNumber;

    // ── 3. Run atomic SQL transaction ────────────────────────────────────
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // A. Move CartItems: update CartId from source → dest
      await transaction.request()
        .input("src", sql.NVarChar(128), cleanSource)
        .input("dst", sql.NVarChar(128), cleanDest)
        .query("UPDATE [dbo].[CartItems] SET CartId = @dst WHERE CartId = @src");

      // B. Re-point RestaurantOrderCur to new table number
      await transaction.request()
        .input("srcOrderNo", sql.NVarChar(50), srcRow.CurrentOrderId || "")
        .input("dstTableNo", sql.VarChar(20), dstTableNo)
        .query(`
          UPDATE RestaurantOrderCur
          SET Tableno = @dstTableNo, ModifiedOn = GETDATE()
          WHERE OrderNumber = @srcOrderNo
            AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
        `);

      // Also handle any other open orders for this table number that aren't the CurrentOrderId
      await transaction.request()
        .input("srcTableNo", sql.VarChar(20), srcTableNo)
        .input("dstTableNo", sql.VarChar(20), dstTableNo)
        .query(`
          UPDATE RestaurantOrderCur
          SET Tableno = @dstTableNo, ModifiedOn = GETDATE()
          WHERE Tableno = @srcTableNo
            AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
        `);

      // C. Update destination TableMaster — copy source state directly in SQL
      //    (avoids JS Date round-trip which fails on some StartTime formats)
      await transaction.request()
        .input("src",   sql.UniqueIdentifier, cleanSource)
        .input("dst",   sql.UniqueIdentifier, cleanDest)
        .input("modBy", sql.UniqueIdentifier, userId || null)
        .query(`
          UPDATE dest
          SET dest.Status         = src.Status,
              dest.TotalAmount    = src.TotalAmount,
              dest.StartTime      = src.StartTime,
              dest.CurrentOrderId = src.CurrentOrderId,
              dest.CustomerName   = src.CustomerName,
              dest.Pax            = src.Pax,
              dest.entry_status   = src.entry_status,
              dest.LockedByName   = NULL,
              dest.ModifiedBy     = @modBy,
              dest.ModifiedOn     = GETDATE()
          FROM TableMaster AS dest
          INNER JOIN TableMaster AS src ON src.TableId = @src
          WHERE dest.TableId = @dst
        `);

      // D. Reset source TableMaster to Available
      await transaction.request()
        .input("src",   sql.UniqueIdentifier, cleanSource)
        .input("modBy", sql.UniqueIdentifier, userId || null)
        .query(`
          UPDATE TableMaster
          SET Status         = 0,
              TotalAmount    = 0,
              StartTime      = NULL,
              CurrentOrderId = NULL,
              CustomerName   = NULL,
              Pax            = NULL,
              entry_status   = NULL,
              LockedByName   = NULL,
              ModifiedBy     = @modBy,
              ModifiedOn     = GETDATE()
          WHERE TableId = @src
        `);

      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    // ── 4. Emit socket events ────────────────────────────────────────────
    const io = req.app.get("io");
    const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };

    if (io) {
      // Source table → now Available
      io.emit("table_status_updated", {
        tableId:       cleanSource,
        status:        0,
        totalAmount:   0,
        startTime:     null,
        currentOrderId: null,
        tableNo:       srcTableNo,
        section:       sectionMap[String(srcRow.DiningSection)] || srcRow.DiningSection,
        customerName:  null,
        pax:           null,
        modifiedOn:    new Date().toISOString(),
      });

      // Destination table → now Dining (or whatever source status was)
      io.emit("table_status_updated", {
        tableId:       cleanDest,
        status:        Number(srcRow.Status),
        totalAmount:   Number(srcRow.TotalAmount) || 0,
        startTime:     null,   // frontend will get accurate value via fetchTables() refresh
        currentOrderId: srcRow.CurrentOrderId || null,
        tableNo:       dstTableNo,
        section:       sectionMap[String(dstRow.DiningSection)] || dstRow.DiningSection,
        customerName:  srcRow.CustomerName || null,
        pax:           srcRow.Pax || null,
        modifiedOn:    new Date().toISOString(),
      });

      // Refresh cart listeners for both tables
      io.emit("cart_updated", { tableId: cleanSource });
      io.emit("cart_updated", { tableId: cleanDest });
    }

    res.json({
      success:      true,
      sourceTableNo: srcTableNo,
      destTableNo:   dstTableNo,
      movedStatus:   Number(srcRow.Status),
      totalAmount:   Number(srcRow.TotalAmount) || 0,
    });

  } catch (err) {
    console.error("MOVE TABLE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
