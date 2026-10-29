const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

router.use((req, res, next) => {
  // Allow customer guest QR endpoints to bypass token check
  const bypassPaths = ["/save-cart", "/checkout", "/send", "/payment-status", "/complete-online-payment"];
  const isBypass = bypassPaths.includes(req.path) || req.path.startsWith("/cart/") || req.path.startsWith("/order-status/");
  if (isBypass) {
    return next();
  }
  return authenticateToken(req, res, next);
});

const { getActiveOrganization } = require("../utils/organizationHelper");
const { getCompanySettings } = require("../utils/settingsCache");
const DEFAULT_GUID = "00000000-0000-0000-0000-000000000000";

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE: In-memory cache for INFORMATION_SCHEMA column existence checks.
// INFORMATION_SCHEMA.COLUMNS is a slow SQL Server system view — scanning it on
// every payment screen open was adding 100–500 ms of latency per call.
// This cache is populated once per server process lifetime and is safe because
// columns are never dropped in production; they are only added (self-healing).
// If a server restart occurs the cache resets automatically and will re-check.
// ─────────────────────────────────────────────────────────────────────────────
const columnExistenceCache = new Map(); // key: "TABLE_NAME.COLUMN_NAME" → true | false

async function columnExists(pool, tableName, columnName) {
  const cacheKey = `${tableName}.${columnName}`;
  if (columnExistenceCache.has(cacheKey)) {
    return columnExistenceCache.get(cacheKey);
  }
  try {
    const result = await pool.request().query(`
      SELECT 1 AS HasCol FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = '${tableName}' AND COLUMN_NAME = '${columnName}'
    `);
    const exists = result.recordset.length > 0;
    columnExistenceCache.set(cacheKey, exists);
    return exists;
  } catch (err) {
    console.error(`[columnExists] Failed to check ${tableName}.${columnName}:`, err.message);
    return false;
  }
}

// 🔹 QR Setting Helper: Check if QR Code ordering is enabled
async function isQRSettingEnabled() {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query("SELECT TOP 1 EnableQRCodeSettings FROM AppSettings");
    return Boolean(result.recordset[0]?.EnableQRCodeSettings);
  } catch (err) {
    console.warn("⚠️ [QR] Failed to check QR setting:", err.message);
    return false;
  }
}

const NOTE_KEYS = ["note", "Note", "notes", "Notes", "remarks", "Remarks"];
const TAKEAWAY_KEYS = ["isTakeaway", "IsTakeaway", "isTakeAway", "IsTakeAway"];
const SPICY_KEYS = ["spicy", "Spicy"];
const SALT_KEYS = ["salt", "Salt"];
const OIL_KEYS = ["oil", "Oil"];
const SUGAR_KEYS = ["sugar", "Sugar"];

const toGuidOrNull = (value) => {
  if (!value) return null;
  const s = String(value)
    .trim()
    .replace(/^\{|\}$/g, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  )
    ? s
    : null;
};

const getCleanTableId = async (pool, tableId) => {
  if (!tableId) return null;
  const cleanId = String(tableId).replace(/^\{|\}$/g, "").trim();
  const guid = toGuidOrNull(cleanId);
  if (guid) return guid;
  try {
    const res = await pool.request()
      .input("num", sql.VarChar(20), cleanId)
      .query("SELECT TableId FROM TableMaster WHERE TableNumber = @num");
    if (res.recordset.length > 0) {
      return String(res.recordset[0].TableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
    }
  } catch (err) {
    console.error("Failed to resolve TableId for table number:", cleanId, err.message);
  }
  return cleanId;
};


function resolveItemTextField(item = {}, keys = []) {
  const itemKeys = Object.keys(item || {});
  for (const k of keys) {
    const actualKey = itemKeys.find(
      (ik) => ik.toLowerCase() === k.toLowerCase(),
    );
    if (actualKey !== undefined) {
      const raw = item[actualKey];
      if (raw !== undefined && raw !== null)
        return { hasExplicitValue: true, value: String(raw) };
    }
  }
  return { hasExplicitValue: false, value: "" };
}

function resolveItemNote(item = {}) {
  return resolveItemTextField(item, NOTE_KEYS);
}
function resolveItemTakeaway(item = {}) {
  const result = resolveItemTextField(item, TAKEAWAY_KEYS);
  const val = result.value.toLowerCase();
  return {
    hasExplicitTakeaway: result.hasExplicitValue,
    value: result.hasExplicitValue ? val === "true" || val === "1" : false,
  };
}

function getSingaporeDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date()).replace(/-/g, "");
}

/**
 * Get or Generate Order ID for a table
 * Returns existing ID if table is active, otherwise generates a new one.
 */
async function getOrGenerateOrderId(req, tableId) {
  const pool = await poolPromise;
  const cleanId = await getCleanTableId(pool, tableId);
  const isTakeaway =
    !tableId ||
    tableId === "undefined" ||
    tableId === "null" ||
    String(tableId).startsWith("TAKEAWAY") ||
    String(cleanId).startsWith("TAKEAWAY") ||
    String(cleanId).startsWith("TW") ||
    req.body?.orderType === "TAKEAWAY" ||
    req.body?.isTakeaway === true ||
    req.body?.isTakeAway === true;

  if (isTakeaway) {
    // If client explicitly passed a valid active orderId that is NOT yet closed or settled:
    if (req.body?.orderId && typeof req.body.orderId === 'string' && req.body.orderId.length > 5 && !req.body.orderId.startsWith('TEMP-') && req.body.orderId !== 'NEW' && req.body.orderId !== '#NEW') {
      try {
        const existingCheck = await pool.request()
          .input("checkOid", sql.NVarChar(50), req.body.orderId)
          .query(`
            SELECT TOP 1 roc.OrderNumber, roc.isOrderClosed
            FROM RestaurantOrderCur roc
            WHERE (roc.OrderNumber = @checkOid OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = @checkOid)
              AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
              AND NOT EXISTS (SELECT 1 FROM SettlementHeader sh WHERE sh.BillNo = roc.OrderNumber)
          `);
        if (existingCheck.recordset.length > 0) {
          return existingCheck.recordset[0].OrderNumber;
        }
      } catch (err) {
        console.warn("⚠️ [getOrGenerateOrderId] Check existing takeaway order failed:", err.message);
      }
    }

    try {
      const activeOrg = await getActiveOrganization();
      const currentBizId = activeOrg.businessUnitId;

      const datePrefix = getSingaporeDateString();
      const todayStr = `${datePrefix.slice(0, 4)}-${datePrefix.slice(4, 6)}-${datePrefix.slice(6, 8)}`;

      let dailySequence = 1;

      // ATOMIC ATTEMPT: Use MERGE or Transaction for Sequence
      const seqResult = await pool
        .request()
        .input("RestId", sql.UniqueIdentifier, String(currentBizId))
        .input("Today", sql.Date, todayStr).query(`
          BEGIN TRANSACTION;
          IF NOT EXISTS (SELECT 1 FROM OrderSequences WITH (UPDLOCK, HOLDLOCK) WHERE RestaurantId = @RestId AND SequenceDate = @Today)
          BEGIN
              INSERT INTO OrderSequences (RestaurantId, SequenceDate, LastNumber) VALUES (@RestId, @Today, 0);
          END
          UPDATE OrderSequences SET LastNumber = LastNumber + 1 OUTPUT INSERTED.LastNumber
          WHERE RestaurantId = @RestId AND SequenceDate = @Today;
          COMMIT TRANSACTION;
        `);

      dailySequence = seqResult.recordset[0]?.LastNumber || 1;
      return `${datePrefix}-${String(dailySequence).padStart(4, "0")}`;
    } catch (err) {
      console.error(
        "🔥 [Critical] Takeaway OrderID Generation Failed:",
        err.message,
      );
      const datePrefix = getSingaporeDateString();
      const countRes = await pool
        .request()
        .query(
          `SELECT (COUNT(*) + 1) as LastNumber FROM RestaurantOrderCur WHERE OrderNumber LIKE '${datePrefix}%'`,
        );
      const emergencySeq = countRes.recordset[0]?.LastNumber || 1;
      return `${datePrefix}-${String(emergencySeq).padStart(4, "0")}`;
    }
  }

  if (!cleanId || cleanId === "undefined" || cleanId === "null") return "NEW";

  try {
    // 1. GHOST CLEANUP: Force close any stale open orders for this table first
    // 🛡️ Fail-safe: Wrap in nested try to prevent crashing if DB is busy
    // NOTE: Pre-emptive ghost cleanup removed — it was closing active orders when CurrentOrderId
    // was null or mismatched (e.g. after a QR order created a new ID). Ghost cleanup is now
    // handled safely by syncToProfessionalTables Ghost Shield v2 (with item migration).

    // 2. Instant check for existing ID (only if not closed and not settled)
    const quickCheck = await pool
      .request()
      .input("tid", sql.VarChar(50), cleanId)
      .query("SELECT tm.CurrentOrderId, tm.PAYMENT_STATUS FROM TableMaster tm WHERE tm.TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND tm.TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))");

    let existingId = quickCheck.recordset[0]?.CurrentOrderId;
    const paymentStatus = quickCheck.recordset[0]?.PAYMENT_STATUS;
    if (
      existingId &&
      existingId !== "NEW" &&
      existingId !== "#NEW" &&
      !existingId.startsWith("TEMP-") &&
      existingId.length > 5 &&
      paymentStatus !== 1
    ) {
      // Check if this existing ID is already closed or settled in the database
      const closedCheck = await pool.request()
        .input("oid", sql.NVarChar(50), existingId)
        .query(`
          SELECT TOP 1 roc.isOrderClosed,
            (SELECT COUNT(1) FROM SettlementHeader sh WHERE sh.BillNo = roc.OrderNumber) AS IsSettled
          FROM RestaurantOrderCur roc 
          WHERE roc.OrderNumber = @oid OR (TRY_CAST(@oid AS UNIQUEIDENTIFIER) IS NOT NULL AND roc.OrderId = TRY_CAST(@oid AS UNIQUEIDENTIFIER))
        `);

      const isClosed = closedCheck.recordset[0]?.isOrderClosed === true;
      const isSettled = (closedCheck.recordset[0]?.IsSettled || 0) > 0;
      if (!isClosed && !isSettled) {
        console.log(`✅ [Cart] Reusing existing active OrderID: ${existingId}`);
        return existingId;
      }
      console.log(`⚠️ [Cart] Stale/settled OrderID detected: ${existingId} (closed=${isClosed}, settled=${isSettled}). Checking RestaurantOrderCur for active order...`);
    }

    // 🚀 CRITICAL FIX: Before generating a brand new sequence number, check if there is
    // an ACTIVE open order already in RestaurantOrderCur for this table.
    // This prevents EM031 vs 0024 split-brain when a QR order exists but TableMaster.CurrentOrderId
    // was reset or shows a stale/different value.
    try {
      const guidForCheck = toGuidOrNull(cleanId);
      let activeOrderRes;
      if (guidForCheck) {
        activeOrderRes = await pool.request()
          .input('tidForCheck', sql.UniqueIdentifier, guidForCheck)
          .query(`
            SELECT TOP 1 h.OrderNumber
            FROM RestaurantOrderCur h
            JOIN TableMaster tm ON RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
            WHERE tm.TableId = @tidForCheck
              AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
              AND (tm.PAYMENT_STATUS = 0 OR tm.PAYMENT_STATUS IS NULL)
              AND NOT EXISTS (SELECT 1 FROM SettlementHeader sh WHERE sh.BillNo = h.OrderNumber)
              AND h.OrderNumber IS NOT NULL
              AND h.OrderNumber NOT IN ('PENDING', 'NEW', '#NEW', '')
              AND h.OrderNumber NOT LIKE 'TEMP-%'
              AND EXISTS (SELECT 1 FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode <> 0)
            ORDER BY h.CreatedOn DESC
          `);
      } else {
        activeOrderRes = await pool.request()
          .input('tableNoCheck', sql.VarChar(50), String(cleanId))
          .query(`
            SELECT TOP 1 h.OrderNumber
            FROM RestaurantOrderCur h
            LEFT JOIN TableMaster tm ON RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
            WHERE (RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@tableNoCheck)) OR RTRIM(LTRIM(h.Tableno)) = (SELECT TOP 1 TableNumber FROM TableMaster WHERE TableNumber = @tableNoCheck OR (TRY_CAST(@tableNoCheck AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tableNoCheck AS UNIQUEIDENTIFIER))))
              AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
              AND (tm.PAYMENT_STATUS = 0 OR tm.PAYMENT_STATUS IS NULL)
              AND NOT EXISTS (SELECT 1 FROM SettlementHeader sh WHERE sh.BillNo = h.OrderNumber)
              AND h.OrderNumber IS NOT NULL
              AND h.OrderNumber NOT IN ('PENDING', 'NEW', '#NEW', '')
              AND h.OrderNumber NOT LIKE 'TEMP-%'
              AND EXISTS (SELECT 1 FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode <> 0)
            ORDER BY h.CreatedOn DESC
          `);
      }

      const activeOrderNo = activeOrderRes.recordset[0]?.OrderNumber;
      if (activeOrderNo && activeOrderNo.length > 5) {
        console.log(`✅ [Cart] Found active DB order for table, reusing OrderNumber: ${activeOrderNo}`);
        // Also sync TableMaster to reflect this order so future calls are consistent
        await pool.request()
          .input('tid2', sql.VarChar(50), cleanId)
          .input('oid2', sql.NVarChar(50), activeOrderNo)
          .query(`UPDATE TableMaster SET CurrentOrderId = @oid2, StartTime = ISNULL(StartTime, GETDATE()) WHERE TableNumber = @tid2 OR (TRY_CAST(@tid2 AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid2 AS UNIQUEIDENTIFIER))`);
        return activeOrderNo;
      }
    } catch (activeCheckErr) {
      console.warn('⚠️ [Cart] Active order DB check failed (non-critical):', activeCheckErr.message);
    }

    const activeOrg = await getActiveOrganization();
    const currentBizId = activeOrg.businessUnitId;

    const datePrefix = getSingaporeDateString();
    const todayStr = `${datePrefix.slice(0, 4)}-${datePrefix.slice(4, 6)}-${datePrefix.slice(6, 8)}`;

    let dailySequence = 1;

    // 3. ATOMIC ATTEMPT: Use MERGE or Transaction for Sequence
    const seqResult = await pool
      .request()
      .input("RestId", sql.UniqueIdentifier, String(currentBizId))
      .input("Today", sql.Date, todayStr).query(`
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM OrderSequences WITH (UPDLOCK, HOLDLOCK) WHERE RestaurantId = @RestId AND SequenceDate = @Today)
        BEGIN
            INSERT INTO OrderSequences (RestaurantId, SequenceDate, LastNumber) VALUES (@RestId, @Today, 0);
        END
        UPDATE OrderSequences SET LastNumber = LastNumber + 1 OUTPUT INSERTED.LastNumber
        WHERE RestaurantId = @RestId AND SequenceDate = @Today;
        COMMIT TRANSACTION;
      `);

    dailySequence = seqResult.recordset[0]?.LastNumber || 1;

    const displayOrderId = `${datePrefix}-${String(dailySequence).padStart(4, "0")}`;

    // 4. Atomic Update of Table Status
    await pool
      .request()
      .input("tid", sql.VarChar(50), cleanId)
      .input("oid", sql.NVarChar(50), displayOrderId)
      .query(
        "UPDATE TableMaster SET CurrentOrderId = @oid, StartTime = ISNULL(StartTime, GETDATE()) WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))",
      );

    return displayOrderId;
  } catch (err) {
    console.error("🔥 [Critical] OrderID Generation Failed:", err.message);
    // FALLBACK: Use count as emergency instead of returning "NEW"
    const datePrefix = getSingaporeDateString();
    const countRes = await pool
      .request()
      .query(
        `SELECT (COUNT(*) + 1) as LastNumber FROM RestaurantOrderCur WHERE OrderNumber LIKE '${datePrefix}%'`,
      );
    const emergencySeq = countRes.recordset[0]?.LastNumber || 1;
    return `${datePrefix}-${String(emergencySeq).padStart(4, "0")}`;
  }
}

/**
 * Professional Table Sync Helper
 * Syncs CartItems to RestaurantOrderCur and RestaurantOrderDetailCur
 */
async function syncToProfessionalTables(
  transaction,
  tableId,
  displayOrderId,
  items,
  userId,
  startDate,
  isQROrder = false,
  discountAmount = 0,
  discountRemarks = null,
  mobileNo = null,
  customerName = null,
  customerId = null,
) {
  const isTakeaway =
    !tableId ||
    tableId === "undefined" ||
    tableId === "null" ||
    String(tableId).startsWith("TAKEAWAY");
  const cleanTableId = isTakeaway
    ? null
    : String(tableId)
      .replace(/^\{|\}$/g, "")
      .trim();
  const cleanOrderNo = String(displayOrderId || "PENDING")
    .replace(/^\{|\}$/g, "")
    .trim();

  const activeOrg = await getActiveOrganization();
  const bizId = activeOrg.businessUnitId;

  const companySettings = await getCompanySettings();
  const serviceChargePercentage = companySettings
    ? Number(companySettings.ServiceChargePercentage || 0)
    : 0;
  const twServiceChargePercentage = companySettings
    ? Number(companySettings.TWServiceChargePercentage || 0)
    : 0;

  // 🚀 OPTIMIZATION 1: Combined Initial Lookups (TableNo, BizId, OrderHeader)
  const initRes = await transaction
    .request()
    .input("orderNo", sql.NVarChar(50), cleanOrderNo)
    .input("tableId", sql.VarChar(50), cleanTableId).query(`
      DECLARE @ActualTableNo VARCHAR(20) = 'TAKEAWAY';
      DECLARE @Section INT = 4;
      DECLARE @Pax INT = NULL;
      DECLARE @CustomerName NVARCHAR(150) = NULL;
      IF @tableId IS NOT NULL 
        SELECT TOP 1 @ActualTableNo = TableNumber, @Section = ISNULL(DiningSection, 4), @Pax = Pax, @CustomerName = CustomerName FROM TableMaster WHERE TableId = @tableId;

      DECLARE @PriorityCode INT = NULL;
      IF @Section = 1 SET @PriorityCode = 1
      ELSE IF @Section = 2 SET @PriorityCode = 2
      ELSE IF @Section = 3 SET @PriorityCode = 3
      ELSE IF @Section = 4 SET @PriorityCode = 4

      -- 🛡️ SHIELD: Find the DEFINITIVE active order for this table/number
      SELECT TOP 1 OrderId, Tableno, BusinessUnitId, OrderNumber
      FROM RestaurantOrderCur WITH (UPDLOCK)
      WHERE OrderNumber = @orderNo 
      OR (RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@ActualTableNo)) AND (isOrderClosed = 0 OR isOrderClosed IS NULL)) 
      ORDER BY 
        CASE WHEN OrderNumber = @orderNo THEN 0 ELSE 1 END,
        CreatedOn DESC;
      
      SELECT @ActualTableNo as ActualTableNo, @PriorityCode as PriorityCode, @Pax as Pax, @CustomerName as CustomerName;
    `);

  const header = initRes.recordsets[0][0];
  const actualTableNo = initRes.recordsets[1][0]?.ActualTableNo || "TAKEAWAY";
  const priorityCode = initRes.recordsets[1][0]?.PriorityCode || 4;
  const tablePax = initRes.recordsets[1][0]?.Pax || null;
  const tableCustomerName = initRes.recordsets[1][0]?.CustomerName || null;

  let orderGuid;
  let finalUserId = userId;
  if (!finalUserId || finalUserId.length < 10) finalUserId = DEFAULT_GUID;

  const rawCustIdStr = customerId ? String(customerId).replace(/^\{|\}$/g, "").trim() : null;

  if (header) {
    orderGuid = header.OrderId;
    await transaction
      .request()
      .input("orderId", sql.UniqueIdentifier, orderGuid)
      .input("orderNo", sql.NVarChar(50), cleanOrderNo)
      .input("priority", sql.Int, priorityCode)
      .input("isTakeaway", sql.Bit, isTakeaway ? 1 : 0)
      .input("discAmt", sql.Decimal(18, 2), discountAmount || 0)
      .input("discRemarks", sql.NVarChar(250), discountRemarks || null)
      .input("entryStatus", sql.NVarChar(10), isQROrder ? "q" : null)
      .input("mobileNo", sql.NVarChar(50), mobileNo || null)
      .input("customerName", sql.NVarChar(9), customerName ? String(customerName).substring(0, 9) : null)
      .input("rawCustomerId", sql.VarChar(50), rawCustIdStr)
      .query(`
        DECLARE @ResolvedCustomerId UNIQUEIDENTIFIER = NULL;
        IF @rawCustomerId IS NOT NULL AND TRY_CAST(@rawCustomerId AS UNIQUEIDENTIFIER) IS NOT NULL
          SET @ResolvedCustomerId = TRY_CAST(@rawCustomerId AS UNIQUEIDENTIFIER);
        ELSE IF @mobileNo IS NOT NULL AND @mobileNo <> ''
          SELECT TOP 1 @ResolvedCustomerId = MemberId 
          FROM MemberMaster 
          WHERE IsActive = 1 AND (
            Phone = @mobileNo 
            OR REPLACE(REPLACE(Phone, ' ', ''), '-', '') = REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '')
            OR (LEN(REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '')) >= 8 AND Phone LIKE '%' + REPLACE(REPLACE(@mobileNo, ' ', ''), '-', ''))
            OR (LEN(REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '')) >= 8 AND REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '') LIKE '%' + REPLACE(REPLACE(Phone, ' ', ''), '-', ''))
          );

        DECLARE @ResolvedCustomerName NVARCHAR(9) = @customerName;
        IF (@ResolvedCustomerName IS NULL OR @ResolvedCustomerName = '' OR @ResolvedCustomerName = 'Guest') AND @ResolvedCustomerId IS NOT NULL
          SELECT TOP 1 @ResolvedCustomerName = SUBSTRING(Name, 1, 9) FROM MemberMaster WHERE MemberId = @ResolvedCustomerId;

        UPDATE RestaurantOrderCur 
        SET PriorityCode = ISNULL(PriorityCode, @priority),
            IsTakeAway = @isTakeaway,
            DiscountAmount = CASE WHEN @discAmt > 0 THEN @discAmt ELSE DiscountAmount END,
            DiscountRemarks = CASE WHEN @discRemarks IS NOT NULL THEN @discRemarks ELSE DiscountRemarks END,
            entry_status = @entryStatus,
            MobileNo = COALESCE(@mobileNo, MobileNo),
            CustomerName = CASE 
                            WHEN @ResolvedCustomerName IS NOT NULL AND @ResolvedCustomerName <> '' AND @ResolvedCustomerName <> 'Guest' THEN @ResolvedCustomerName
                            WHEN CustomerName IS NOT NULL AND CustomerName <> '' AND CustomerName <> 'Guest' THEN CustomerName
                            ELSE ISNULL(@ResolvedCustomerName, CustomerName)
                           END,
            CustomerId = COALESCE(@ResolvedCustomerId, CustomerId),
            OrderNumber = CASE 
                            WHEN OrderNumber IS NULL OR OrderNumber = '' OR OrderNumber = 'PENDING' OR OrderNumber = 'NEW' OR OrderNumber = '#NEW' OR OrderNumber LIKE 'TEMP-%' THEN @orderNo 
                            ELSE OrderNumber 
                          END
        WHERE OrderId = @orderId 
      `);
  } else {
    orderGuid = require("crypto").randomUUID();
    let initialTakeawayCharge = 0;
    if (isTakeaway) {
      try {
        const settingsRes = await transaction.request().query("SELECT TOP 1 ISNULL(TakeawayCharges, 0) AS TakeawayCharges FROM CompanySettings WHERE Id = '1'");
        initialTakeawayCharge = parseFloat(settingsRes.recordset[0]?.TakeawayCharges) || 0;
      } catch (settingsErr) {
        console.warn("⚠️ [orders.js] Failed to fetch TakeawayCharges from settings:", settingsErr.message);
      }
    }

    const safeCustomer = (customerName || tableCustomerName || "Guest").substring(0, 9);
    await transaction
      .request()
      .input("orderId", sql.UniqueIdentifier, orderGuid)
      .input("orderNo", sql.NVarChar(50), cleanOrderNo)
      .input("tableNo", sql.VarChar(10), String(actualTableNo || "TAKEAWAY").substring(0, 10))
      .input("userId", sql.UniqueIdentifier, finalUserId)
      .input("bizId", sql.UniqueIdentifier, bizId)
      .input("priority", sql.Int, priorityCode)
      .input("isTakeaway", sql.Bit, isTakeaway ? 1 : 0)
      .input("pax", sql.Int, tablePax)
      .input("customerName", sql.NVarChar(9), safeCustomer)
      .input("takeawayCharge", sql.Decimal(18, 2), initialTakeawayCharge)
      .input("startDate", sql.Date, startDate)
      .input("discAmt", sql.Decimal(18, 2), discountAmount || 0)
      .input("discRemarks", sql.NVarChar(250), discountRemarks || null)
      .input("entryStatus", sql.NVarChar(10), isQROrder ? "q" : null)
      .input("mobileNo", sql.NVarChar(50), mobileNo || null)
      .input("rawCustomerId", sql.VarChar(50), rawCustIdStr)
      .query(`
        DECLARE @ResolvedCustomerId UNIQUEIDENTIFIER = NULL;
        IF @rawCustomerId IS NOT NULL AND TRY_CAST(@rawCustomerId AS UNIQUEIDENTIFIER) IS NOT NULL
          SET @ResolvedCustomerId = TRY_CAST(@rawCustomerId AS UNIQUEIDENTIFIER);
        ELSE IF @mobileNo IS NOT NULL AND @mobileNo <> ''
          SELECT TOP 1 @ResolvedCustomerId = MemberId 
          FROM MemberMaster 
          WHERE IsActive = 1 AND (
            Phone = @mobileNo 
            OR REPLACE(REPLACE(Phone, ' ', ''), '-', '') = REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '')
            OR (LEN(REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '')) >= 8 AND Phone LIKE '%' + REPLACE(REPLACE(@mobileNo, ' ', ''), '-', ''))
            OR (LEN(REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '')) >= 8 AND REPLACE(REPLACE(@mobileNo, ' ', ''), '-', '') LIKE '%' + REPLACE(REPLACE(Phone, ' ', ''), '-', ''))
          );

        DECLARE @FinalCustName NVARCHAR(9) = @customerName;
        IF (@FinalCustName IS NULL OR @FinalCustName = '' OR @FinalCustName = 'Guest') AND @ResolvedCustomerId IS NOT NULL
          SELECT TOP 1 @FinalCustName = SUBSTRING(Name, 1, 9) FROM MemberMaster WHERE MemberId = @ResolvedCustomerId;
        IF @FinalCustName IS NULL OR @FinalCustName = ''
          SET @FinalCustName = 'Guest';

        INSERT INTO RestaurantOrderCur (OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, isOrderClosed, BusinessUnitId, PriorityCode, IsTakeAway, Pax, CustomerName, TakeawayCharge, start_date, DiscountAmount, DiscountRemarks, entry_status, MobileNo, CustomerId) 
        VALUES (@orderId, @orderNo, GETDATE(), @tableNo, 1, @userId, GETDATE(), 0, @bizId, @priority, @isTakeaway, @pax, @FinalCustName, @takeawayCharge, @startDate, @discAmt, @discRemarks, @entryStatus, @mobileNo, @ResolvedCustomerId);
      `);
  }

  // 🛡️ GHOST SHIELD v2: Migrate SENT/READY items from orphaned open orders to the definitive order,
  // then close the orphaned orders. This prevents item loss when split-brain orders exist.
  // Takeaway orders must NEVER merge or migrate items from other orders!
  const isTakeawayTable = isTakeaway || String(actualTableNo).startsWith("TW") || actualTableNo === "TAKEAWAY";
  if (actualTableNo && actualTableNo !== "undefined" && !isTakeawayTable) {
    // Step 1: Find all other open orders for this table (ghost orders) - only if NOT settled
    const ghostOrdersRes = await transaction
      .request()
      .input("orderGuid", sql.UniqueIdentifier, orderGuid)
      .input("tableNo", sql.VarChar(20), actualTableNo)
      .query(`
        SELECT OrderId, OrderNumber
        FROM RestaurantOrderCur
        WHERE (RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@tableNo)) OR Tableno = @tableNo)
          AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
          AND OrderId <> @orderGuid
          AND NOT EXISTS (SELECT 1 FROM SettlementHeader sh WHERE sh.BillNo = RestaurantOrderCur.OrderNumber)
      `);

    if (ghostOrdersRes.recordset.length > 0) {
      for (const ghost of ghostOrdersRes.recordset) {
        console.log(`🔀 [GhostShield] Migrating items from ghost order ${ghost.OrderNumber} → definitive ${cleanOrderNo}`);
        // Step 2: Migrate all items from ghost → definitive order (avoid duplicating items already present)
        await transaction
          .request()
          .input("destOrderId", sql.UniqueIdentifier, orderGuid)
          .input("destOrderNo", sql.NVarChar(50), cleanOrderNo)
          .input("srcOrderId", sql.UniqueIdentifier, ghost.OrderId)
          .query(`
            -- Move all line items from ghost order to definitive order cleanly
            UPDATE RestaurantOrderDetailCur
            SET OrderId = @destOrderId,
                OrderNumber = @destOrderNo,
                ModifiedOn = GETDATE()
            WHERE OrderId = @srcOrderId;
          `);
      }

      // Step 3: Now safe to close all ghost orders (their items have been moved)
      await transaction
        .request()
        .input("orderGuid", sql.UniqueIdentifier, orderGuid)
        .input("tableNo", sql.VarChar(20), actualTableNo)
        .query(`
          UPDATE RestaurantOrderCur 
          SET isOrderClosed = 1, ModifiedOn = GETDATE() 
          WHERE Tableno = @tableNo 
            AND (isOrderClosed = 0 OR isOrderClosed IS NULL) 
            AND OrderId <> @orderGuid
        `);

      console.log(`✅ [GhostShield] Closed ${ghostOrdersRes.recordset.length} ghost order(s) after item migration`);
    }
  }

  // 🚀 OPTIMIZATION 2: Batch Item Processing (Chunked to avoid SQL Server 2100 parameter limit)
  const statusCodes = {
    NEW: 1,
    SENT: 2,
    READY: 3,
    SERVED: 4,
    HOLD: 5,
    VOIDED: 0,
  };

  const batchSize = 50;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const itemRequest = transaction.request();
    itemRequest.input("orderId", sql.UniqueIdentifier, orderGuid);
    itemRequest.input("userId", sql.UniqueIdentifier, finalUserId);
    itemRequest.input("bizId", sql.UniqueIdentifier, bizId);
    itemRequest.input("orderNo", sql.NVarChar(100), cleanOrderNo);
    itemRequest.input("startDate", sql.Date, startDate);

    let batchSql = "";

    chunk.forEach((item, idx) => {
      const cleanProdId = String(item.id || item.ProductId || DEFAULT_GUID)
        .replace(/^\{|\}$/g, "")
        .trim();
      const finalProdId = toGuidOrNull(cleanProdId) || DEFAULT_GUID;
      const lineItemId =
        toGuidOrNull(item.lineItemId) ||
        toGuidOrNull(item.id) ||
        require("crypto").randomUUID();
      const itemStatus = item.status || item.Status;
      const currentStatusCode = statusCodes[itemStatus] || 2;
      console.log(`[syncToProfessionalTables] Item: ${item.name || 'Dish'} | Incoming Status: ${itemStatus} | Computed StatusCode: ${currentStatusCode}`);
      const dishName = (item.name || item.ProductName || "Dish").substring(0, 200);
      const songName = (item.songName || item.SongName || "").substring(0, 200);
      const unitPrice = item.price || item.Cost || 0;
      const basePrice = item.basePrice !== undefined ? item.basePrice : unitPrice;
      const isCombo = item.isCombo === true || item.IsCombo === true || !!item.ComboDetailsJSON;

      let resolvedUnitPrice = unitPrice;
      let comboDetailsJSON = null;

      if (isCombo) {
        resolvedUnitPrice = unitPrice;
        let selections = item.comboSelections || item.ComboSelections || [];
        if (typeof selections === 'string' && selections) {
          try { selections = JSON.parse(selections); } catch { selections = []; }
        }
        if (selections && !Array.isArray(selections) && typeof selections === 'object') {
          if (Array.isArray(selections.groups)) {
            selections = selections.groups;
          }
        }
        const comboObj = {
          basePrice: basePrice,
          groups: Array.isArray(selections) ? selections : []
        };
        comboDetailsJSON = JSON.stringify(comboObj);
      }

      const noteInfo = { value: item.note || item.Note || item.notes || item.Notes || item.Remarks || item.remarks || "" };
      const takeawayInfo = { value: item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway || false };

      const modifiers = Array.isArray(item.modifiers || item.Modifiers) ? (item.modifiers || item.Modifiers) : [];
      let modsJSON = null;
      if (modifiers.length > 0) {
        modsJSON = JSON.stringify(modifiers);
      }

      const p_id = `id${idx}`,
        p_dish = `dish${idx}`,
        p_qty = `qty${idx}`,
        p_cost = `cost${idx}`,
        p_status = `status${idx}`,
        p_name = `name${idx}`,
        p_song = `song${idx}`,
        p_note = `note${idx}`,
        p_mods = `mods${idx}`,
        p_tw = `tw${idx}`,
        p_disc = `disc${idx}`,
        p_disctype = `disctype${idx}`,
        p_created = `created${idx}`,
        p_sc = `sc${idx}`,
        p_combo = `combo${idx}`;

      itemRequest.input(p_id, sql.UniqueIdentifier, lineItemId);
      itemRequest.input(p_dish, sql.UniqueIdentifier, finalProdId);
      itemRequest.input(p_qty, sql.Decimal(18, 3), item.qty || 1);
      itemRequest.input(p_cost, sql.Decimal(18, 2), resolvedUnitPrice);
      itemRequest.input(p_status, sql.Int, currentStatusCode);
      itemRequest.input(p_name, sql.NVarChar(200), dishName);
      itemRequest.input(p_song, sql.NVarChar(200), songName);
      itemRequest.input(p_note, sql.NVarChar(sql.MAX), noteInfo.value);
      itemRequest.input(p_mods, sql.NVarChar(sql.MAX), modsJSON);
      itemRequest.input(p_tw, sql.Bit, takeawayInfo.value ? 1 : 0);
      itemRequest.input(p_combo, sql.NVarChar(sql.MAX), comboDetailsJSON);
      itemRequest.input(p_disc, sql.Decimal(18, 2), item.discount || 0);

      const resolvedDiscountType =
        item.discountType || item.DiscountType
          ? item.discountType || item.DiscountType
          : (item.discount || 0) > 0
            ? "percentage"
            : "fixed";
      itemRequest.input(p_disctype, sql.NVarChar(50), resolvedDiscountType);

      const isTWItem =
        item.isTakeaway === true ||
        item.IsTakeaway === true ||
        item.isTakeAway === true ||
        item.IsTakeAway === true ||
        String(item.isTakeaway) === "1" ||
        String(item.IsTakeaway) === "1" ||
        String(item.isTakeAway) === "1" ||
        String(item.IsTakeAway) === "1" ||
        String(item.isTakeaway).toLowerCase() === "true" ||
        String(item.IsTakeaway).toLowerCase() === "true" ||
        String(item.isTakeAway).toLowerCase() === "true" ||
        String(item.IsTakeAway).toLowerCase() === "true";

      const isSC = !isTWItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true || Number(item.IsServiceCharge) === 1 || item.IsServiceCharge === true);
      let itemSC = null;
      const qtyVal = Number(item.qty || 1);
      const priceVal = Number(unitPrice || 0);
      const discVal = Number(item.discount || 0);
      let itemDiscount = 0;
      if (discVal > 0) {
        const discountBasis = isCombo ? Number(item.basePrice || priceVal) : priceVal;
        if (resolvedDiscountType === "percentage") {
          itemDiscount = discountBasis * qtyVal * (discVal / 100);
        } else {
          itemDiscount = Math.min(discVal, discountBasis) * qtyVal;
        }
      }
      const itemSubtotal = priceVal * qtyVal - itemDiscount;

      if (isTWItem) {
        if (twServiceChargePercentage > 0) {
          itemSC = itemSubtotal * (twServiceChargePercentage / 100);
        }
      } else if (isSC) {
        itemSC = itemSubtotal * (serviceChargePercentage / 100);
      }
      itemRequest.input(p_sc, sql.Decimal(18, 2), itemSC);

      let itemDate = null;
      const rawCreated = item.DateCreated || item.dateCreated || item.CreatedOn;
      if (rawCreated) {
        itemDate = new Date(rawCreated);
        if (isNaN(itemDate.getTime())) {
          itemDate = new Date(Date.now() + idx);
        }
      } else {
        itemDate = new Date(Date.now() + idx);
      }
      itemRequest.input(p_created, sql.DateTime, itemDate);

      batchSql += `
        -- Process Item ${idx}
        IF EXISTS (SELECT 1 FROM RestaurantOrderDetailCur WHERE OrderDetailId = @${p_id})
        BEGIN
          UPDATE RestaurantOrderDetailCur SET 
            OrderId = @orderId,
            Quantity = @${p_qty}, PricePerUnit = @${p_cost},
            ActualAmount = @${p_cost} * @${p_qty},
            TotalDetailLineAmount = @${p_cost} * @${p_qty},
            BaseAmount = @${p_cost} * @${p_qty},
            StatusCode = CASE WHEN @${p_status} = 0 THEN 0 ELSE (CASE WHEN @${p_status} > StatusCode THEN @${p_status} ELSE StatusCode END) END, 
            Description = @${p_name}, DishName = @${p_name},SongName = @${p_song}, ModifiedBy = @userId, ModifiedOn = GETDATE(), 
            ModifiersJSON = @${p_mods}, ComboDetailsJSON = @${p_combo}, OrderNumber = @orderNo, Remarks = @${p_note}, isTakeAway = @${p_tw},
            DiscountAmount = @${p_disc}, DiscountType = @${p_disctype}, ServiceCharge = @${p_sc},
            CreatedOn = CASE WHEN StatusCode = 1 AND @${p_status} = 2 THEN GETDATE() ELSE ISNULL(CreatedOn, @${p_created}) END
          WHERE OrderDetailId = @${p_id};
        END
        ELSE
        BEGIN
          DECLARE @existingVoidedId${idx} UNIQUEIDENTIFIER = NULL;
          SELECT TOP 1 @existingVoidedId${idx} = OrderDetailId
          FROM RestaurantOrderDetailCur
          WHERE OrderId = @orderId AND DishId = @${p_dish} AND StatusCode = 0
          ORDER BY ModifiedOn DESC;

          IF @existingVoidedId${idx} IS NOT NULL
          BEGIN
            UPDATE RestaurantOrderDetailCur SET
              OrderDetailId = @${p_id},
              Quantity = @${p_qty}, PricePerUnit = @${p_cost},
              ActualAmount = @${p_cost} * @${p_qty},
              TotalDetailLineAmount = @${p_cost} * @${p_qty},
              BaseAmount = @${p_cost} * @${p_qty},
              StatusCode = @${p_status},
              Description = @${p_name}, DishName = @${p_name}, SongName = @${p_song},
              ModifiedBy = @userId, ModifiedOn = GETDATE(),
              ModifiersJSON = @${p_mods}, ComboDetailsJSON = @${p_combo},
              OrderNumber = @orderNo, Remarks = @${p_note}, isTakeAway = @${p_tw},
              DiscountAmount = @${p_disc}, DiscountType = @${p_disctype}, ServiceCharge = @${p_sc},
              CreatedOn = GETDATE()
            WHERE OrderDetailId = @existingVoidedId${idx};
          END
          ELSE
          BEGIN
            INSERT INTO RestaurantOrderDetailCur (OrderDetailId, OrderId, DishId, Description, DishName,SongName, Quantity, PricePerUnit, ActualAmount, TotalDetailLineAmount, BaseAmount, StatusCode, CreatedBy, CreatedOn, ModifiersJSON, ComboDetailsJSON, OrderNumber, Remarks, isTakeAway, BusinessUnitId, OrderDateTime, DiscountAmount, DiscountType, ServiceCharge, start_date)
            VALUES (@${p_id}, @orderId, @${p_dish}, @${p_name}, @${p_name}, @${p_song}, @${p_qty}, @${p_cost}, @${p_cost} * @${p_qty}, @${p_cost} * @${p_qty}, @${p_cost} * @${p_qty}, @${p_status}, @userId, CASE WHEN @${p_status} = 2 THEN GETDATE() ELSE @${p_created} END, @${p_mods}, @${p_combo}, @orderNo, @${p_note}, @${p_tw}, @bizId, GETDATE(), @${p_disc}, @${p_disctype}, @${p_sc}, @startDate);
          END
        END

        DELETE FROM RestaurantmodifierdetailCur WHERE OrderDetailId = @${p_id};
      `;

      const modItems = [...modifiers];
      if (noteInfo.value)
        modItems.push({
          ModifierId: "00000000-0000-0000-0000-000000000001",
          ModifierName: "INSTR: " + noteInfo.value,
          Price: 0,
          qty: item.qty || 1,
        });

      if (modItems.length > 0) {
        batchSql += `INSERT INTO RestaurantmodifierdetailCur (OrderDetailId, OrderId, DishId, ModifierId, Quantity, Amount, ModifierName, CreatedBy, CreatedOn, start_date) VALUES `;
        modItems.forEach((mod, midx) => {
          const pm_id = `mId${idx}_${midx}`,
            pm_qty = `mQty${idx}_${midx}`,
            pm_amt = `mAmt${idx}_${midx}`,
            pm_name = `mName${idx}_${midx}`;

          const safeModId =
            mod.ModifierId && mod.ModifierId.length > 30
              ? mod.ModifierId
              : "00000000-0000-0000-0000-000000000001";

          itemRequest.input(pm_id, sql.UniqueIdentifier, safeModId);
          itemRequest.input(pm_qty, sql.Int, mod.qty || 1);
          itemRequest.input(pm_amt, sql.Decimal(18, 2), mod.Price || 0);
          itemRequest.input(
            pm_name,
            sql.NVarChar(800),
            (mod.ModifierName || "").substring(0, 800),
          );
          batchSql += `(@${p_id}, @orderId, @${p_dish}, @${pm_id}, @${pm_qty}, @${pm_amt}, @${pm_name}, @userId, GETDATE(), @startDate)${midx === modItems.length - 1 ? ";" : ","}`;
        });
      }
    });

    if (batchSql) {
      await itemRequest.query(batchSql);
    }
  }

  // 🚀 OPTIMIZATION 3: Smart Removal & Cleanup Request
  const incomingIds = items
    .map((i) => i.lineItemId)
    .filter((id) => !!id && id.length > 5);
  const notInClause =
    incomingIds.length > 0
      ? `AND OrderDetailId NOT IN (${incomingIds.map((id) => `'${id}'`).join(",")})`
      : "";

  console.log(
    `[DB] Syncing Order ${cleanOrderNo} (${orderGuid}): Processing ${items.length} items, keeping ${incomingIds.length} IDs.`,
  );

  // 🛡️ SAFE REMOVAL GUARD: When called with 0 items and no incoming IDs to keep,
  // the DELETE below would erase ALL StatusCode=1 (NEW) items. This is destructive when
  // a save-cart with empty items races against an in-flight /send that hasn't committed yet.
  // Check first: if the order has any SENT/READY/SERVED items, skip the destructive DELETE.
  let skipSmartRemoval = false;
  if (items.length === 0 && orderGuid) {
    const activeSentCheck = await transaction.request()
      .input("orderGuidCheck", sql.UniqueIdentifier, orderGuid)
      .query(`SELECT COUNT(*) AS cnt FROM RestaurantOrderDetailCur WHERE OrderId = @orderGuidCheck AND StatusCode >= 2`);
    const sentItemCount = activeSentCheck.recordset[0]?.cnt || 0;
    if (sentItemCount > 0) {
      console.log(`[DB] SMART REMOVAL SKIPPED for Order ${cleanOrderNo} — ${sentItemCount} SENT/READY items exist. Preserving order state.`);
      skipSmartRemoval = true;
    } else {
      console.log(`[DB] CLEARING ALL UNSENT for Order ${cleanOrderNo}`);
    }
  }

  if (!skipSmartRemoval) {
    const cleanupRequest = transaction.request();
    cleanupRequest.input("orderId", sql.UniqueIdentifier, orderGuid);

    const cleanupSql = `
      -- Smart Removal: Delete unsent items that are no longer in the cart
      DELETE FROM RestaurantmodifierdetailCur WHERE OrderDetailId IN (SELECT OrderDetailId FROM RestaurantOrderDetailCur WHERE OrderId = @orderId AND StatusCode = 1 ${notInClause});
      DELETE FROM RestaurantOrderDetailCur WHERE OrderId = @orderId AND StatusCode = 1 ${notInClause};
      
      -- Final Header Total Update
      UPDATE RestaurantOrderCur SET TotalAmount = (SELECT ISNULL(SUM(ActualAmount), 0) FROM RestaurantOrderDetailCur WHERE OrderId = @orderId AND StatusCode <> 0) WHERE OrderId = @orderId;
    `;
    await cleanupRequest.query(cleanupSql);
  } else {
    // Still update the total without touching items
    const totalRequest = transaction.request();
    totalRequest.input("orderId", sql.UniqueIdentifier, orderGuid);
    await totalRequest.query(`
      UPDATE RestaurantOrderCur SET TotalAmount = (SELECT ISNULL(SUM(ActualAmount), 0) FROM RestaurantOrderDetailCur WHERE OrderId = @orderId AND StatusCode <> 0) WHERE OrderId = @orderId;
    `);
  }
}

async function syncTableStatus(req, tableId) {
  if (!tableId || tableId === "undefined" || tableId === "null") return null;
  const cleanId = String(tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();

  const pool = await poolPromise;
  const res = await pool.request().input("tid", sql.VarChar(50), cleanId)
    .query(`
    DECLARE @TableNo VARCHAR(50);
    DECLARE @TableId UNIQUEIDENTIFIER;
    DECLARE @CurrentOrderId NVARCHAR(50);

    IF TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL
    BEGIN
      SELECT TOP 1 @TableNo = TableNumber, @TableId = TableId, @CurrentOrderId = CurrentOrderId FROM TableMaster WHERE TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER);
    END
    ELSE
    BEGIN
      SELECT TOP 1 @TableNo = TableNumber, @TableId = TableId, @CurrentOrderId = CurrentOrderId FROM TableMaster WHERE TableNumber = @tid;
    END

    IF @TableNo IS NULL SET @TableNo = @tid;

    DECLARE @ActualOrderId UNIQUEIDENTIFIER, @ActualOrderNo NVARCHAR(50), @count INT, @total DECIMAL(18,2);

    -- 🚀 ROBUST LOOKUP: Prioritize the CurrentOrderId stored in TableMaster to avoid ghost orders
    SELECT TOP 1 @ActualOrderId = OrderId, @ActualOrderNo = OrderNumber
    FROM RestaurantOrderCur 
    WHERE ((OrderId = (SELECT TOP 1 OrderId FROM RestaurantOrderCur h2 WHERE h2.OrderNumber = @CurrentOrderId AND (h2.isOrderClosed = 0 OR h2.isOrderClosed IS NULL)))
       OR ((RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@TableNo)) OR RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@tid))) AND (isOrderClosed = 0 OR isOrderClosed IS NULL)))
       AND EXISTS (SELECT 1 FROM RestaurantOrderDetailCur d WHERE d.OrderId = RestaurantOrderCur.OrderId AND d.StatusCode <> 0)
    ORDER BY CASE WHEN OrderNumber = @CurrentOrderId THEN 0 ELSE 1 END, CreatedOn DESC;

    DECLARE @TakeawayOverride INT = 0;
    DECLARE @SCOverride INT = 0;

    IF EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'RestaurantOrderCur' AND COLUMN_NAME = 'TakeawayChargeOverride'
    )
    BEGIN
      EXEC sp_executesql N'SELECT TOP 1 @out = ISNULL(TakeawayChargeOverride, 0) FROM RestaurantOrderCur WHERE OrderId = @OrderId', N'@OrderId UNIQUEIDENTIFIER, @out INT OUTPUT', @ActualOrderId, @TakeawayOverride OUTPUT;
    END

    IF EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'RestaurantOrderCur' AND COLUMN_NAME = 'ServiceChargeOverride'
    )
    BEGIN
      EXEC sp_executesql N'SELECT TOP 1 @out = ISNULL(ServiceChargeOverride, 0) FROM RestaurantOrderCur WHERE OrderId = @OrderId', N'@OrderId UNIQUEIDENTIFIER, @out INT OUTPUT', @ActualOrderId, @SCOverride OUTPUT;
    END

    -- Calculate Totals strictly including Service Charge, Takeaway Charges and GST
    DECLARE @subtotal DECIMAL(18,2) = 0;
    DECLARE @serviceCharge DECIMAL(18,2) = 0;
    DECLARE @takeawayCharge DECIMAL(18,2) = 0;
    DECLARE @takeawayRate DECIMAL(18,2) = 0;
    DECLARE @gstRate DECIMAL(18,2) = 0.09; -- default 9%
    DECLARE @discountAmount DECIMAL(18,2) = 0;

    SELECT TOP 1 @takeawayRate = ISNULL(TakeawayCharges, 0) FROM CompanySettings;

    SELECT 
        @count = COUNT(*), 
        @subtotal = ISNULL(SUM(d.ActualAmount), 0),
        @serviceCharge = CASE WHEN @SCOverride = 1 THEN 0 ELSE ISNULL(SUM(d.ServiceCharge), 0) END,
        @takeawayCharge = CASE 
            WHEN @TakeawayOverride = 1 THEN 0 
            ELSE ISNULL(SUM(d.Quantity * CASE 
                WHEN d.isTakeAway = 1 THEN 
                    CASE 
                        WHEN ISNULL(dish.TakeawayCharge, 0) > 0 THEN dish.TakeawayCharge 
                        ELSE @takeawayRate 
                    END
                ELSE 0 
            END), 0) 
        END
    FROM RestaurantOrderDetailCur d
    LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
    WHERE d.OrderId = @ActualOrderId AND d.StatusCode <> 0;

    SELECT TOP 1 @discountAmount = ISNULL(DiscountAmount, 0) FROM RestaurantOrderCur WHERE OrderId = @ActualOrderId;

    SELECT TOP 1 @gstRate = ISNULL(GSTPercentage, 0) / 100.0 FROM CompanySettings;
    IF @gstRate IS NULL SET @gstRate = 0.09;

    DECLARE @taxableSubtotal DECIMAL(18,2) = @subtotal - @discountAmount;
    IF @taxableSubtotal < 0 SET @taxableSubtotal = 0;

    SET @total = ROUND(@taxableSubtotal + @serviceCharge + @takeawayCharge + ((@taxableSubtotal + @serviceCharge + @takeawayCharge) * @gstRate), 2);

    -- Update RestaurantOrderCur with calculated TakeawayCharge
    IF @ActualOrderId IS NOT NULL
    BEGIN
        UPDATE RestaurantOrderCur 
        SET TakeawayCharge = @takeawayCharge,
            DiscountAmount = @discountAmount,
            TotalDiscountAmount = @discountAmount,
            ServiceCharge = @serviceCharge,
            TotalTax = ROUND((@taxableSubtotal + @serviceCharge + @takeawayCharge) * @gstRate, 2),
            TotalAmount = @total
        WHERE OrderId = @ActualOrderId;
    END

    -- 🛡️ SHIELD 1: ATOMIC SYNC - If no items, force close the order to prevent ghosts
    IF @count = 0 AND @ActualOrderId IS NOT NULL
    BEGIN
        UPDATE RestaurantOrderCur SET isOrderClosed = 1, ModifiedOn = GETDATE() WHERE OrderId = @ActualOrderId;
        SET @ActualOrderNo = NULL;
    END

    -- Update TableMaster with DEFINITIVE state
    -- 🛡️ Protect active Takeaway QR sessions (DiningSection 4, entry_status 'q') within 15 mins from being cleared when @count = 0
    UPDATE TableMaster 
    SET Status = CASE 
        WHEN @count = 0 AND (CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15) THEN Status
        WHEN @count = 0 THEN 0
        WHEN Status = 2 THEN 2 
        WHEN Status = 3 THEN 3
        WHEN @count > 0 THEN 1 
        ELSE 0 
    END, 
    entry_status = CASE 
        WHEN @count = 0 AND (CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15) THEN entry_status
        WHEN @count = 0 THEN NULL 
        ELSE entry_status 
    END,
    TotalAmount = @total, 
    StartTime = CASE 
                     -- 🚀 NEW ORDER RESET: If the Order ID is changing, reset the timer to fresh
                     WHEN @ActualOrderNo IS NOT NULL AND @ActualOrderNo <> ISNULL(CurrentOrderId, '') THEN GETDATE()
                     -- INITIAL SET: If it was NULL/Invalid and we now have items
                     WHEN (@count > 0 OR Status IN (2, 3)) AND (StartTime IS NULL OR StartTime < '2000-01-01') THEN GETDATE() 
                     -- Keep StartTime if active Takeaway QR table with 0 items
                     WHEN @count = 0 AND (CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15) THEN StartTime
                     -- Strictly CLEAR StartTime if table has 0 items
                     WHEN @count = 0 THEN NULL 
                     ELSE StartTime 
                END,
    CustomerName = CASE 
                     WHEN @count = 0 AND (CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15) THEN CustomerName
                     WHEN @count = 0 THEN NULL 
                     ELSE CustomerName 
                END,
    Pax = CASE 
                     WHEN @count = 0 AND (CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15) THEN Pax
                     WHEN @count = 0 THEN NULL 
                     ELSE Pax 
                END,
    CurrentOrderId = CASE 
                     WHEN @count = 0 AND (CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15) THEN CurrentOrderId
                     ELSE @ActualOrderNo
                END,
    ModifiedOn = GETDATE()
    WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER));

    SELECT 
      TableId, Status, entry_status AS entryStatus, PAYMENT_STATUS AS paymentStatus, TotalAmount, CONVERT(VARCHAR, StartTime, 126) AS StartTime, 
      CurrentOrderId, TableNumber as tableNo, DiningSection as section, CustomerName as customerName, Pax as pax,
      CASE 
        WHEN Status IN (1, 2, 3) AND StartTime IS NOT NULL AND DATEDIFF(MINUTE, StartTime, GETDATE()) >= 60 THEN 1 
        ELSE 0 
      END AS isOvertime,
      CASE 
        WHEN Status = 3 AND ModifiedOn IS NOT NULL AND DATEDIFF(MINUTE, ModifiedOn, GETDATE()) >= ISNULL((SELECT TOP 1 HoldOvertimeMinutes FROM CompanySettings), 30) THEN 1 
        ELSE 0 
      END AS isHoldOvertime,
      CONVERT(VARCHAR, ModifiedOn, 126) as ModifiedOn
    FROM TableMaster WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER));
  `);

  const updated = res.recordset[0];
  const now = Date.now();
  console.log(
    `[TRACE] [${now}] [TABLE_STATUS_UPDATE] Table: ${tableId} | Status: ${updated?.Status} | Total: ${updated?.TotalAmount}`,
  );
  if (updated) {
    const sectionMap = {
      1: "SECTION_1",
      2: "SECTION_2",
      3: "SECTION_3",
      4: "TAKEAWAY",
    };
    const cleanOrderId = updated.CurrentOrderId || "EMPTY";
    const targetTableId = updated.TableId ? String(updated.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase() : cleanId.toLowerCase();

    console.log(
      `[TRACE] [${Date.now()}] [SOCKET_EMIT] table_status_updated | Table: ${cleanId} (TargetId: ${targetTableId}) | Status: ${updated.Status} | PaymentStatus: ${updated.paymentStatus}`,
    );
    req.app.get("io")?.emit("table_status_updated", {
      tableId: targetTableId,
      rawTableId: updated.TableId,
      status: Number(updated.Status),
      totalAmount: Number(updated.TotalAmount) || 0,
      startTime: updated.StartTime,
      currentOrderId: cleanOrderId,
      tableNo: updated.tableNo,
      section: sectionMap[String(updated.section)] || updated.section,
      modifiedOn: updated.ModifiedOn,
      isOvertime: updated.isOvertime || 0,
      isHoldOvertime: updated.isHoldOvertime || 0,
      entryStatus: updated.entryStatus || null,
      paymentStatus:
        updated.paymentStatus !== undefined && updated.paymentStatus !== null
          ? Number(updated.paymentStatus)
          : null,
      customerName: updated.customerName || null,
      pax: updated.pax !== undefined ? Number(updated.pax) : null,
    });
  }
  return updated;
}

// Routes
router.post("/save-cart", async (req, res) => {
  try {
    const {
      tableId,
      items,
      userId,
      orderId,
      lastUpdate,
      version,
      skipTableStatusSync,
      entryStatus,
      mobileNo,
      customerName,
    } = req.body;
    const pool = await poolPromise;

    // Day Start / Day End validation check
    const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    if (activeDayRes.recordset.length === 0) {
      return res.status(400).json({ error: "No active business date. Please Start Day first." });
    }
    const activeStartDate = activeDayRes.recordset[0].StartDate;
    const formattedStartDate = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : activeStartDate;

    const cleanId = await getCleanTableId(pool, tableId);
    const now = Date.now();

    console.log(
      `[TRACE] [${now}] [SAVE-CART] Table: ${cleanId} | Items: ${items?.length || 0} | Version: ${version || "NONE"} | Update: ${lastUpdate || "NONE"}`,
    );

    // 🚀 UNIFIED ID: Only generate a professional ID if we actually have items to save
    // 🚀 UNIFIED ID: Use existing orderId if available, even for empty carts
    let currentOrderId = orderId;
    const hasItems = items && items.length > 0;
    let nuclearClearWasBlocked = false; // 🛡️ Set to true when nuclear clear is skipped due to SENT items in DB

    if (
      hasItems &&
      (!currentOrderId ||
        currentOrderId === "NEW" ||
        currentOrderId === "#NEW" ||
        currentOrderId === "PENDING" ||
        currentOrderId.length < 10)
    ) {
      currentOrderId = await getOrGenerateOrderId(req, cleanId);
    } else if (!hasItems) {
      // 🚀 SAFETY: If saving empty cart, only delete unsent StatusCode=1 draft items for this table.
      // NEVER close open orders (isOrderClosed=1) or reset TableMaster.Status=0 during a cart save!
      const sentCheckRes = await pool.request().input("tidForCheck", sql.VarChar(50), cleanId).query(`
        DECLARE @TableNoCheck VARCHAR(50);
        SELECT TOP 1 @TableNoCheck = TableNumber FROM TableMaster WHERE TableNumber = @tidForCheck OR (TRY_CAST(@tidForCheck AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tidForCheck AS UNIQUEIDENTIFIER));
        IF @TableNoCheck IS NULL SET @TableNoCheck = @tidForCheck;

        SELECT COUNT(*) AS SentCount
        FROM RestaurantOrderDetailCur d
        JOIN RestaurantOrderCur h ON h.OrderId = d.OrderId
        WHERE (h.Tableno = @TableNoCheck OR h.Tableno = @tidForCheck)
          AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
          AND d.StatusCode >= 2
      `);
      const sentCount = sentCheckRes.recordset[0]?.SentCount || 0;

      if (sentCount > 0) {
        console.log(`[TRACE] [${now}] [SAVE-CART] DB has ${sentCount} SENT/READY items. Preserving active order.`);
        currentOrderId = orderId || null;
        nuclearClearWasBlocked = true;
      } else {
        console.log(`[TRACE] [${now}] [SAVE-CART] Clearing unsent draft items for Table ${cleanId}`);
        await pool.request().input("tid", sql.VarChar(50), cleanId).query(`
            DECLARE @TableNo VARCHAR(50);
            SELECT TOP 1 @TableNo = TableNumber FROM TableMaster WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER));
            IF @TableNo IS NULL SET @TableNo = @tid;

            -- Delete ONLY unsent StatusCode=1 draft items for open orders on this table
            DELETE FROM RestaurantmodifierdetailCur WHERE OrderDetailId IN (
              SELECT OrderDetailId FROM RestaurantOrderDetailCur WHERE OrderId IN (
                SELECT OrderId FROM RestaurantOrderCur WHERE (Tableno = @TableNo OR Tableno = @tid) AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
              ) AND StatusCode = 1
            );
            DELETE FROM RestaurantOrderDetailCur WHERE OrderId IN (
              SELECT OrderId FROM RestaurantOrderCur WHERE (Tableno = @TableNo OR Tableno = @tid) AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
            ) AND StatusCode = 1;
          `);
        currentOrderId = orderId || null;
        nuclearClearWasBlocked = true;
      }
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      // 🛡️ SAFETY: If items is empty AND we blocked the nuclear clear (SENT items exist),
      // do NOT call syncToProfessionalTables — it would delete all StatusCode=1 NEW items
      // via Smart Removal, leaving 0 items total and causing syncTableStatus to close the order.
      if (!nuclearClearWasBlocked) {
        await syncToProfessionalTables(
          transaction,
          cleanId,
          currentOrderId,
          items || [],
          userId,
          formattedStartDate,
          entryStatus === "q",
          0,
          null,
          mobileNo,
          customerName,
        );
      } else {
        console.log(`[TRACE] [${now}] [SAVE-CART] Skipping syncToProfessionalTables — nuclear clear was blocked, order ${currentOrderId} has active SENT items, preserving DB state.`);
      }

      // 🚀 CRITICAL: Update TableMaster INSIDE the same transaction
      await transaction
        .request()
        .input("tid", sql.VarChar(50), cleanId)
        .input("oid", sql.NVarChar(50), currentOrderId)
        .input("skipSync", sql.Bit, !!skipTableStatusSync).query(`
          UPDATE TableMaster 
          SET Status = CASE 
                         WHEN @skipSync = 1 AND Status IN (2, 3) THEN Status 
                         WHEN @oid IS NOT NULL THEN 1 
                         WHEN CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15 THEN Status
                         ELSE 0 
                       END, 
              CurrentOrderId = @oid,
              StartTime = CASE WHEN @oid IS NOT NULL AND (StartTime IS NULL OR StartTime < '2000-01-01') THEN GETDATE() 
                               WHEN @oid IS NULL AND (CAST(DiningSection AS VARCHAR(10)) = '4' AND entry_status = 'q' AND DATEDIFF(MINUTE, ISNULL(StartTime, ModifiedOn), GETDATE()) < 15) THEN StartTime
                               WHEN @oid IS NULL THEN NULL 
                               ELSE StartTime END
          WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
        `);

      // 🔹 QR ORDER: If entryStatus is 'q', set table to Status 1 (Dining/Active)
      if (entryStatus === "q" && hasItems) {
        await transaction.request().input("tid", sql.VarChar(50), cleanId)
          .query(`
            UPDATE TableMaster SET Status = 1, entry_status = 'q', PAYMENT_STATUS = 0 WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
          `);
      }

      await transaction.commit();

      res.json({ success: true, orderId: currentOrderId });

      // 🔥 LIVE SYNC: Notify all other devices that this table's cart has changed
      const io = req.app.get("io");
      if (io) {
        io.emit("cart_updated", {
          tableId: cleanId.toLowerCase(),
          orderId: currentOrderId,
          source: skipTableStatusSync ? "pos_auto_save" : "normal",
        });
      }

      // Always sync table status to update the payable amount instantly on the main grid via socket/db
      syncTableStatus(req, cleanId).catch(() => { });
    } catch (e) {
      if (transaction._isStarted) await transaction.rollback();
      console.error("❌ SaveCart SQL Error FULL:", e);
      console.error("❌ SaveCart SQL Message:", e.message);
      console.error("❌ SaveCart SQL Stack:", e.stack);
      require("fs").appendFileSync(
        "error_log.txt",
        new Date().toISOString() + " " + e.stack + "\n",
      );
      res.status(500).json({
        error: e.message,
        stack: e.stack,
      });
    }
  } catch (err) {
    console.error("SAVE CART ERROR:", err);
    require("fs").appendFileSync(
      "error_log.txt",
      new Date().toISOString() + " " + err.stack + "\n",
    );
    res.status(500).json({ error: err.message });
  }
});

// 🛡️ DUP-GUARD & LOCKING: In-memory lock & deduplication cache for /api/orders/send
const activeSendLocks = new Map(); // tableKey -> Promise
const recentSendCache = new Map(); // tableKey -> { timestamp, orderId, signature }

function generateItemsSignature(items) {
  if (!items || !Array.isArray(items) || items.length === 0) return "";
  return items
    .map((item) => {
      const id = item.id || item.DishId || item.lineItemId || "";
      const qty = item.qty || item.Quantity || 1;
      const mods = Array.isArray(item.modifiers) ? item.modifiers.map(m => m.ModifierId || m.name || m.modifierName || '').sort().join(',') : '';
      return `${id}:${qty}:${mods}`;
    })
    .sort()
    .join("|");
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of recentSendCache.entries()) {
    if (now - val.timestamp > 10000) {
      recentSendCache.delete(key);
    }
  }
}, 30000);

router.post("/send", async (req, res) => {
  let tableKey = "";
  let resolveLock, rejectLock;
  try {
    const { tableId, orderId, items, userId, discountAmount, discountRemarks, mobileNo, customerName } = req.body;
    const pool = await poolPromise;
    const cleanId = await getCleanTableId(pool, tableId);
    tableKey = String(cleanId).toLowerCase().trim();
    const signature = generateItemsSignature(items);

    // 🛡️ DEDUP CHECK 1: If exact same items were sent for this table within 5 seconds, block duplicate execution
    const now = Date.now();
    const recent = recentSendCache.get(tableKey);
    if (recent && (now - recent.timestamp < 5000) && signature && recent.signature === signature) {
      console.warn(`🛡️ [Send Guard] Blocked duplicate /send request for table "${cleanId}" (${now - recent.timestamp}ms ago). Returning OrderId: ${recent.orderId}`);
      return res.json({ success: true, orderId: recent.orderId, duplicateBlocked: true });
    }

    // 🛡️ CONCURRENCY LOCK 2: If another /send is currently in progress for this table, wait for it
    if (activeSendLocks.has(tableKey)) {
      console.warn(`🛡️ [Send Guard] Concurrent /send request for table "${cleanId}" detected. Waiting for in-flight send...`);
      try {
        await activeSendLocks.get(tableKey);
        const postLockRecent = recentSendCache.get(tableKey);
        if (postLockRecent && signature && postLockRecent.signature === signature) {
          console.warn(`🛡️ [Send Guard] Post-lock duplicate request resolved for table "${cleanId}". Returning OrderId: ${postLockRecent.orderId}`);
          return res.json({ success: true, orderId: postLockRecent.orderId, duplicateBlocked: true });
        }
      } catch (waitErr) {
        // In-flight send failed, allow current send to proceed
      }
    }

    const lockPromise = new Promise((resolve, reject) => {
      resolveLock = resolve;
      rejectLock = reject;
    });
    activeSendLocks.set(tableKey, lockPromise);

    // 1. 🚀 GENERATE PROFESSIONAL ID NOW (Before transaction to avoid nested transaction deadlocks)
    // Check if this table already has active SENT items in DB (= additional order)
    const sentCountCheck = await pool.request()
      .input('tidForCheck', sql.VarChar(50), cleanId)
      .query(`
        DECLARE @TableNoCheck VARCHAR(20);
        SELECT TOP 1 @TableNoCheck = TableNumber FROM TableMaster WHERE TableNumber = @tidForCheck OR (TRY_CAST(@tidForCheck AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tidForCheck AS UNIQUEIDENTIFIER));

        SELECT COUNT(*) AS SentCount
        FROM RestaurantOrderDetailCur d
        JOIN RestaurantOrderCur h ON h.OrderId = d.OrderId
        WHERE (RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@TableNoCheck)) OR RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@tidForCheck)))
          AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
          AND d.StatusCode >= 2
      `);

    const existingSentCount = sentCountCheck.recordset[0]?.SentCount || 0;
    const isAdditionalOrder = existingSentCount > 0;

    const finalOrderId = await getOrGenerateOrderId(req, cleanId);

    const isQROrder = req.body.entryStatus === "q";
    const isTakeawayOrder = req.body.orderType === "TAKEAWAY" || !cleanId || cleanId === "TAKEAWAY" || String(cleanId).startsWith("TAKEAWAY");
    let sentItems = [];

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {

      // 2. FORCE SENT STATUS — use items from client, or fall back to DB items
      let clientItems = items || [];
      if (clientItems.length === 0) {
        // 🔥 SAFETY NET: Frontend forgot to send items. Fetch from DB.
        console.warn(
          "⚠️ [Send] No items received from client - fetching from DB as fallback",
        );
        const dbItems = await transaction
          .request()
          .input("tableNo", sql.VarChar(20), cleanId).query(`SELECT 
            d.OrderDetailId as lineItemId, d.DishId as id, dish.Name as name,
            d.Quantity as qty, d.PricePerUnit as price, d.StatusCode, 
            d.ModifiersJSON, d.Remarks as note, d.isTakeAway as isTakeaway,
            ISNULL(d.DiscountAmount, 0) as discount,
            ISNULL(d.DiscountType, NULL) as discountType,
            CAST(ISNULL(dish.IsDiscountAllowed, 1) AS INT) as IsDiscountAllowed,
            ISNULL(dish.TakeawayCharge, 0) as takeawayCharge,
            ISNULL(dish.TakeawayCharge, 0) as TakeawayCharge,
            ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode, 
            ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
            pm.PrinterPath as PrinterIP
            FROM RestaurantOrderDetailCur d
            JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
            LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
            LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
            LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
            LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
            LEFT JOIN (
              SELECT *, ROW_NUMBER() OVER(PARTITION BY KitchenTypeValue ORDER BY PrinterId) as rn 
              FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
            ) pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.rn = 1
            WHERE (RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM((SELECT TOP 1 TableNumber FROM TableMaster WHERE TableNumber = @tableNo OR (TRY_CAST(@tableNo AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tableNo AS UNIQUEIDENTIFIER)))))
              OR RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@tableNo))) 
              AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL) 
              AND d.StatusCode <> 0`);
        clientItems = dbItems.recordset;
      }
      sentItems = clientItems.map((item) => ({
        ...item,
        status:
          item.status === "VOIDED" || item.StatusCode === 0 ? "VOIDED" : "SENT",
      }));

      // 2.5 Resolve kitchen details for each item to ensure correct KOT routing on the POS side
      try {
        const dishIds = sentItems.map(item => item.id).filter(id => !!id && id.length > 5);
        if (dishIds.length > 0) {
          const kitchenRes = await transaction.request()
            .query(`
              SELECT 
                dish.DishId as id,
                ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode, 
                ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
                pm.PrinterPath as PrinterIP
              FROM DishMaster dish
              LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
              LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
              LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
              LEFT JOIN (
                SELECT *, ROW_NUMBER() OVER(PARTITION BY KitchenTypeValue ORDER BY PrinterId) as rn 
                FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
              ) pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.rn = 1
              WHERE dish.DishId IN (${dishIds.map(id => `'${id}'`).join(",")})
            `);

          const kitchenMap = {};
          kitchenRes.recordset.forEach(row => {
            kitchenMap[row.id.toLowerCase()] = row;
          });

          sentItems.forEach(item => {
            const kInfo = kitchenMap[String(item.id).toLowerCase()];
            if (kInfo) {
              item.KitchenTypeCode = kInfo.KitchenTypeCode;
              item.KitchenTypeName = kInfo.KitchenTypeName;
              item.PrinterIP = kInfo.PrinterIP;
            }
          });
        }
      } catch (err) {
        console.warn("⚠️ Failed to resolve kitchen info for sentItems:", err.message);
      }

      // 2.8 🛡️ ADDITIONAL ORDER PROTECTION: If existing active items exist in DB for this order,
      // fetch them and merge with sentItems so syncToProfessionalTables retains ALL order items!
      // CRITICAL: Takeaway orders must NEVER merge items from other orders or previous table orders!
      let itemsToSync = [...sentItems];
      const isTakeawaySend = isTakeawayOrder || String(cleanId).startsWith("TW") || req.body?.orderType === "TAKEAWAY";
      if (!isTakeawaySend) {
        try {
          const existingDbOrderItems = await transaction
            .request()
            .input("orderNoCheck", sql.NVarChar(50), finalOrderId)
            .query(`
              SELECT 
                d.OrderDetailId as lineItemId, d.DishId as id, ISNULL(d.SongName,'') as songName, d.Quantity as qty, 
                d.PricePerUnit as price, d.PricePerUnit as basePrice, ISNULL(NULLIF(d.DishName,''), dish.Name) as name,
                d.ModifiersJSON, d.ComboDetailsJSON, d.Remarks as note, d.isTakeAway as isTakeaway,
                ISNULL(dish.TakeawayCharge, 0) as takeawayCharge,
                ISNULL(dish.TakeawayCharge, 0) as TakeawayCharge,
                ISNULL(d.DiscountAmount, 0) as discount, ISNULL(d.DiscountType, NULL) as discountType,
                CASE d.StatusCode 
                  WHEN 1 THEN 'NEW' WHEN 2 THEN 'SENT' WHEN 3 THEN 'READY' 
                  WHEN 4 THEN 'SERVED' WHEN 5 THEN 'HOLD' WHEN 0 THEN 'VOIDED' 
                  ELSE 'SENT' 
                END as status
              FROM RestaurantOrderDetailCur d 
              JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
              LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
              WHERE h.OrderNumber = @orderNoCheck
                AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
                AND NOT EXISTS (SELECT 1 FROM SettlementHeader sh WHERE sh.BillNo = h.OrderNumber)
                AND d.StatusCode <> 0
            `);

          const existingRows = existingDbOrderItems.recordset || [];
          if (existingRows.length > 0) {
            const sentLineItemIds = new Set(sentItems.map((i) => i.lineItemId).filter(Boolean));
            existingRows.forEach((row) => {
              if (!sentLineItemIds.has(row.lineItemId)) {
                let mods = [];
                if (row.ModifiersJSON) {
                  try { mods = typeof row.ModifiersJSON === 'string' ? JSON.parse(row.ModifiersJSON) : row.ModifiersJSON; } catch { }
                }
                let combos = [];
                if (row.ComboDetailsJSON) {
                  try { combos = typeof row.ComboDetailsJSON === 'string' ? JSON.parse(row.ComboDetailsJSON) : row.ComboDetailsJSON; } catch { }
                }
                itemsToSync.push({
                  ...row,
                  modifiers: mods,
                  comboSelections: combos,
                  isCombo: !!combos && (Array.isArray(combos) ? combos.length > 0 : !!combos.groups)
                });
              }
            });
          }
        } catch (mergeErr) {
          console.warn("⚠️ Failed to merge existing DB order items in /send:", mergeErr.message);
        }
      }

      const rawOrderCustomerId = req.body.customerId || req.body.memberId || req.body.userId || null;

      // 3. FORCE SYNC with all merged order items
      await syncToProfessionalTables(
        transaction,
        cleanId,
        finalOrderId,
        itemsToSync,
        userId,
        null,
        req.body.entryStatus === "q",
        discountAmount,
        discountRemarks,
        mobileNo,
        customerName,
        rawOrderCustomerId
      );

      // 4. Lock Table to the new ID
      // 🔹 QR ORDER: If entry_status is 'q' and QR setting is ON, keep Status 2 (Payment Pending)
      let tableStatus = 1; // Default: Dining/Active (occupied)
      let paymentStatus = null;
      if (isQROrder) {
        paymentStatus = 0;
      }

      const hasSpecificTable = cleanId && cleanId !== "TAKEAWAY" && !String(cleanId).startsWith("TAKEAWAY");

      if (cleanId && (hasSpecificTable || !isTakeawayOrder)) {
        await transaction
          .request()
          .input("tid", sql.VarChar(50), cleanId)
          .input("oid", sql.NVarChar(50), finalOrderId)
          .input("status", sql.Int, tableStatus)
          .input("paymentStatus", sql.Int, paymentStatus)
          .input("entryStatus", sql.NVarChar(10), isQROrder ? "q" : null)
          .input("custName", sql.NVarChar, customerName || null).query(`
            UPDATE TableMaster 
            SET Status = CASE WHEN Status = 2 THEN 2 ELSE @status END, 
                entry_status = @entryStatus,
                PAYMENT_STATUS = @paymentStatus,
                CurrentOrderId = @oid,
                StartTime = CASE WHEN StartTime IS NULL OR StartTime < '2000-01-01' THEN GETDATE() ELSE StartTime END,
                CustomerName = CASE WHEN @custName IS NOT NULL AND @custName <> '' AND @custName <> 'Guest' THEN @custName ELSE CustomerName END,
                ModifiedOn = GETDATE()
            WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
          `);
      }

        await transaction.commit();
        break;
      } catch (txErr) {
        try { await transaction.rollback(); } catch (_) { }
        const isDeadlock = txErr && (txErr.number === 1205 || (txErr.message && txErr.message.toLowerCase().includes("deadlock")));
        if (isDeadlock && attempt < maxRetries) {
          console.warn(`⚠️ [Send Guard] Deadlock encountered for table "${cleanId}" (attempt ${attempt}/${maxRetries}). Retrying in ${60 * attempt}ms...`);
          await new Promise((r) => setTimeout(r, 60 * attempt + Math.floor(Math.random() * 40)));
          continue;
        }
        throw txErr;
      }
    }

      // 🔹 PRINTING: For Dine-In QR orders, queue print jobs immediately.
      // For QR Takeaway orders, ONLY print after payment is completed!
      const isPaidOrder = req.body.isPaid === true || req.body.paymentStatus === 1;
      const shouldPrintNow = isQROrder && (!isTakeawayOrder || isPaidOrder);

      if (shouldPrintNow) {
        try {
          const { queueQRPrintJobs } = require("../utils/printHelper");
          let tableNo = "TAKEAWAY";
          if (cleanId && cleanId !== "TAKEAWAY") {
            const tableQuery = await pool
              .request()
              .input("tid", sql.VarChar(50), cleanId)
              .query("SELECT TableNumber FROM TableMaster WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))");
            tableNo = tableQuery.recordset[0]?.TableNumber ? String(tableQuery.recordset[0].TableNumber).trim() : (isTakeawayOrder ? "TAKEAWAY" : "");
          }

          await queueQRPrintJobs(pool, sql, {
            orderId: finalOrderId,
            tableNo,
            sentItems,
            isAdditional: isAdditionalOrder,
            isPaid: isPaidOrder,
            payMode: req.body.payMode || "Cash",
            customerName: req.body.customerName || null,
            mobileNo: req.body.mobileNo || null,
            discountAmount: req.body.discountAmount || 0,
            takeawayCharge: req.body.takeawayCharge || 0,
            io: req.app.get("io"),
          });
          console.log(`[QR Print Queue] Queued print jobs for Order ${finalOrderId} Table ${tableNo}`);
        } catch (queueErr) {
          console.error("❌ Failed to queue QR print jobs:", queueErr.message);
        }
      } else if (isQROrder && isTakeawayOrder) {
        console.log(`[QR Print Queue] ⏸️ Skipping immediate print for unpaid QR Takeaway order ${finalOrderId}. Will print after payment is completed.`);
      }

      // Record successful send in cache
      recentSendCache.set(tableKey, {
        timestamp: Date.now(),
        orderId: finalOrderId,
        signature: signature,
      });

      if (resolveLock) resolveLock(finalOrderId);
      res.json({ success: true, orderId: finalOrderId });

      // 🔥 REAL-TIME BROADCAST: Notify KDS screen, POS APK, and all waiter devices.
      const io = req.app.get("io");
      if (io) {
        let tableNo = "";
        let section = isTakeawayOrder ? "TAKEAWAY" : "SECTION_1";

        if (cleanId && cleanId !== "TAKEAWAY") {
          const tableQuery = await pool
            .request()
            .input("tid", sql.VarChar(50), cleanId)
            .query(
              "SELECT TableNumber, DiningSection FROM TableMaster WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))",
            );
          const tableRow = tableQuery.recordset[0];
          tableNo = tableRow?.TableNumber
            ? String(tableRow.TableNumber).trim()
            : "";
          const sectionMap = {
            1: "SECTION_1",
            2: "SECTION_2",
            3: "SECTION_3",
            4: "TAKEAWAY",
          };
          section = tableRow
            ? sectionMap[String(tableRow.DiningSection)] || (isTakeawayOrder ? "TAKEAWAY" : "SECTION_1")
            : (isTakeawayOrder ? "TAKEAWAY" : "SECTION_1");
        }

        io.emit("new_order", {
          orderId: finalOrderId,
          isAdditional: isAdditionalOrder,
          context: {
            orderType: isTakeawayOrder ? "TAKEAWAY" : "DINE_IN",
            tableId: cleanId && cleanId !== "TAKEAWAY" ? cleanId : undefined,
            tableNo: tableNo || (isTakeawayOrder ? (req.body.takeawayNo || "TW") : null),
            takeawayNo: isTakeawayOrder ? (tableNo || req.body.takeawayNo || finalOrderId.slice(-4)) : null,
            section: section,
            entryStatus: isQROrder ? "q" : null,
            paymentStatus: isQROrder ? 0 : null,
          },
          items: sentItems,
          createdAt: Date.now(),
        });
        io.emit("cart_updated", {
          tableId: cleanId.toLowerCase(),
          orderId: finalOrderId,
          source: "order_sent", // 🔑 Allows QR frontend to distinguish order-placed vs item-added
        });
        io.emit("kot_printed", { tableId: cleanId, orderId: finalOrderId });

        if (shouldPrintNow) {
          io.emit("print_jobs_available", { orderId: finalOrderId, storeId: "STORE_001" });
        }
        io.emit("active_kitchen_updated", {
          tableId: cleanId.toLowerCase(),
          orderId: finalOrderId,
          reason: "order_sent",
        });
      }

      // 5. Refresh totals and notify instantly
      syncTableStatus(req, cleanId).catch(() => { });
    } catch (err) {
      if (rejectLock) rejectLock(err);
      console.error("❌ SendOrder Error:", err.message);
      res.status(500).json({ error: "SEND_ERROR: " + (err.message || String(err)) });
    } finally {
      if (tableKey) activeSendLocks.delete(tableKey);
    }
  });

router.get("/cart/:tableId", async (req, res) => {
  try {
    const { tableId } = req.params;
    if (
      !tableId ||
      tableId === "undefined" ||
      tableId === "null"
    ) {
      return res.json({ items: [], currentOrderId: null });
    }
    const pool = await poolPromise;
    const cleanId = await getCleanTableId(pool, tableId);
    if (!cleanId) {
      return res.json({ items: [], currentOrderId: null });
    }

    // Get table info (TableNumber + CurrentOrderId, PAYMENT_STATUS, Status, CustomerName, Pax)
    const tableInfo = await pool
      .request()
      .input("tid", sql.VarChar(50), cleanId)
      .query(
        "SELECT TableNumber, CurrentOrderId, PAYMENT_STATUS, Status, CustomerName, Pax FROM TableMaster WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))",
      );

    const tableRow = tableInfo.recordset[0];
    const tableNumber = tableRow?.TableNumber;
    let currentOrderId = tableRow?.CurrentOrderId;
    let rawPaymentStatus = tableRow?.PAYMENT_STATUS ?? 0;
    const tableStatus = tableRow?.Status ?? 0;

    // ⚡ FAST PATH: If the table is completely clean/vacant (Status = 0) and has no currentOrderId,
    // skip 4 heavy remote MSSQL roundtrips and return empty cart immediately (<20ms).
    if (tableStatus === 0 && (!currentOrderId || currentOrderId === "NEW" || currentOrderId === "PENDING")) {
      return res.json({
        items: [],
        currentOrderId: null,
        orderNumber: null,
        orderDiscount: null,
        paymentStatus: "UNPAID",
        isPaid: false
      });
    }

    // 🚀 RESOLVE ACTIVE DB ORDER ID: If TableMaster has no current order ID, check RestaurantOrderCur
    if (!currentOrderId || currentOrderId === "NEW" || currentOrderId === "PENDING" || currentOrderId.length < 5) {
      try {
        const activeDbOrder = await pool
          .request()
          .input("tableNo", sql.VarChar(20), String(tableNumber || ""))
          .input("tid", sql.VarChar(50), cleanId)
          .query(`
            SELECT TOP 1 OrderNumber 
            FROM RestaurantOrderCur 
            WHERE (RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@tableNo)) OR RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@tid)))
              AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
              AND OrderNumber IS NOT NULL AND OrderNumber NOT IN ('PENDING', 'NEW', '#NEW', '') AND OrderNumber NOT LIKE 'TEMP-%'
              AND EXISTS (SELECT 1 FROM RestaurantOrderDetailCur d WHERE d.OrderId = RestaurantOrderCur.OrderId AND d.StatusCode <> 0)
            ORDER BY CreatedOn DESC
          `);
        const dbOrderNo = activeDbOrder.recordset[0]?.OrderNumber;
        if (dbOrderNo) {
          currentOrderId = dbOrderNo;
          // Sync it back to TableMaster
          await pool.request()
            .input("tid", sql.VarChar(50), cleanId)
            .input("oid", sql.NVarChar(50), currentOrderId)
            .query("UPDATE TableMaster SET CurrentOrderId = @oid, StartTime = ISNULL(StartTime, GETDATE()) WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))");
        }
      } catch (err) {
        console.warn("⚠️ Failed to resolve active DB order in /cart:", err.message);
      }
    }

    // Determine payment status (PAID, PENDING_CASHIER, UNPAID)
    let isPaid = Number(rawPaymentStatus) === 1;
    let paymentStatus = isPaid ? "PAID" : (Number(rawPaymentStatus) === 2 ? "PENDING_CASHIER" : "UNPAID");

    if (currentOrderId && !isPaid) {
      try {
        const settleCheck = await pool
          .request()
          .input("ordNo", sql.NVarChar(50), String(currentOrderId))
          .query(`
            SELECT TOP 1 SettlementID 
            FROM SettlementHeader 
            WHERE OrderNumber = @ordNo 
               OR (TRY_CAST(@ordNo AS UNIQUEIDENTIFIER) IS NOT NULL AND OrderId = TRY_CAST(@ordNo AS UNIQUEIDENTIFIER))
          `);
        if (settleCheck.recordset && settleCheck.recordset.length > 0) {
          isPaid = true;
          paymentStatus = "PAID";
        }
      } catch (err) {
        console.warn("⚠️ Failed to check SettlementHeader for paymentStatus:", err.message);
      }
    }

    // 🔥 Fetch order-level discount and customer info from RestaurantOrderCur and TableMaster
    let orderDiscount = null;
    let orderCustomerId = null;
    let orderCustomerName = tableRow?.CustomerName || null;
    let orderMobileNo = null;
    try {
      const discRes = await pool
        .request()
        .input("tableNo", sql.VarChar(20), String(tableNumber || ""))
        .input("tid", sql.VarChar(50), cleanId)
        .query(`
          SELECT TOP 1 DiscountAmount, DiscountRemarks, CustomerId, CustomerName, MobileNo 
          FROM RestaurantOrderCur 
          WHERE (RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@tableNo)) OR RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@tid)))
            AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
          ORDER BY CreatedOn DESC
        `);
      const discRow = discRes.recordset[0];
      if (discRow) {
        if (Number(discRow.DiscountAmount) > 0) {
          orderDiscount = {
            amount: Number(discRow.DiscountAmount),
            remarks: discRow.DiscountRemarks || ""
          };
        }
        orderCustomerId = discRow.CustomerId || null;
        orderCustomerName = discRow.CustomerName || tableRow?.CustomerName || null;
        orderMobileNo = discRow.MobileNo || null;
      }
    } catch (_) { }

    // Fetch items: prioritize by CurrentOrderId, fall back to open order by TableNumber
    // 💡 LIVE SYNC: Allow TEMP- IDs so other devices can see the draft cart items!
    const isRealOrderId =
      currentOrderId &&
      currentOrderId !== "PENDING" &&
      currentOrderId !== "NEW";

    let whereClause = "";
    if (isRealOrderId) {
      whereClause = "WHERE h.OrderNumber = @orderNo AND d.StatusCode <> 0";
    } else {
      whereClause = `WHERE 
        (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
        AND d.StatusCode <> 0
        AND ISNULL(d.isSettlement, 0) = 0
        AND (
          RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@tableNo))
          OR RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@tid))
        )`;
    }

    const result = await pool
      .request()
      .input("tid", sql.VarChar(50), cleanId)
      .input("tableNo", sql.VarChar(20), String(tableNumber || ""))
      .input(
        "orderNo",
        sql.NVarChar(50),
        isRealOrderId ? currentOrderId : "__NONE__",
      ).query(`
        SELECT 
          d.OrderDetailId as lineItemId, d.DishId as id,ISNULL(d.SongName,'') as songName,d.Quantity as qty, 
          d.PricePerUnit as price, 
          ISNULL(NULLIF(d.DishName,''), dish.Name) as name,
          h.OrderNumber as OrderNumber,
          h.OrderNumber as orderNumber,
          d.ModifiersJSON, d.ComboDetailsJSON, d.Remarks as note, d.isTakeAway as isTakeaway,
          ISNULL(d.DiscountAmount, 0) as discount,
          ISNULL(d.DiscountType, NULL) as discountType,
          CAST(ISNULL(dish.IsDiscountAllowed, 1) AS INT) as IsDiscountAllowed,
          ISNULL(dish.TakeawayCharge, 0) as takeawayCharge,
          ISNULL(dish.TakeawayCharge, 0) as TakeawayCharge,
          d.CreatedOn as DateCreated,
          CASE d.StatusCode 
            WHEN 1 THEN 'NEW' WHEN 2 THEN 'SENT' WHEN 3 THEN 'READY' 
            WHEN 4 THEN 'SERVED' WHEN 5 THEN 'HOLD' WHEN 0 THEN 'VOIDED' 
            ELSE 'SENT' 
          END as status,
          ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode, 
          ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
          pm.PrinterPath as PrinterIP,
          ISNULL(dish.isServiceCharge, 1) as isServiceCharge,
          dish.Imageid as Image
        FROM RestaurantOrderDetailCur d 
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
        LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
        LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
        LEFT JOIN (
          SELECT *, ROW_NUMBER() OVER(PARTITION BY KitchenTypeValue ORDER BY PrinterId) as rn 
          FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
        ) pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.rn = 1
        ${whereClause}
        ORDER BY d.CreatedOn ASC
      `);

    const items = result.recordset.map((i) => ({
      ...i,
      modifiers: i.ModifiersJSON
        ? (() => {
          try {
            return JSON.parse(i.ModifiersJSON);
          } catch {
            return [];
          }
        })()
        : [],
      comboSelections: i.ComboDetailsJSON
        ? (() => {
          try {
            return JSON.parse(i.ComboDetailsJSON);
          } catch {
            return [];
          }
        })()
        : [],
    }));

    res.json({
      items,
      currentOrderId: isRealOrderId ? currentOrderId : null,
      orderNumber: isRealOrderId ? currentOrderId : null,
      orderDiscount,
      customerId: orderCustomerId,
      customerName: orderCustomerName,
      mobileNo: orderMobileNo,
      paymentStatus,
      isPaid: Boolean(isPaid)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/order-status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === "undefined" || id === "null") {
      return res.status(400).json({ error: "Missing id" });
    }
    const pool = await poolPromise;
    const cleanId = String(id).replace(/^\{|\}$/g, "").trim();

    // 1. Check if id is an OrderNumber in RestaurantOrderCur
    let orderRes = await pool.request()
      .input("id", sql.NVarChar(100), cleanId)
      .query(`
        SELECT TOP 1 
          h.OrderId, h.OrderNumber, RTRIM(LTRIM(h.Tableno)) as Tableno, h.isOrderClosed, h.CreatedOn,
          tm.PAYMENT_STATUS as TablePaymentStatus,
          (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 3) as ReadyCount,
          (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 2) as SentCount,
          (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 4) as ServedCount,
          (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode <> 0) as TotalCount
        FROM RestaurantOrderCur h
        LEFT JOIN TableMaster tm ON RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
        WHERE h.OrderNumber = @id 
           OR (TRY_CAST(@id AS UNIQUEIDENTIFIER) IS NOT NULL AND h.OrderId = TRY_CAST(@id AS UNIQUEIDENTIFIER))
        ORDER BY h.CreatedOn DESC
      `);

    let order = orderRes.recordset[0];

    let cachedPaymentStatus = order?.TablePaymentStatus !== undefined && order?.TablePaymentStatus !== null
      ? order.TablePaymentStatus
      : null;

    // 2. If not found by OrderNumber, check by TableMaster (tableId or TableNumber)
    if (!order) {
      const tableCheck = await pool.request()
        .input("tid", sql.VarChar(50), cleanId)
        .query(`
          SELECT TableNumber, CurrentOrderId, PAYMENT_STATUS 
          FROM TableMaster 
          WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
        `);
      const tableRow = tableCheck.recordset[0];
      const tableNo = tableRow?.TableNumber;
      const curOid = tableRow?.CurrentOrderId;
      if (tableRow?.PAYMENT_STATUS !== undefined && tableRow?.PAYMENT_STATUS !== null) {
        cachedPaymentStatus = tableRow.PAYMENT_STATUS;
      }

      if (curOid && curOid.length > 5 && curOid !== "NEW" && curOid !== "PENDING") {
        const orderByCurOid = await pool.request()
          .input("oid", sql.NVarChar(100), curOid)
          .query(`
            SELECT TOP 1 
              h.OrderId, h.OrderNumber, RTRIM(LTRIM(h.Tableno)) as Tableno, h.isOrderClosed, h.CreatedOn,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 3) as ReadyCount,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 2) as SentCount,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 4) as ServedCount,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode <> 0) as TotalCount
            FROM RestaurantOrderCur h
            WHERE h.OrderNumber = @oid
            ORDER BY h.CreatedOn DESC
          `);
        order = orderByCurOid.recordset[0];
      }

      if (!order && tableNo) {
        const orderRecent = await pool.request()
          .input("tno", sql.VarChar(50), tableNo)
          .query(`
            SELECT TOP 1 
              h.OrderId, h.OrderNumber, RTRIM(LTRIM(h.Tableno)) as Tableno, h.isOrderClosed, h.CreatedOn,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 3) as ReadyCount,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 2) as SentCount,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode = 4) as ServedCount,
              (SELECT COUNT(*) FROM RestaurantOrderDetailCur d WHERE d.OrderId = h.OrderId AND d.StatusCode <> 0) as TotalCount
            FROM RestaurantOrderCur h
            WHERE RTRIM(LTRIM(h.Tableno)) = @tno AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
            ORDER BY h.CreatedOn DESC
          `);
        order = orderRecent.recordset[0];
      }
    }

    const orderNumber = order?.OrderNumber || null;
    const tableNo = order?.Tableno || cleanId;

    // Check payment status from TableMaster (skip query if already obtained above)
    let rawPaymentStatus = cachedPaymentStatus;
    if (rawPaymentStatus === null || rawPaymentStatus === undefined) {
      const tableInfo = await pool.request()
        .input("tid", sql.VarChar(50), tableNo)
        .query(`
          SELECT PAYMENT_STATUS 
          FROM TableMaster 
          WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
        `);
      rawPaymentStatus = tableInfo.recordset[0]?.PAYMENT_STATUS ?? 0;
    }
    let isPaid = Number(rawPaymentStatus) === 1;
    let paymentStatus = isPaid ? "PAID" : (Number(rawPaymentStatus) === 2 ? "PENDING_CASHIER" : "UNPAID");

    // Check SettlementHeader
    if (orderNumber && !isPaid) {
      const settleCheck = await pool.request()
        .input("ordNo", sql.NVarChar(100), orderNumber)
        .query(`
          SELECT TOP 1 SettlementID 
          FROM SettlementHeader 
          WHERE BillNo = @ordNo OR (TRY_CAST(@ordNo AS UNIQUEIDENTIFIER) IS NOT NULL AND OrderId = TRY_CAST(@ordNo AS UNIQUEIDENTIFIER))
        `);
      if (settleCheck.recordset && settleCheck.recordset.length > 0) {
        isPaid = true;
        paymentStatus = "PAID";
      }
    }

    let status = "Order Received";
    if (order) {
      if (order.TotalCount > 0 && order.ServedCount === order.TotalCount) {
        status = "Picked Up / Completed";
      } else if (order.ReadyCount > 0) {
        status = "Ready for Pickup";
      } else if (order.SentCount > 0) {
        status = "Preparing Order";
      }
    }

    return res.json({
      success: true,
      orderNumber,
      tableNo,
      isPaid: Boolean(isPaid),
      paymentStatus, // 'PAID' | 'PENDING_CASHIER' | 'UNPAID'
      status
    });
  } catch (err) {
    console.error("❌ /order-status/:id Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/cancel", async (req, res) => {
  try {
    const { orderId, tableId, reason, userId, userName } = req.body;
    const pool = await poolPromise;
    const cleanTid = String(tableId)
      .replace(/^\{|\}$/g, "")
      .trim();

    // 1. Fetch Order Data for Reporting
    const orderData = await pool
      .request()
      .input("oid", sql.NVarChar(100), orderId).query(`
        SELECT h.OrderId, h.OrderNumber, RTRIM(LTRIM(h.Tableno)) AS Tableno, h.BusinessUnitId, h.CreatedBy, h.MobileNo,
               tm.DiningSection, tm.TableId, h.start_date
        FROM RestaurantOrderCur h
        LEFT JOIN TableMaster tm ON RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
        WHERE h.OrderNumber = @oid AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
      `);

    const header = orderData.recordset[0];
    if (!header) {
      return res
        .status(404)
        .json({ error: "Order not found or already closed" });
    }

    // Fetch active business date from DateEntry
    const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    const activeStartDate = activeDayRes.recordset[0]?.StartDate;
    const finalStartDate = activeStartDate || header.start_date || new Date();

    const itemsData = await pool
      .request()
      .input("orderId", sql.UniqueIdentifier, header.OrderId).query(`
        SELECT d.*, dish.DishGroupId, dg.CategoryId, cm.CategoryName, dg.DishGroupName
        FROM RestaurantOrderDetailCur d
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        LEFT JOIN DishGroupMaster dg ON dish.DishGroupId = dg.DishGroupId
        LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
        WHERE d.OrderId = @orderId
      `);

    const items = itemsData.recordset;
    const subTotal = items.reduce(
      (sum, item) => sum + (item.ActualAmount || 0),
      0,
    );
    const voidQty = items.reduce((sum, item) => sum + (item.Quantity || 0), 0);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const settlementId = crypto.randomUUID();

      // 2. Insert into SettlementHeader (Cancelled Status)
      await transaction
        .request()
        .input("sid", sql.UniqueIdentifier, settlementId)
        .input("oid", sql.NVarChar(50), orderId)
        .input("tableNo", sql.NVarChar(50), header.Tableno)
        .input("section", sql.NVarChar(100), header.DiningSection)
        .input("userId", sql.UniqueIdentifier, toGuidOrNull(userId))
        .input("userName", sql.NVarChar(255), userName || "User")
        .input("reason", sql.NVarChar(500), reason || "Manual Cancellation")
        .input(
          "bizId",
          sql.UniqueIdentifier,
          header.BusinessUnitId || DEFAULT_GUID,
        )
        .input("subTotal", sql.Money, subTotal)
        .input("voidQty", sql.Int, voidQty)
        .input("voidAmt", sql.Money, subTotal)
        .input("mobile", sql.NVarChar(50), header.MobileNo)
        .input("startDate", sql.Date, finalStartDate).query(`
          INSERT INTO SettlementHeader (
            SettlementID, LastSettlementDate, BillNo, OrderType, TableNo, Section, 
            CashierID, BusinessUnitId, SysAmount, ManualAmount, CreatedBy, CreatedOn, 
            IsCancelled, CancellationReason, CancelledDate, CancelledByUserName, 
            SubTotal, TotalTax, DiscountAmount, MobileNo, VoidItemQty, VoidItemAmount, start_date
          ) VALUES (
            @sid, GETDATE(), @oid, 'DINE-IN', @tableNo, @section, 
            @userId, @bizId, 0, 0, @userId, GETDATE(), 
            1, @reason, GETDATE(), @userName, 
            @subTotal, 0, 0, @mobile, @voidQty, @voidAmt, @startDate
          )
        `);

      // 3. Insert Items into SettlementItemDetail (Marked as VOIDED)
      for (const item of items) {
        await transaction
          .request()
          .input("sid", sql.UniqueIdentifier, settlementId)
          .input("dishId", sql.UniqueIdentifier, item.DishId)
          .input("dishName", sql.NVarChar(255), item.DishName)
          .input("songName", sql.NVarChar(255), item.SongName || "")
          .input("qty", sql.Int, item.Quantity)
          .input("price", sql.Decimal(18, 2), item.PricePerUnit)
          .input("catId", sql.UniqueIdentifier, item.CategoryId)
          .input("catName", sql.NVarChar(255), item.CategoryName)
          .input("groupName", sql.NVarChar(255), item.DishGroupName)
          .input("startDate", sql.Date, finalStartDate).query(`
            INSERT INTO SettlementItemDetail (
              SettlementID, DishId, DishName,SongName, Qty, Price, Status, OrderDateTime,
              CategoryId, CategoryName, SubCategoryName, start_date
            ) VALUES (
              @sid, @dishId, @dishName,  @songName,@qty, @price, 'VOIDED', GETDATE(),
              @catId, @catName, @groupName, @startDate
            )
          `);
      }

      // 4. Insert into supporting Settlement tables for reporting (Audit Trail)
      await transaction
        .request()
        .input("sid", sql.UniqueIdentifier, settlementId)
        .input("oid", sql.NVarChar(50), orderId)
        .input(
          "bizId",
          sql.UniqueIdentifier,
          header.BusinessUnitId || DEFAULT_GUID,
        )
        .input("userId", sql.UniqueIdentifier, toGuidOrNull(userId))
        .input("subTotal", sql.Money, subTotal)
        .input("voidQty", sql.Int, voidQty)
        .input("startDate", sql.Date, finalStartDate).query(`
          -- Insert into SettlementTotalSales (Zeroed)
          INSERT INTO SettlementTotalSales (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff, ReceiptCount)
          VALUES (@sid, 'VOID', 0, 0, 0, @voidQty);

          -- Insert into SettlementDetail (Zeroed)
          INSERT INTO SettlementDetail (SettlementId, Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount, IsCollected)
          VALUES (@sid, 'VOID', 0, 0, 0, @voidQty, 0);

          -- Insert into SettlementTranDetail (Zeroed)
          INSERT INTO SettlementTranDetail (SettlementID, PayMode, CashIn, CashOut)
          VALUES (@sid, 'VOID', 0, 0);

          -- Insert into RestaurantInvoice (Cancelled Status 4)
          INSERT INTO RestaurantInvoice (
            BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled, 
            TotalLineItemAmount, TotalTax, DiscountAmount, TotalAmount, StatusCode, 
            CreatedBy, CreatedOn, InvoiceDate, ServiceCharge, RoundedBy, TotalAmountLessFreight,
            PaymentTermCode, start_date
          ) VALUES (
            @bizId, @sid, @sid, @oid, GETDATE(), GETDATE(),
            @subTotal, 0, 0, 0, 4,
            @userId, GETDATE(), CAST(GETDATE() AS DATE), 0, 0, @subTotal,
            0, @startDate
          );
        `);

      // 5. Update Current Tables (StatusCode 4 = Cancelled)
      await transaction.request().input("oid", sql.NVarChar(50), orderId)
        .query(`
          UPDATE RestaurantOrderCur SET StatusCode = 4, isOrderClosed = 1, ModifiedOn = GETDATE() WHERE OrderNumber = @oid;
          UPDATE RestaurantOrderDetailCur SET StatusCode = 0, ModifiedOn = GETDATE() WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @oid);
        `);
      //-------------Might Change later entry staus sevred quit order-----------------

      await transaction
        .request()
        .input("tid", sql.VarChar(50), cleanTid)
        .query(
          "UPDATE TableMaster SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL, ModifiedOn = GETDATE() WHERE TableId = @tid",
        );

      await transaction.commit();

      await syncTableStatus(req, cleanTid);
      req.app
        .get("io")
        ?.emit("order_closed", { tableId: cleanTid, orderId: orderId });

      res.json({ success: true });
    } catch (e) {
      await transaction.rollback();
      console.error("❌ Cancel Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/complete", async (req, res) => {
  try {
    const { tableId, userId } = req.body;
    const pool = await poolPromise;
    const cleanId = await getCleanTableId(pool, tableId);
    if (!toGuidOrNull(cleanId)) {
      console.log(`[Complete] Skipping table release for non-table order: ${tableId}`);
      return res.json({ success: true });
    }

    // Final atomic update: Close the professional order and release the table
    await pool.request().input("tid", sql.UniqueIdentifier, cleanId).query(`
        UPDATE RestaurantOrderCur SET isOrderClosed = 1, ModifiedOn = GETDATE() 
        WHERE Tableno = (SELECT TOP 1 TableNumber FROM TableMaster WHERE TableId = @tid) 
        AND (isOrderClosed = 0 OR isOrderClosed IS NULL);
        
        UPDATE TableMaster SET Status = 0, entry_status = NULL, CurrentOrderId = NULL, StartTime = NULL, TotalAmount = 0, CustomerName = NULL, Pax = NULL, ModifiedOn = GETDATE() WHERE TableId = @tid;
      `);

    const updated = await syncTableStatus(req, cleanId);

    // 🔥 UNIFIED SIGNAL: Use order_status_update for consistency
    const io = req.app.get("io");
    if (io) {
      const lid = cleanId.toLowerCase();
      io.emit("order_closed", { tableId: lid });
      io.emit("order_status_update", {
        tableId: lid,
        action: "CLOSE",
        orderId: updated?.CurrentOrderId,
      });
    }
    res.json({ success: true, ...updated });
  } catch (err) {
    console.error("❌ Complete Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/hold", async (req, res) => {
  try {
    const { tableId } = req.body;
    const cleanId = toGuidOrNull(tableId);
    if (!cleanId) {
      console.log(`[Hold] Skipping table updates for non-table order: ${tableId}`);
      return res.json({ success: true });
    }
    const pool = await poolPromise;

    // Set status to 3 (Hold)
    await pool.request().input("tid", sql.UniqueIdentifier, cleanId).query(`
        UPDATE TableMaster 
        SET Status = 3, 
            ModifiedOn = GETDATE() 
        WHERE TableId = @tid
      `);

    const updated = await syncTableStatus(req, cleanId);
    res.json({ success: true, ...updated });
  } catch (err) {
    console.error("❌ Hold Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/checkout", async (req, res) => {
  const MAX_DEADLOCK_RETRIES = 3;
  const DEADLOCK_RETRY_DELAY_MS = 150;

  const attemptCheckout = async () => {
    const { tableId } = req.body;
    const pool = await poolPromise;
    const cleanId = String(tableId || "").replace(/^\{|\}$/g, "").trim();
    if (!cleanId || cleanId === "undefined" || cleanId === "null") {
      return res.json({ success: true, tableNo: "TAKEAWAY", section: "TAKEAWAY" });
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      // Step 1: Move table to Payment Pending (Status 2)
      await transaction.request().input("tid", sql.VarChar(50), cleanId).query(`
          -- Reduce deadlock victim priority: prefer to lose vs more critical write transactions
          SET DEADLOCK_PRIORITY LOW;

          DECLARE @TableNo VARCHAR(50);
          DECLARE @TableId UNIQUEIDENTIFIER;
          IF TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL
          BEGIN
             SELECT TOP 1 @TableNo = TableNumber, @TableId = TableId FROM TableMaster WHERE TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER);
          END
          ELSE
          BEGIN
             SELECT TOP 1 @TableNo = TableNumber, @TableId = TableId FROM TableMaster WHERE TableNumber = @tid;
          END

          IF @TableNo IS NULL SET @TableNo = @tid;

          -- 1. Update Table Status to Checkout (2)
          IF @TableId IS NOT NULL
          BEGIN
             UPDATE TableMaster SET Status = 2, ModifiedOn = GETDATE() WHERE TableId = @TableId;
          END
          ELSE
          BEGIN
             UPDATE TableMaster SET Status = 2, ModifiedOn = GETDATE() WHERE TableNumber = @tid;
          END

          -- 2. Expire VOIDED items (StatusCode 0) from KDS instantly
          UPDATE d
          SET d.ModifiedOn = DATEADD(MINUTE, -10, GETDATE())
          FROM RestaurantOrderDetailCur d
          JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
          WHERE (h.Tableno = @TableNo OR h.Tableno = @tid)
          AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
          AND d.StatusCode = 0;
        `);

      await transaction.commit();
    } catch (txErr) {
      try { await transaction.rollback(); } catch (_) { }
      throw txErr;
    }

    const updated = await syncTableStatus(req, cleanId);

    // 🔥 KDS & GLOBAL SYNC: Harmonized signals
    const io = req.app.get("io");
    if (io) {
      const lid = cleanId.toLowerCase();
      io.emit("table_status_updated", {
        tableId: lid,
        tableNo: updated?.tableNo,
        section: updated?.section,
        status: 2,
        totalAmount: updated?.TotalAmount,
        startTime: updated?.StartTime
      });
      io.emit("order_closed", {
        tableId: lid,
        tableNo: updated?.tableNo,
        section: updated?.section,
      });
      io.emit("order_status_update", {
        tableId: lid,
        action: "CLOSE",
        orderId: updated?.CurrentOrderId,
      });
    }

    return updated;
  };

  for (let attempt = 1; attempt <= MAX_DEADLOCK_RETRIES; attempt++) {
    try {
      const updated = await attemptCheckout();
      if (!res.headersSent) {
        res.json({ success: true, ...updated });
      }
      return;
    } catch (err) {
      const isDeadlock = err.number === 1205 || (err.message && err.message.includes("deadlock"));
      if (isDeadlock && attempt < MAX_DEADLOCK_RETRIES) {
        const delay = DEADLOCK_RETRY_DELAY_MS * attempt;
        console.warn(`⚠️ [Checkout] Deadlock detected (attempt ${attempt}/${MAX_DEADLOCK_RETRIES}). Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.error(`❌ Checkout Error (attempt ${attempt}):`, err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
      return;
    }
  }
});

router.post("/remove-item", async (req, res) => {
  try {
    const { tableId, itemId, qtyToVoid, reason, version } = req.body;
    const userId = req.body.userId || DEFAULT_GUID;
    const pool = await poolPromise;
    const now = Date.now();
    console.log(
      `[TRACE] [${now}] [REMOVE-ITEM] Table: ${tableId} | ItemID: ${itemId} | Version: ${version || "NONE"}`,
    );

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      // 🚀 SMART REMOVAL: Delete if NEW, Void if SENT
      await transaction
        .request()
        .input("itemId", sql.VarChar(50), itemId)
        .input("userId", sql.VarChar(50), userId)
        .input("reason", sql.NVarChar(255), reason || "").query(`
          DECLARE @CurrentStatus INT;
          SELECT @CurrentStatus = StatusCode FROM RestaurantOrderDetailCur WHERE OrderDetailId = @itemId;

          IF @CurrentStatus = 1
          BEGIN
            -- Hard delete unsent items
            DELETE FROM RestaurantmodifierdetailCur WHERE OrderDetailId = @itemId;
            DELETE FROM RestaurantOrderDetailCur WHERE OrderDetailId = @itemId;
          END
          ELSE
          BEGIN
            -- Void sent items
            UPDATE RestaurantOrderDetailCur 
            SET StatusCode = 0, ModifiedBy = @userId, ModifiedOn = GETDATE(), 
                Remarks = ISNULL(Remarks, '') + ' (VOID: ' + @reason + ')'
            WHERE OrderDetailId = @itemId;
          END
        `);
      await transaction.commit();

      // 🚀 Refresh total immediately
      syncTableStatus(req, tableId).catch(() => { });

      req.app.get("io")?.emit("cart_updated", {
        tableId: String(tableId || "").toLowerCase(),
      });
      res.json({ success: true });
    } catch (e) {
      await transaction.rollback();
      throw e;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/update-item-status", async (req, res) => {
  try {
    const { lineItemId, status, tableId } = req.body;
    const pool = await poolPromise;
    const statusMap = {
      NEW: 1,
      SENT: 2,
      READY: 3,
      SERVED: 4,
      HOLD: 5,
      VOIDED: 0,
    };

    // Fetch orderNumber and TableId so we can emit them correctly
    const orderRes = await pool
      .request()
      .input("id", sql.UniqueIdentifier, lineItemId).query(`
        SELECT h.OrderNumber, tm.TableId 
        FROM RestaurantOrderDetailCur d 
        JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
        LEFT JOIN TableMaster tm ON RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
        WHERE d.OrderDetailId = @id
      `);

    const orderId = orderRes.recordset[0]?.OrderNumber;
    const resolvedTableId = orderRes.recordset[0]?.TableId || tableId;

    await pool
      .request()
      .input("id", sql.UniqueIdentifier, lineItemId)
      .input("code", sql.Int, statusMap[status] || 2)
      .query(
        "UPDATE RestaurantOrderDetailCur SET StatusCode = @code, ModifiedOn = GETDATE() WHERE OrderDetailId = @id",
      );

    // 🌟 Auto-clear QR Table if all items are Served/Voided
    try {
      const qrCheck = await pool
        .request()
        .input("id", sql.UniqueIdentifier, lineItemId).query(`
          SELECT tm.TableId, tm.TableNumber, tm.DiningSection, tm.entry_status, tm.PAYMENT_STATUS, h.OrderId, h.OrderNumber
          FROM RestaurantOrderDetailCur d
          JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
          JOIN TableMaster tm ON (
            RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
            OR (TRY_CAST(h.Tableno AS UNIQUEIDENTIFIER) IS NOT NULL AND tm.TableId = TRY_CAST(h.Tableno AS UNIQUEIDENTIFIER))
            OR (TRY_CAST(h.Tableno AS INT) IS NOT NULL AND TRY_CAST(tm.TableNumber AS INT) = TRY_CAST(h.Tableno AS INT))
          )
          WHERE d.OrderDetailId = @id
        `);

      if (qrCheck.recordset.length > 0) {
        const row = qrCheck.recordset[0];
        const isQR = row.entry_status === "q";
        const isPaid = row.PAYMENT_STATUS === 1;
        // Only auto-clear the table if it is a QR order (entry_status='q') AND already paid.
        // Regular dine-in orders are NOT auto-cleared — the cashier still needs to settle them.
        if (isQR && isPaid) {
          // Check if there are any items that are NOT served (4) and NOT voided (0)
          const pendingItems = await pool
            .request()
            .input("orderId", sql.UniqueIdentifier, row.OrderId).query(`
              SELECT COUNT(*) as count 
              FROM RestaurantOrderDetailCur 
              WHERE OrderId = @orderId AND StatusCode NOT IN (0, 4)
            `);

          if (pendingItems.recordset[0].count === 0) {
            console.log(
              `[QR Auto-Clear] Table ${row.TableNumber} has all items served/voided. Auto-clearing on all devices...`,
            );

            // Delete CartItems
            const cleanTableId = String(row.TableId)
              .replace(/^\{|\}$/g, "")
              .trim();
            await pool
              .request()
              .input("cartId", sql.NVarChar(128), cleanTableId)
              .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @cartId");

            // Update TableMaster
            await pool
              .request()
              .input("tableId", sql.UniqueIdentifier, row.TableId).query(`
                UPDATE TableMaster 
                SET Status = 0, entry_status = NULL, PAYMENT_STATUS = NULL, CurrentOrderId = NULL, StartTime = NULL, TotalAmount = 0
                WHERE TableId = @tableId
              `);

            // Close the current order
            await pool
              .request()
              .input("orderId", sql.UniqueIdentifier, row.OrderId).query(`
                UPDATE RestaurantOrderCur 
                SET isOrderClosed = 1 
                WHERE OrderId = @orderId
              `);

            // Sync status and emit definitive table_status_updated
            const updated = await syncTableStatus(req, row.TableId).catch(() => null);

            const sectionMap = {
              1: "SECTION_1",
              2: "SECTION_2",
              3: "SECTION_3",
              4: "TAKEAWAY",
            };
            const section = sectionMap[String(row.DiningSection)] || row.DiningSection || "SECTION_1";
            const orderNo = row.OrderNumber || row.OrderId;

            // Broadcast ALL real-time socket signals so EVERY device updates instantly
            const io = req.app.get("io");
            if (io) {
              io.emit("order_closed", {
                tableId: cleanTableId.toLowerCase(),
                tableNo: row.TableNumber,
                section: section,
                orderId: orderNo,
              });

              io.emit("order_status_update", {
                tableId: cleanTableId.toLowerCase(),
                action: "CLOSE",
                orderId: orderNo,
              });

              io.emit("active_kitchen_updated", {
                tableId: cleanTableId.toLowerCase(),
                reason: "qr_all_served_auto_clear",
              });

              io.emit("tables_updated");
              io.emit("cart_updated", { tableId: cleanTableId.toLowerCase() });
            }
          }
        }
      }
    } catch (qrErr) {
      console.error(
        "⚠️ [QR Auto-Clear] Error auto-clearing table:",
        qrErr.message,
      );
    }

    req.app.get("io")?.emit("item_status_updated", {
      lineItemId,
      status,
      tableId: String(resolvedTableId || "").toLowerCase(),
      orderId,
    });

    if (resolvedTableId) {
      const cleanTableId = String(resolvedTableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      syncTableStatus(req, resolvedTableId).catch(() => { });
      req.app.get("io")?.emit("cart_updated", {
        tableId: cleanTableId,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/active-kitchen", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, d.StatusCode, 
        d.PricePerUnit as price,
        h.OrderNumber as orderId, dish.Name as name, 
        ISNULL(NULLIF(RTRIM(LTRIM(tm.TableNumber)), ''), RTRIM(LTRIM(h.Tableno))) as tableNo, 
        d.Remarks as note, d.ModifiersJSON, d.ComboDetailsJSON, d.isTakeAway, 
        DATEDIFF(SECOND, ISNULL(d.CreatedOn, h.CreatedOn), GETDATE()) as elapsedSeconds,
        ISNULL(ckt.KitchenTypeCode, '0') as KitchenTypeCode, 
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
        pm.PrinterPath as PrinterIP,
        tm.TableId, tm.DiningSection, tm.entry_status, tm.PAYMENT_STATUS, tm.Status,
        h.CustomerId, ISNULL(NULLIF(tm.CustomerName, 'Guest'), h.CustomerName) as CustomerName, h.MobileNo
      FROM RestaurantOrderDetailCur d 
      JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
      LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
      LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY KitchenTypeValue ORDER BY PrinterId) as rn
        FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
      ) pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.rn = 1
      LEFT JOIN TableMaster tm ON (
        RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
        OR (TRY_CAST(h.Tableno AS UNIQUEIDENTIFIER) IS NOT NULL AND tm.TableId = TRY_CAST(h.Tableno AS UNIQUEIDENTIFIER))
        OR (TRY_CAST(h.Tableno AS INT) IS NOT NULL AND TRY_CAST(tm.TableNumber AS INT) = TRY_CAST(h.Tableno AS INT))
      )
      WHERE (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
      -- 🚀 Include active items: NEW (1), SENT (2), READY (3), SERVED (4), HOLD (5)
      -- VOIDED items (StatusCode=0) are excluded — they should never appear on KDS or printer
      AND d.StatusCode IN (1,2,3,4,5)
      AND h.OrderNumber IS NOT NULL
      AND h.OrderNumber NOT LIKE 'TEMP-%'
      AND h.OrderNumber NOT IN ('PENDING', 'NEW', '#NEW', '')
      ORDER BY d.CreatedOn ASC
    `);
    const orders = {};
    result.recordset.forEach((row) => {
      if (!orders[row.orderId]) {
        const isTakeaway =
          !row.tableNo ||
          row.tableNo === "TAKEAWAY" ||
          String(row.tableNo).trim().startsWith("TW");
        const rawSec = String(row.DiningSection || "").trim();
        const sectionMap = {
          "1": "SECTION_1",
          "2": "SECTION_2",
          "3": "SECTION_3",
          "4": "TAKEAWAY",
        };
        let normalizedSection = sectionMap[rawSec] || rawSec;
        if (normalizedSection.toUpperCase().startsWith("SECTION")) {
          normalizedSection = normalizedSection.toUpperCase().replace(/SECTION[-_ ]*/i, "SECTION_");
        }

        orders[row.orderId] = {
          orderId: row.orderId,
          customerId: row.CustomerId || null,
          customerName: row.CustomerName || null,
          mobileNo: row.MobileNo || null,
          context: {
            orderType: isTakeaway ? "TAKEAWAY" : "DINE_IN",
            tableId: row.TableId
              ? String(row.TableId)
                .replace(/^\{|\}$/g, "")
                .trim()
                .toLowerCase()
              : undefined,
            tableNo: isTakeaway ? null : String(row.tableNo).trim(),
            section: normalizedSection,
            takeawayNo: isTakeaway
              ? row.tableNo === "TAKEAWAY"
                ? row.orderId.slice(-4)
                : String(row.tableNo).trim()
              : null,
          },
          items: [],
          createdAt: Date.now() - Math.max(0, Math.min(86400, Number(row.elapsedSeconds) || 0)) * 1000,
        };
      }
      const statusMap = {
        0: "VOIDED",
        1: "NEW",
        2: "SENT",
        3: "READY",
        4: "SERVED",
        5: "HOLD",
      };
      orders[row.orderId].items.push({
        ...row,
        status: statusMap[row.StatusCode],
        modifiers: row.ModifiersJSON ? JSON.parse(row.ModifiersJSON) : [],
        comboSelections: row.ComboDetailsJSON ? JSON.parse(row.ComboDetailsJSON) : [],
      });
    });
    res.json({ serverTime: Date.now(), orders: Object.values(orders) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/active-sessions", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, d.StatusCode, 
        d.PricePerUnit as price,
        h.OrderNumber as orderId, dish.Name as name, 
        ISNULL(NULLIF(RTRIM(LTRIM(tm.TableNumber)), ''), RTRIM(LTRIM(h.Tableno))) as tableNo, 
        d.Remarks as note, d.ModifiersJSON, d.ComboDetailsJSON, d.isTakeAway, 
        DATEDIFF(SECOND, ISNULL(d.CreatedOn, h.CreatedOn), GETDATE()) as elapsedSeconds,
        ISNULL(ckt.KitchenTypeCode, '0') as KitchenTypeCode, 
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
        pm.PrinterPath as PrinterIP,
        tm.TableId, tm.DiningSection, tm.entry_status, tm.PAYMENT_STATUS, tm.Status,
        h.CustomerId, ISNULL(NULLIF(tm.CustomerName, 'Guest'), h.CustomerName) as CustomerName, h.MobileNo
      FROM RestaurantOrderDetailCur d 
      JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
      LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
      LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY KitchenTypeValue ORDER BY PrinterId) as rn
        FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
      ) pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.rn = 1
      LEFT JOIN TableMaster tm ON (
        RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
        OR (TRY_CAST(h.Tableno AS UNIQUEIDENTIFIER) IS NOT NULL AND tm.TableId = TRY_CAST(h.Tableno AS UNIQUEIDENTIFIER))
        OR (TRY_CAST(h.Tableno AS INT) IS NOT NULL AND TRY_CAST(tm.TableNumber AS INT) = TRY_CAST(h.Tableno AS INT))
      )
      WHERE (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
      -- 🚀 Include all non-voided items: NEW (1), SENT (2), READY (3), SERVED (4), HOLD (5)
      AND d.StatusCode <> 0
      AND h.OrderNumber IS NOT NULL
      AND h.OrderNumber NOT LIKE 'TEMP-%'
      AND h.OrderNumber NOT IN ('PENDING', 'NEW', '#NEW', '')
      ORDER BY d.CreatedOn ASC
    `);
    const orders = {};
    result.recordset.forEach((row) => {
      if (!orders[row.orderId]) {
        const isTakeaway =
          !row.tableNo ||
          row.tableNo === "TAKEAWAY" ||
          String(row.tableNo).trim().startsWith("TW");
        const sectionMap = {
          1: "SECTION_1",
          2: "SECTION_2",
          3: "SECTION_3",
          4: "TAKEAWAY",
        };
        const normalizedSection =
          sectionMap[String(row.DiningSection)] || row.DiningSection || "";

        orders[row.orderId] = {
          orderId: row.orderId,
          customerId: row.CustomerId || null,
          customerName: row.CustomerName || null,
          mobileNo: row.MobileNo || null,
          context: {
            orderType: isTakeaway ? "TAKEAWAY" : "DINE_IN",
            tableId: row.TableId
              ? String(row.TableId)
                .replace(/^\{|\}$/g, "")
                .trim()
                .toLowerCase()
              : undefined,
            tableNo: isTakeaway ? null : String(row.tableNo).trim(),
            section: normalizedSection,
            takeawayNo: isTakeaway
              ? row.tableNo === "TAKEAWAY"
                ? row.orderId.slice(-4)
                : String(row.tableNo).trim()
              : null,
          },
          items: [],
          createdAt: Date.now() - Math.max(0, Math.min(86400, Number(row.elapsedSeconds) || 0)) * 1000,
        };
      }
      const statusMap = {
        0: "VOIDED",
        1: "NEW",
        2: "SENT",
        3: "READY",
        4: "SERVED",
        5: "HOLD",
      };
      orders[row.orderId].items.push({
        ...row,
        status: statusMap[row.StatusCode],
        modifiers: row.ModifiersJSON ? JSON.parse(row.ModifiersJSON) : [],
        comboSelections: row.ComboDetailsJSON ? JSON.parse(row.ComboDetailsJSON) : [],
      });
    });
    res.json({ serverTime: Date.now(), orders: Object.values(orders) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/log-print", async (req, res) => {
  try {
    const { orderId, orderNumber, printType } = req.body;
    const pool = await poolPromise;

    let safeOrderId = toGuidOrNull(orderId);
    if (!safeOrderId && orderNumber) {
      const orderQuery = await pool.request()
        .input("orderNumber", sql.VarChar(50), String(orderNumber).trim())
        .query("SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNumber ORDER BY CreatedOn DESC");
      if (orderQuery.recordset.length > 0) {
        safeOrderId = orderQuery.recordset[0].OrderId;
      }
    }
    if (!safeOrderId) {
      safeOrderId = DEFAULT_GUID;
    }

    const safeOrderNo = orderNumber
      ? String(orderNumber).substring(0, 50)
      : "N/A";
    const safePrintType = parseInt(printType, 10) || 1;

    await pool
      .request()
      .input("oid", sql.UniqueIdentifier, safeOrderId)
      .input("ono", sql.VarChar(50), safeOrderNo)
      .input("pt", sql.Int, safePrintType)
      .query(
        "INSERT INTO PrintReport (OrderId, Ordernumber, PrintType, orderDate) VALUES (@oid, @ono, @pt, GETDATE())",
      );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ log-print error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/merge", async (req, res) => {
  try {
    const { targetTableId, sourceTableIds, sourceOrders, userId } = req.body;
    // sourceOrders: [{ tableId, orderNumber, tableNo, section }] – sent by frontend for reliable lookup
    const pool = await poolPromise;
    const cleanTargetId = String(targetTableId)
      .replace(/^\{|\}$/g, "")
      .trim();

    const activeOrg = await getActiveOrganization();
    const businessUnitId = activeOrg.businessUnitId;

    // 1. Setup audit history table
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[OrderMergeHistory]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[OrderMergeHistory] (
          [MergeId] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
          [ParentOrderId] UNIQUEIDENTIFIER NOT NULL,
          [ChildOrderId] UNIQUEIDENTIFIER NOT NULL,
          [ParentTableNo] NVARCHAR(50) NULL,
          [ChildTableNo] NVARCHAR(50) NULL,
          [MergedAt] DATETIME NOT NULL DEFAULT GETDATE(),
          [MergedBy] UNIQUEIDENTIFIER NULL,
          CONSTRAINT [PK_OrderMergeHistory] PRIMARY KEY CLUSTERED ([MergeId] ASC)
        )
      END
    `);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      console.log(
        `[MERGE START] Initiating merge for targetTableId: ${cleanTargetId}`,
      );

      // 0. Ensure target table exists and has a CurrentOrderId
      console.log(`[MERGE STEP 1] Checking target table status...`);
      const targetCheck = await transaction
        .request()
        .input("tid", sql.UniqueIdentifier, cleanTargetId)
        .query(
          "SELECT TableNumber, CurrentOrderId FROM TableMaster WHERE TableId = @tid",
        );

      if (targetCheck.recordset.length === 0) {
        throw new Error("Target table not found");
      }

      const targetTableNo = targetCheck.recordset[0].TableNumber;
      const targetOrderId = targetCheck.recordset[0].CurrentOrderId;
      console.log(
        `[MERGE STEP 1 SUCCESS] Target Table: ${targetTableNo}, Active OrderNo: ${targetOrderId}`,
      );

      if (!targetOrderId || targetOrderId === "NEW") {
        throw new Error(
          "Target table has no active order. Add at least one item first.",
        );
      }

      // Fetch the target Order Guid
      console.log(
        `[MERGE STEP 2] Fetching target Order GUID for OrderNo: ${targetOrderId}`,
      );
      const targetGuidRes = await transaction
        .request()
        .input("orderNo", sql.NVarChar(50), targetOrderId)
        .query(
          "SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo AND isOrderClosed = 0",
        );
      const targetOrderGuid = targetGuidRes.recordset[0]?.OrderId;
      if (!targetOrderGuid) {
        throw new Error(
          "Target active order record not found or is already closed.",
        );
      }
      console.log(
        `[MERGE STEP 2 SUCCESS] Target Order GUID: ${targetOrderGuid}`,
      );

      const io = req.app.get("io");

      // Build a lookup map: tableId (lowercase, no braces) -> orderNumber from frontend
      const sourceOrderMap = {};
      if (Array.isArray(sourceOrders)) {
        sourceOrders.forEach(so => {
          if (so && so.tableId && so.orderNumber) {
            const cleanId = String(so.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
            sourceOrderMap[cleanId] = String(so.orderNumber).trim();
          }
        });
      }

      for (const sourceTableId of sourceTableIds) {
        const cleanSourceId = String(sourceTableId)
          .replace(/^\{|\}$/g, "")
          .trim()
          .toLowerCase();
        if (cleanSourceId === cleanTargetId.toLowerCase()) {
          console.log(
            `[MERGE LOOP] Skipping identical target/source table: ${cleanSourceId}`,
          );
          continue;
        }

        console.log(`[MERGE LOOP] Processing sourceTableId: ${cleanSourceId}`);
        const sourceCheck = await transaction
          .request()
          .input("tid", sql.UniqueIdentifier, cleanSourceId)
          .query(
            "SELECT TableNumber, CurrentOrderId FROM TableMaster WHERE TableId = @tid",
          );

        if (sourceCheck.recordset.length === 0) {
          console.log(
            `[MERGE LOOP ERROR] Source table not found: ${cleanSourceId}`,
          );
          continue;
        }
        const sourceTableNo = sourceCheck.recordset[0].TableNumber;
        const sourceOrderIdFromTable = sourceCheck.recordset[0].CurrentOrderId;

        // 🚀 PRIMARY: Use orderNumber passed from frontend (more reliable – comes directly from active KDS)
        // FALLBACK: Use TableMaster.CurrentOrderId if frontend didn't send it
        const frontendOrderNumber = sourceOrderMap[cleanSourceId];
        const sourceOrderId = frontendOrderNumber || sourceOrderIdFromTable;

        console.log(
          `[MERGE LOOP] Source Table: ${sourceTableNo}, TableMaster OrderNo: ${sourceOrderIdFromTable}, Frontend OrderNo: ${frontendOrderNumber}, Using: ${sourceOrderId}`,
        );
        if (!sourceOrderId || sourceOrderId === "NEW") {
          console.log(`[MERGE LOOP SKIP] Source table has no active order.`);
          continue;
        }

        // Fetch source order guid – try with isOrderClosed = 0 first, then without filter as fallback
        console.log(
          `[MERGE LOOP] Fetching source Order GUID for OrderNo: ${sourceOrderId}`,
        );
        let sourceGuidRes = await transaction
          .request()
          .input("orderNo", sql.NVarChar(50), sourceOrderId)
          .query(
            "SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo AND (isOrderClosed = 0 OR isOrderClosed IS NULL)",
          );
        
        // 🚀 FALLBACK: if not found with open filter, try without (stale closed order edge case)
        if (!sourceGuidRes.recordset[0]?.OrderId) {
          console.log(`[MERGE LOOP] Open order not found, trying without isOrderClosed filter...`);
          sourceGuidRes = await transaction
            .request()
            .input("orderNo2", sql.NVarChar(50), sourceOrderId)
            .query(
              "SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo2 ORDER BY CreatedOn DESC",
            );
        }
        
        const sourceOrderGuid = sourceGuidRes.recordset[0]?.OrderId;
        if (!sourceOrderGuid) {
          console.log(`[MERGE LOOP ERROR] Active source order GUID not found for OrderNo: ${sourceOrderId}.`);
          continue;
        }
        console.log(
          `[MERGE LOOP SUCCESS] Source Order GUID: ${sourceOrderGuid}`,
        );

        // A. Insert merge relationship
        console.log(`[MERGE LOOP] Inserting merge relationship history...`);
        await transaction
          .request()
          .input("parentOid", sql.UniqueIdentifier, targetOrderGuid)
          .input("childOid", sql.UniqueIdentifier, sourceOrderGuid)
          .input("parentTableNo", sql.NVarChar(50), targetTableNo)
          .input("childTableNo", sql.NVarChar(50), sourceTableNo)
          .input(
            "mergedBy",
            sql.UniqueIdentifier,
            toGuidOrNull(userId) || DEFAULT_GUID,
          ).query(`
            INSERT INTO OrderMergeHistory (ParentOrderId, ChildOrderId, ParentTableNo, ChildTableNo, MergedAt, MergedBy)
            VALUES (@parentOid, @childOid, @parentTableNo, @childTableNo, GETDATE(), @mergedBy)
          `);

        // B. Re-point items to target order
        console.log(
          `[MERGE LOOP] Re-pointing modifiers and items from source to target Order GUID: ${targetOrderGuid}...`,
        );
        await transaction
          .request()
          .input("parentOid", sql.UniqueIdentifier, targetOrderGuid)
          .input("parentOrderNo", sql.NVarChar(100), targetOrderId)
          .input("parentTableNo", sql.NVarChar(10), targetTableNo)
          .input("childOid", sql.UniqueIdentifier, sourceOrderGuid).query(`
            -- Re-point modifiers
            UPDATE RestaurantmodifierdetailCur
            SET OrderId = @parentOid
            WHERE OrderId = @childOid;

            -- Re-point items
            UPDATE RestaurantOrderDetailCur
            SET OrderId = @parentOid,
                OrderNumber = @parentOrderNo,
                ModifiedOn = GETDATE()
            WHERE OrderId = @childOid;
          `);

        // C. Close source order (and all remaining open headers for this child table)
        console.log(
          `[MERGE LOOP] Closing source order GUID: ${sourceOrderGuid}...`,
        );
        await transaction
          .request()
          .input("childOid", sql.UniqueIdentifier, sourceOrderGuid)
          .input("childTableNo", sql.NVarChar(50), String(sourceTableNo))
          .input("cleanSourceId", sql.NVarChar(50), String(cleanSourceId))
          .query(`
            UPDATE RestaurantOrderCur
            SET isOrderClosed = 1,
                StatusCode = 3,
                ModifiedOn = GETDATE()
            WHERE OrderId = @childOid 
               OR ((RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@childTableNo)) OR RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@cleanSourceId))) AND (isOrderClosed = 0 OR isOrderClosed IS NULL))
          `);

        // D. Clear source table & persistent CartItems
        console.log(
          `[MERGE LOOP] Clearing source table cart items and master status...`,
        );
        await transaction
          .request()
          .input("cartId", sql.NVarChar(128), cleanSourceId)
          .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @cartId");

        const validSourceGuid = toGuidOrNull(cleanSourceId);
        if (validSourceGuid) {
          await transaction
            .request()
            .input("tid", sql.UniqueIdentifier, validSourceGuid)
            .input("tno", sql.NVarChar(50), String(sourceTableNo))
            .query(
              "UPDATE TableMaster SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL WHERE TableId = @tid OR TableNumber = @tno",
            );
        } else {
          await transaction
            .request()
            .input("tno", sql.NVarChar(50), String(sourceTableNo))
            .query(
              "UPDATE TableMaster SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL WHERE TableNumber = @tno OR TableId = @tno",
            );
        }

        // E. Emit source socket events immediately
        console.log(`[MERGE LOOP] Broadcasting source table update events...`);
        if (io) {
          const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
          const sourceSection = sectionMap[String(sourceCheck.recordset[0]?.DiningSection)] || "SECTION_1";
          io.emit("table_status_updated", {
            tableId: cleanSourceId.toLowerCase(),
            tableNo: sourceTableNo,
            section: sourceSection,
            status: 0,
            totalAmount: 0,
            startTime: null,
            customerName: null,
            pax: null,
          });
          io.emit("cart_updated", { tableId: cleanSourceId.toLowerCase(), tableNo: sourceTableNo });
          io.emit("order_closed", {
            tableId: cleanSourceId.toLowerCase(),
            tableNo: sourceTableNo,
            orderId: sourceOrderId,
          });
        }
      }

      // 2. Calculate Combined Total for Target Order
      console.log(
        `[MERGE STEP 3] Calculating combined total for target Order GUID: ${targetOrderGuid}`,
      );
      const combinedTotalRes = await transaction
        .request()
        .input("parentOid", sql.UniqueIdentifier, targetOrderGuid)
        .query(
          "SELECT SUM(TotalDetailLineAmount) as Total FROM RestaurantOrderDetailCur WHERE OrderId = @parentOid AND StatusCode <> 0",
        );
      const targetCombinedTotal = combinedTotalRes.recordset[0].Total || 0;
      console.log(
        `[MERGE STEP 3 SUCCESS] Combined Total: ${targetCombinedTotal}`,
      );

      // 3. Update Target Table Master Total
      console.log(
        `[MERGE STEP 4] Updating target TableMaster total to: ${targetCombinedTotal}`,
      );
      await transaction
        .request()
        .input("tid", sql.UniqueIdentifier, cleanTargetId)
        .input("total", sql.Decimal(18, 2), targetCombinedTotal)
        .query(
          "UPDATE TableMaster SET TotalAmount = @total WHERE TableId = @tid",
        );

      console.log(`[MERGE STEP 5] Committing SQL transaction...`);
      await transaction.commit();
      console.log(
        `[MERGE STEP 5 SUCCESS] SQL transaction committed successfully.`,
      );

      // 4. Emit target socket events
      if (io) {
        io.emit("table_status_updated", {
          tableId: cleanTargetId.toLowerCase(),
          status: 1,
          totalAmount: targetCombinedTotal,
        });
        io.emit("cart_updated", {
          tableId: cleanTargetId.toLowerCase(),
          orderId: targetOrderId,
        });
      }

      res.json({ success: true, totalAmount: targetCombinedTotal });
    } catch (err) {
      console.error(
        `[MERGE TRANSACTION ERROR] rolling back... Error: ${err.message}`,
      );
      if (transaction._isStarted) await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error("❌ Merge Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/mark-sent", async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }
    const pool = await poolPromise;
    await pool.request().input("orderNo", sql.NVarChar(50), orderId).query(`
      UPDATE RestaurantOrderDetailCur 
      SET StatusCode = 2 
      WHERE OrderNumber = @orderNo AND StatusCode = 1
    `);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ mark-sent Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function resolveTableOrderNo(pool, cleanId) {
  try {
    const res = await pool.request().input("tid", sql.VarChar(50), cleanId).query(`
      SELECT TOP 1 OrderNumber FROM RestaurantOrderCur 
      WHERE (RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@tid)) OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND OrderId = TRY_CAST(@tid AS UNIQUEIDENTIFIER)))
      ORDER BY CreatedOn DESC
    `);
    return res.recordset[0]?.OrderNumber || null;
  } catch (e) {
    return null;
  }
}

async function settlePaidQROrder(pool, orderNumber, payModeName = 'Yeahpay Paynow', verifiedPaidAmount = null) {
  if (!orderNumber || orderNumber === 'NEW' || orderNumber === '#NEW' || String(orderNumber).startsWith('TEMP-')) {
    console.warn(`[settlePaidQROrder] Invalid orderNumber: ${orderNumber}`);
    return null;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    // 1. Fetch order
    const ordRes = await transaction.request()
      .input('orderNo', sql.NVarChar(50), String(orderNumber).trim())
      .query(`
        SELECT TOP 1 * FROM RestaurantOrderCur 
        WHERE OrderNumber = @orderNo OR (TRY_CAST(@orderNo AS UNIQUEIDENTIFIER) IS NOT NULL AND OrderId = TRY_CAST(@orderNo AS UNIQUEIDENTIFIER))
        ORDER BY CreatedOn DESC
      `);

    if (ordRes.recordset.length === 0) {
      console.warn(`[settlePaidQROrder] Order ${orderNumber} not found in RestaurantOrderCur`);
      await transaction.rollback();
      return null;
    }
    const order = ordRes.recordset[0];
    const actualOrderNo = order.OrderNumber;

    // Check if already in SettlementHeader (idempotency check)
    const existingSh = await transaction.request()
      .input('orderNo', sql.NVarChar(50), actualOrderNo)
      .query(`
        SELECT TOP 1 SettlementID, BillNo 
        FROM SettlementHeader 
        WHERE BillNo = @orderNo
      `);
    if (existingSh.recordset.length > 0) {
      console.log(`[settlePaidQROrder] Order ${actualOrderNo} is already settled in SettlementHeader with ID:`, existingSh.recordset[0].SettlementID);
      await transaction.rollback();
      return existingSh.recordset[0];
    }

    // 2. Fetch active business date from DateEntry
    const dateRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    const activeStartDate = dateRes.recordset[0]?.StartDate;
    const formattedStartDate = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : (order.start_date || new Date().toISOString().split("T")[0]);

    // 3. Fetch line items
    const itemsRes = await transaction.request()
      .input('orderId', sql.UniqueIdentifier, order.OrderId)
      .query(`
        SELECT d.*, dgm.CategoryId, cat.CategoryName, dish.DishGroupId, dgm.DishGroupName
        FROM RestaurantOrderDetailCur d
        LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
        LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
        LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
        WHERE d.OrderId = @orderId AND ISNULL(d.StatusCode, 1) != 0
      `);
    const items = itemsRes.recordset;

    // 4. Resolve Paymode
    const cleanPayMode = (payModeName || 'Yeahpay Paynow').trim();
    const pmRes = await transaction.request()
      .input('pmName', sql.NVarChar(100), cleanPayMode)
      .query("SELECT TOP 1 Position, PayMode, Description FROM [dbo].[Paymode] WHERE Active = 1 AND (PayMode LIKE '%' + @pmName + '%' OR Description LIKE '%' + @pmName + '%')");
    const paymode = pmRes.recordset[0] || { Position: 7, PayMode: 'Yeahpay Paynow', Description: 'Yeahpay Paynow' };

    const settlementId = crypto.randomUUID();
    let totalAmount = Number(order.TotalAmount || 0);
    const verifiedAmount = verifiedPaidAmount != null && !isNaN(Number(verifiedPaidAmount)) ? Number(verifiedPaidAmount) : null;
    if (verifiedAmount !== null && verifiedAmount > 0 && Math.abs(totalAmount - verifiedAmount) > 0.01) {
      console.warn(`⚠️ [settlePaidQROrder] Discrepancy detected for order ${actualOrderNo}: DB TotalAmount=${totalAmount}, VerifiedPaidAmount=${verifiedAmount}. Using verified paid amount for settlement.`);
      totalAmount = verifiedAmount;
    }
    const takeawayCharge = Number(order.TakeawayCharge || 0);
    const serviceCharge = Number(order.ServiceCharge || 0);
    const totalTax = Number(order.TotalTax || 0);
    const discountAmount = Number(order.DiscountAmount || 0);
    const roundedBy = Number(order.RoundedBy || 0);
    const subTotal = Number(order.TotalAmountLessFreight || order.TotalLineItemAmount || (totalAmount - takeawayCharge - serviceCharge - totalTax)) || totalAmount;
    const receiptCount = items.reduce((sum, it) => sum + (Number(it.Quantity) || 1), 0);
    const cashierId = order.CreatedBy || '8C026364-77E7-4002-803B-9BBE187C60BD';
    const cleanTableNo = String(order.Tableno || 'TAKEAWAY').trim();

    // 5. Insert SettlementHeader
    await transaction.request()
      .input('sid', sql.UniqueIdentifier, settlementId)
      .input('subTotal', sql.Money, subTotal > 0 ? subTotal : totalAmount)
      .input('totalTax', sql.Money, totalTax)
      .input('discountAmount', sql.Decimal(18, 2), discountAmount)
      .input('billNo', sql.NVarChar(50), actualOrderNo)
      .input('orderType', sql.NVarChar(50), order.IsTakeAway || cleanTableNo.startsWith('TW') ? 'TAKEAWAY' : 'DINE-IN')
      .input('tableNo', sql.NVarChar(50), cleanTableNo)
      .input('section', sql.NVarChar(50), 'TAKEAWAY')
      .input('cashierId', sql.UniqueIdentifier, cashierId)
      .input('bizId', sql.UniqueIdentifier, order.BusinessUnitId || DEFAULT_GUID)
      .input('sysAmount', sql.Money, totalAmount)
      .input('guestName', sql.NVarChar(100), order.CustomerName || null)
      .input('takeawayCharge', sql.Decimal(18, 2), takeawayCharge)
      .input('serviceCharge', sql.Money, serviceCharge)
      .input('roundedBy', sql.Money, roundedBy)
      .input('startDate', sql.Date, formattedStartDate)
      .query(`
        INSERT INTO SettlementHeader (
          SettlementID, LastSettlementDate, LastDayEndDate, SubTotal, TotalTax, DiscountAmount, DiscountType, 
          BillNo, OrderType, TableNo, Section, CashierID, BusinessUnitId, 
          SysAmount, ManualAmount, CreatedBy, CreatedOn, 
          VoidItemQty, VoidItemAmount, RoundedBy, ServiceCharge, GuestName, Pax, TotalPax, TakeawayCharge, start_date, IsCancelled
        ) VALUES (
          @sid, GETDATE(), GETDATE(), @subTotal, @totalTax, @discountAmount, 'fixed', 
          @billNo, @orderType, @tableNo, @section, @cashierId, @bizId, 
          @sysAmount, @sysAmount, @cashierId, GETDATE(), 
          0, 0, @roundedBy, @serviceCharge, @guestName, 1, 1, @takeawayCharge, @startDate, 0
        )
      `);

    // 6. Insert RestaurantInvoice & RestaurantInvoiceCur
    await transaction.request()
      .input('bizId', sql.UniqueIdentifier, order.BusinessUnitId || DEFAULT_GUID)
      .input('sid', sql.UniqueIdentifier, settlementId)
      .input('orderId', sql.UniqueIdentifier, order.OrderId)
      .input('billNo', sql.NVarChar(50), actualOrderNo)
      .input('subTotal', sql.Decimal(18, 2), subTotal > 0 ? subTotal : totalAmount)
      .input('totalTax', sql.Decimal(18, 2), totalTax)
      .input('discountAmount', sql.Decimal(18, 2), discountAmount)
      .input('totalAmount', sql.Decimal(18, 2), totalAmount)
      .input('userId', sql.UniqueIdentifier, cashierId)
      .input('serviceCharge', sql.Decimal(18, 2), serviceCharge)
      .input('roundedBy', sql.Decimal(18, 2), roundedBy)
      .input('payModeCode', sql.Int, paymode.Position)
      .input('startDate', sql.Date, formattedStartDate)
      .query(`
        INSERT INTO RestaurantInvoice (
          BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled, 
          TotalLineItemAmount, TotalTax, DiscountAmount, TotalAmount, StatusCode, 
          CreatedBy, CreatedOn, InvoiceDate, ServiceCharge, RoundedBy, TotalAmountLessFreight,
          PaymentTermCode, Pax, start_date
        ) VALUES (
          @bizId, @sid, @orderId, @billNo, GETDATE(), GETDATE(),
          @subTotal, @totalTax, @discountAmount, @totalAmount, 5,
          @userId, GETDATE(), CAST(GETDATE() AS DATE), @serviceCharge, @roundedBy, @subTotal,
          @payModeCode, 1, @startDate
        );

        INSERT INTO RestaurantInvoiceCur (
          BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled, 
          TotalLineItemAmount, TotalTax, DiscountAmount, TotalAmount, StatusCode, 
          CreatedBy, CreatedOn, InvoiceDate, ServiceCharge, RoundedBy, TotalAmountLessFreight,
          PaymentTermCode, Pax, start_date
        ) VALUES (
          @bizId, @sid, @orderId, @billNo, GETDATE(), GETDATE(),
          @subTotal, @totalTax, @discountAmount, @totalAmount, 5,
          @userId, GETDATE(), CAST(GETDATE() AS DATE), @serviceCharge, @roundedBy, @subTotal,
          @payModeCode, 1, @startDate
        );
      `);

    // 7. Insert SettlementTotalSales, SettlementDetail, SettlementTranDetail
    await transaction.request()
      .input('sid', sql.UniqueIdentifier, settlementId)
      .input('pmName', sql.VarChar(50), (paymode.Description || paymode.PayMode || 'Yeahpay Paynow').trim())
      .input('amount', sql.Decimal(18, 2), totalAmount)
      .input('receiptCount', sql.Int, receiptCount)
      .query(`
        INSERT INTO SettlementTotalSales (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff, ReceiptCount)
        VALUES (@sid, @pmName, @amount, @amount, 0, @receiptCount);

        INSERT INTO [dbo].[SettlementDetail] (SettlementId, Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount, IsCollected)
        VALUES (@sid, @pmName, @amount, @amount, 0, @receiptCount, 0);

        INSERT INTO SettlementTranDetail (SettlementID, PayMode, CashIn, CashOut)
        VALUES (@sid, @pmName, @amount, 0);
      `);

    // 8. Insert PaymentDetailCur
    const paymentId = crypto.randomUUID();
    await transaction.request()
      .input('pid', sql.UniqueIdentifier, paymentId)
      .input('sid', sql.UniqueIdentifier, settlementId)
      .input('pmCode', sql.Int, paymode.Position)
      .input('amount', sql.Decimal(18, 2), totalAmount)
      .input('pmName', sql.VarChar(50), (paymode.Description || paymode.PayMode || 'Yeahpay Paynow').trim())
      .input('bizId', sql.UniqueIdentifier, order.BusinessUnitId || DEFAULT_GUID)
      .input('userId', sql.UniqueIdentifier, cashierId)
      .input('startDate', sql.Date, formattedStartDate)
      .query(`
        INSERT INTO PaymentDetailCur (
          PaymentId, BilledFor, RestaurantBillId, PaymentCollectedOn, PaymentType, Paymode, 
          Amount, Remarks, BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, 
          isSettlement, isUploadHQ, start_date
        ) VALUES (
          @pid, 1, @sid, GETDATE(), 1, @pmCode, 
          @amount, @pmName, @bizId, @userId, GETDATE(), @userId, GETDATE(), 
          1, 0, @startDate
        )
      `);

    // 9. Insert SettlementItemDetail
    for (const item of items) {
      await transaction.request()
        .input('sid', sql.UniqueIdentifier, settlementId)
        .input('dishId', sql.UniqueIdentifier, item.DishId)
        .input('dishName', sql.NVarChar(255), item.DishName || item.Description || 'Item')
        .input('songName', sql.NVarChar(255), item.SongName || '')
        .input('qty', sql.Int, item.Quantity)
        .input('price', sql.Decimal(18, 2), item.PricePerUnit)
        .input('catId', sql.UniqueIdentifier, item.CategoryId || null)
        .input('catName', sql.NVarChar(255), item.CategoryName || 'MAIN')
        .input('groupName', sql.NVarChar(255), item.DishGroupName || 'GENERAL')
        .input('startDate', sql.Date, formattedStartDate)
        .query(`
          INSERT INTO SettlementItemDetail (
            SettlementID, DishId, DishName, SongName, Qty, Price, Status, OrderDateTime,
            CategoryId, CategoryName, SubCategoryName, start_date
          ) VALUES (
            @sid, @dishId, @dishName, @songName, @qty, @price, 'NORMAL', GETDATE(),
            @catId, @catName, @groupName, @startDate
          )
        `);
    }

    // 10. Update RestaurantOrderCur status
    await transaction.request()
      .input('orderId', sql.UniqueIdentifier, order.OrderId)
      .query(`
        UPDATE RestaurantOrderCur 
        SET ModifiedOn = GETDATE()
        WHERE OrderId = @orderId
      `);

    await transaction.commit();
    console.log(`✅ [settlePaidQROrder] Order ${actualOrderNo} successfully settled with SettlementID: ${settlementId}`);
    return { success: true, settlementId, billNo: actualOrderNo };
  } catch (err) {
    await transaction.rollback();
    console.error(`❌ [settlePaidQROrder] Failed to settle order ${orderNumber}:`, err.message);
    return null;
  }
}

router.post("/payment-status", async (req, res) => {
  try {
    const { tableId, paymentStatus, orderId: clientOrderId, payMode } = req.body;
    if (!tableId) {
      return res.status(400).json({ error: "Missing tableId" });
    }
    const cleanId = String(tableId)
      .replace(/^\{|\}$/g, "")
      .trim();
    const pool = await poolPromise;

    // 🛡️ Validate: If paymentStatus is 2 (Pay at Cashier) for Takeaway, ensure EnableQRTWPayAtCashier is enabled in AppSettings
    if (Number(paymentStatus) === 2) {
      const isTakeaway = cleanId === "TAKEAWAY" || cleanId.startsWith("TAKEAWAY") || cleanId.startsWith("TW");
      if (isTakeaway) {
        const { getAppSettings } = require("../utils/settingsCache");
        const appSettings = await getAppSettings();
        const enableQRTWPayAtCashier = appSettings?.EnableQRTWPayAtCashier !== undefined ? Boolean(appSettings.EnableQRTWPayAtCashier) : true;
        if (!enableQRTWPayAtCashier) {
          return res.status(403).json({ error: "Pay at Cashier is disabled for QR Takeaway orders. Please pay online." });
        }
      }
    }

    await pool
      .request()
      .input("tid", sql.VarChar(50), cleanId)
      .input("status", sql.Int, paymentStatus).query(`
      UPDATE TableMaster 
      SET PAYMENT_STATUS = @status 
      WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
    `);

    const updated = await syncTableStatus(req, cleanId);

    const io = req.app.get("io");
    if (io) {
      const targetTableId = updated?.TableId ? String(updated.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase() : cleanId.toLowerCase();
      io.emit("qr_payment_confirmed", {
        tableId: targetTableId,
        rawTableId: updated?.TableId,
        tableNo: updated?.tableNo,
        orderId: updated?.CurrentOrderId,
        paymentStatus: Number(paymentStatus),
        entryStatus: updated?.entryStatus || 'q',
      });
      io.emit("active_kitchen_updated", {
        tableId: targetTableId,
        reason: "payment_status_changed",
      });
    }

    // 🔹 When payment is completed (paymentStatus === 1):
    // 1. Auto-settle the order in SettlementHeader so it immediately appears in Sales Report
    if (Number(paymentStatus) === 1) {
      try {
        const orderNo = clientOrderId || updated?.CurrentOrderId || (await resolveTableOrderNo(pool, cleanId));
        if (orderNo) {
          const verifiedPaidAmt = req.body?.paidAmount ? Number(req.body.paidAmount) : null;
          const settledResult = await settlePaidQROrder(pool, orderNo, payMode || "Yeahpay Paynow", verifiedPaidAmt);
          if (settledResult && io) {
            io.emit("settlement_updated", { action: "settlement_saved", orderId: orderNo, settlementId: settledResult.settlementId });
            io.emit("sales_updated", { orderId: orderNo });
          }
        }
      } catch (settleErr) {
        console.error("❌ Failed to auto-settle paid QR order in /payment-status:", settleErr.message);
      }
    }

    // 2. Trigger print jobs for QR orders
    if (Number(paymentStatus) === 1 && updated?.CurrentOrderId) {
      try {
        const { queueQRPrintJobs } = require("../utils/printHelper");
        const orderNo = updated.CurrentOrderId;
        const actualTableNo = updated.tableNo || "TAKEAWAY";

        // Query active order items to print
        const itemsRes = await pool
          .request()
          .input("ordNo", sql.NVarChar(50), orderNo)
          .query(`
            SELECT 
              d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, 
              d.PricePerUnit as price, ISNULL(NULLIF(d.DishName, ''), dish.Name) as name,
              d.Remarks as note, d.isTakeAway as isTakeaway,
              d.ModifiersJSON, d.ComboDetailsJSON,
              ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode,
              ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
              pm.PrinterPath as PrinterIP
            FROM RestaurantOrderDetailCur d
            INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
            LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
            LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
            LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
            LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
            LEFT JOIN (
              SELECT *, ROW_NUMBER() OVER(PARTITION BY KitchenTypeValue ORDER BY PrinterId) as rn 
              FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
            ) pm ON CAST(ckt.KitchenTypeCode AS VARCHAR(50)) = CAST(pm.KitchenTypeValue AS VARCHAR(50)) AND pm.rn = 1
            WHERE (h.OrderNumber = @ordNo OR d.OrderNumber = @ordNo)
              AND d.StatusCode IN (1, 2)
          `);

        const printItems = (itemsRes.recordset || []).map(row => {
          let mods = [];
          if (row.ModifiersJSON) {
            try { mods = JSON.parse(row.ModifiersJSON); } catch (e) {}
          }
          let combos = [];
          if (row.ComboDetailsJSON) {
            try { combos = JSON.parse(row.ComboDetailsJSON); } catch (e) {}
          }
          return {
            ...row,
            modifiers: mods,
            comboSelections: combos,
            isCombo: !!combos && (Array.isArray(combos) ? combos.length > 0 : !!combos.groups)
          };
        });

        if (printItems.length > 0) {
          const ioInst = req.app.get("io");
          await queueQRPrintJobs(pool, sql, {
            orderId: orderNo,
            tableNo: actualTableNo,
            sentItems: printItems,
            isAdditional: false,
            isPaid: true,
            payMode: payMode || "Yeahpay Paynow",
            io: ioInst,
          });
          console.log(`[QR Print Queue] Queued KOT/KDS/Receipt jobs after payment confirmation for Order ${orderNo} Table ${actualTableNo}`);
          if (ioInst) {
            ioInst.emit("print_jobs_available", { orderId: orderNo, storeId: "STORE_001" });
          }
        }
      } catch (printErr) {
        console.error("❌ Failed to queue print jobs in /payment-status:", printErr.message);
      }
    }

    res.json({ success: true, ...updated });
  } catch (err) {
    console.error("❌ payment-status Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/complete-online-payment", async (req, res) => {
  try {
    const { orderId, tableNo, tableId, paymentMethod } = req.body;
    const pool = await poolPromise;
    const cleanId = String(tableId || tableNo || "").replace(/^\{|\}$/g, "").trim();
    const orderNo = orderId || (cleanId ? await resolveTableOrderNo(pool, cleanId) : null);
    
    let updatedTable = null;
    if (cleanId) {
      await pool.request().input("tid", sql.VarChar(50), cleanId).query(`
        UPDATE TableMaster SET PAYMENT_STATUS = 1 WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
      `);
      updatedTable = await syncTableStatus(req, cleanId);
    }
    
    if (orderNo) {
      const verifiedPaidAmt = req.body.totalAmount ? Number(req.body.totalAmount) : (req.body.paidAmount ? Number(req.body.paidAmount) : null);
      const settled = await settlePaidQROrder(pool, orderNo, paymentMethod || "Yeahpay Paynow", verifiedPaidAmt);
      const ioInst = req.app.get("io");
      if (ioInst && (cleanId || updatedTable)) {
        const targetTableId = updatedTable?.TableId ? String(updatedTable.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase() : cleanId.toLowerCase();
        ioInst.emit("qr_payment_confirmed", {
          tableId: targetTableId,
          rawTableId: updatedTable?.TableId,
          tableNo: updatedTable?.tableNo,
          orderId: updatedTable?.CurrentOrderId || orderNo,
          paymentStatus: 1,
          entryStatus: updatedTable?.entryStatus || 'q',
        });
      }

      try {
        const { queueQRPrintJobs } = require("../utils/printHelper");
        await queueQRPrintJobs(pool, sql, {
          orderId: orderNo,
          tableNo: cleanId || "TAKEAWAY",
          isPaid: true,
          payMode: paymentMethod || "Yeahpay Paynow",
          io: ioInst,
        });
        console.log(`[QR Print Queue] Queued print jobs in complete-online-payment for Order ${orderNo}`);
        if (ioInst) {
          ioInst.emit("print_jobs_available", { orderId: orderNo, storeId: "STORE_001" });
        }
      } catch (printErr) {
        console.error("❌ Failed to queue print jobs in /complete-online-payment:", printErr.message);
      }

      if (ioInst) {
        ioInst.emit("settlement_updated", { action: "settlement_saved", orderId: orderNo });
        ioInst.emit("sales_updated", { orderId: orderNo });
      }
      return res.json({ success: true, ...settled });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ complete-online-payment error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Reduce Service Charge ────────────────────────────────────────────────────
// Self-healing: adds ServiceChargeOverride column if it doesn't exist
router.post("/reduce-service-charge", async (req, res) => {
  try {
    const { orderId, reduce } = req.body; // reduce = true to zero-out SC, false to restore
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    const pool = await poolPromise;

    // 🔧 Self-healing: ensure column exists
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'RestaurantOrderCur' AND COLUMN_NAME = 'ServiceChargeOverride'
      )
      ALTER TABLE RestaurantOrderCur ADD ServiceChargeOverride BIT NULL;
    `);

    const overrideValue = reduce === false ? 0 : 1; // 1 = SC reduced to 0
    await pool
      .request()
      .input("orderNo", sql.NVarChar(50), String(orderId).trim())
      .input("override", sql.Bit, overrideValue)
      .query(`
        UPDATE RestaurantOrderCur
        SET ServiceChargeOverride = @override, ModifiedOn = GETDATE()
        WHERE OrderNumber = @orderNo
          AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
      `);

    // Sync status to update related tables and broadcast total change
    const orderRes = await pool.request()
      .input("orderNo", sql.VarChar(50), String(orderId).trim())
      .query(`
        SELECT TOP 1 tm.TableId 
        FROM RestaurantOrderCur h
        LEFT JOIN TableMaster tm ON RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
        WHERE h.OrderNumber = @orderNo
      `);
    const tableId = orderRes.recordset[0]?.TableId;
    if (tableId) {
      const cleanTid = String(tableId).replace(/^\{|\}$/g, "").trim();
      await syncTableStatus(req, cleanTid);
      req.app.get("io")?.emit("cart_updated", {
        tableId: cleanTid.toLowerCase(),
        orderId: orderId,
      });
    }

    res.json({ success: true, serviceChargeReduced: overrideValue === 1 });
  } catch (err) {
    console.error("❌ reduce-service-charge Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET the current SC override status for an order
router.get("/:orderId/sc-override", async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    const pool = await poolPromise;

    // PERFORMANCE: Use cached column check — avoids slow INFORMATION_SCHEMA scan on every request
    const hasCol = await columnExists(pool, 'RestaurantOrderCur', 'ServiceChargeOverride');
    if (!hasCol) {
      return res.json({ serviceChargeReduced: false });
    }

    const result = await pool
      .request()
      .input("orderNo", sql.NVarChar(50), String(orderId).trim())
      .query(`
        SELECT TOP 1 ISNULL(ServiceChargeOverride, 0) AS ServiceChargeOverride
        FROM RestaurantOrderCur
        WHERE OrderNumber = @orderNo
          AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
      `);

    const reduced = result.recordset[0]?.ServiceChargeOverride === true || result.recordset[0]?.ServiceChargeOverride === 1;
    res.json({ serviceChargeReduced: reduced });
  } catch (err) {
    console.error("❌ sc-override GET Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Self-healing: adds TakeawayCharge and TakeawayChargeOverride columns if they don't exist to RestaurantOrderCur and RestaurantOrder
router.post("/apply-takeaway-charge", async (req, res) => {
  try {
    const { orderId, apply } = req.body; // apply = true to add takeaway charge, false to remove
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    const pool = await poolPromise;

    // 🔧 Self-healing: ensure columns exist
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'RestaurantOrderCur' AND COLUMN_NAME = 'TakeawayCharge'
      )
      ALTER TABLE RestaurantOrderCur ADD TakeawayCharge DECIMAL(18, 2) DEFAULT 0;
      
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'RestaurantOrder' AND COLUMN_NAME = 'TakeawayCharge'
      )
      ALTER TABLE RestaurantOrder ADD TakeawayCharge DECIMAL(18, 2) DEFAULT 0;

      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'RestaurantOrderCur' AND COLUMN_NAME = 'TakeawayChargeOverride'
      )
      ALTER TABLE RestaurantOrderCur ADD TakeawayChargeOverride BIT NULL;

      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'RestaurantOrder' AND COLUMN_NAME = 'TakeawayChargeOverride'
      )
      ALTER TABLE RestaurantOrder ADD TakeawayChargeOverride BIT NULL;
    `);

    let chargeValue = 0;
    if (apply) {
      // Get TakeawayCharges from CompanySettings
      const settingsRes = await pool.request().query("SELECT TOP 1 ISNULL(TakeawayCharges, 0) AS TakeawayCharges FROM CompanySettings WHERE Id = '1'");
      chargeValue = parseFloat(settingsRes.recordset[0]?.TakeawayCharges) || 0;
    }

    const overrideValue = apply ? 0 : 1;

    await pool
      .request()
      .input("orderNo", sql.NVarChar(50), String(orderId).trim())
      .input("charge", sql.Decimal(18, 2), chargeValue)
      .input("override", sql.Bit, overrideValue)
      .query(`
        UPDATE RestaurantOrderCur
        SET TakeawayCharge = @charge, TakeawayChargeOverride = @override, ModifiedOn = GETDATE()
        WHERE OrderNumber = @orderNo
          AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
      `);

    // Sync status to update related tables and broadcast total change
    const orderRes = await pool.request()
      .input("orderNo", sql.VarChar(50), String(orderId).trim())
      .query(`
        SELECT TOP 1 tm.TableId 
        FROM RestaurantOrderCur h
        LEFT JOIN TableMaster tm ON RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(tm.TableNumber))
        WHERE h.OrderNumber = @orderNo
      `);
    const tableId = orderRes.recordset[0]?.TableId;
    if (tableId) {
      const cleanTid = String(tableId).replace(/^\{|\}$/g, "").trim();
      await syncTableStatus(req, cleanTid);
      req.app.get("io")?.emit("cart_updated", {
        tableId: cleanTid.toLowerCase(),
        orderId: orderId,
      });
    }

    res.json({ success: true, takeawayCharge: chargeValue, takeawayChargeOverride: overrideValue });
  } catch (err) {
    console.error("❌ apply-takeaway-charge Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET the current takeaway charge status for an order
router.get("/:orderId/takeaway-charge", async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });
    const pool = await poolPromise;

    // PERFORMANCE: Use cached column check — avoids slow INFORMATION_SCHEMA scan on every request
    const hasCol = await columnExists(pool, 'RestaurantOrderCur', 'TakeawayChargeOverride');
    if (!hasCol) {
      return res.json({ takeawayCharge: 0, takeawayChargeOverride: 0 });
    }

    const result = await pool
      .request()
      .input("orderNo", sql.NVarChar(50), String(orderId).trim())
      .query(`
        SELECT TOP 1 ISNULL(TakeawayCharge, 0) AS TakeawayCharge, ISNULL(TakeawayChargeOverride, 0) AS TakeawayChargeOverride
        FROM RestaurantOrderCur
        WHERE OrderNumber = @orderNo
          AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
      `);

    const takeawayCharge = parseFloat(result.recordset[0]?.TakeawayCharge) || 0;
    const takeawayChargeOverride = result.recordset[0]?.TakeawayChargeOverride === true || result.recordset[0]?.TakeawayChargeOverride === 1 ? 1 : 0;
    res.json({ takeawayCharge, takeawayChargeOverride });
  } catch (err) {
    console.error("❌ takeaway-charge GET Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
