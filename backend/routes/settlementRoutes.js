const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
let processDayEndBonusCalculations;
try {
  processDayEndBonusCalculations = require('./artistBonus').processDayEndBonusCalculations;
} catch (err) {
  console.warn("⚠️ artistBonus module not found. Day-end bonus calculations will be stubbed.");
  processDayEndBonusCalculations = async () => {
    return { success: true, message: "Stubbed bonus calculation (module not found)" };
  };
}


// ============================================
// 📊 DAY START / DAY END BUSINESS WORKFLOW
// ============================================
router.post("/day-start", async (req, res) => {
  try {
    const { startDate, username } = req.body;
    if (!startDate) {
      return res.status(400).json({ error: "StartDate is required" });
    }
    const pool = getPool();
    
    // Check if there is already an active business day
    const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    if (activeDayRes.recordset.length > 0) {
      const activeDate = activeDayRes.recordset[0].StartDate;
      const formattedDate = activeDate instanceof Date 
        ? activeDate.toISOString().split("T")[0] 
        : activeDate;
      return res.status(400).json({ 
        error: `Cannot start a new day. The previous business day (${formattedDate}) is still active. Please perform Day End first.` 
      });
    }

    // Clear previous active records
    await pool.request().query("DELETE FROM DateEntry");
    
    // Insert new business day record (using Singapore time UTC+8)
    await pool.request()
      .input("username", sql.VarChar(30), username || "admin")
      .input("startDate", sql.Date, startDate)
      .input("createdBy", sql.VarChar(30), username || "admin")
      .query(`
        INSERT INTO DateEntry (username, StartDate, CreatedBy, CreatedDate)
        VALUES (@username, @startDate, @createdBy, DATEADD(MINUTE, 480, GETUTCDATE()))
      `);

    // Log Day Start in BusinessDayLog (using Singapore time UTC+8)
    await pool.request()
      .input("username", sql.VarChar(30), username || "admin")
      .input("startDate", sql.Date, startDate)
      .query(`
        IF EXISTS(SELECT 1 FROM BusinessDayLog WHERE BusinessDate = @startDate)
          UPDATE BusinessDayLog SET StartedAt = DATEADD(MINUTE, 480, GETUTCDATE()), StartedBy = @username, EndedAt = NULL, EndedBy = NULL WHERE BusinessDate = @startDate
        ELSE
          INSERT INTO BusinessDayLog (BusinessDate, StartedAt, StartedBy) VALUES (@startDate, DATEADD(MINUTE, 480, GETUTCDATE()), @username)
      `);

    // Record append-only audit trail (using Singapore time UTC+8)
    await pool.request()
      .input("username", sql.VarChar(30), username || "admin")
      .input("startDate", sql.Date, startDate)
      .query(`
        INSERT INTO BusinessDayAuditLog (BusinessDate, EventType, EventTime, ActionBy)
        VALUES (@startDate, 'DAY_START', DATEADD(MINUTE, 480, GETUTCDATE()), @username)
      `);
      
    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'day_started' });
    res.json({ success: true, message: "Day started successfully" });
  } catch (err) {
    console.error("Day Start Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/day-end", async (req, res) => {
  try {
    const pool = getPool();

    // Fetch active start date before deleting DateEntry
    const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    let activeStartDate = activeDayRes.recordset[0]?.StartDate;
    if (!activeStartDate && req.body?.businessDate) {
      activeStartDate = req.body.businessDate;
    }

    const actionUser = req.body?.username || 'admin';

    // Log Day End in BusinessDayLog (using Singapore time UTC+8)
    if (activeStartDate) {
      await pool.request()
        .input("startDate", sql.Date, activeStartDate)
        .input("username", sql.VarChar(30), actionUser)
        .query(`
          IF EXISTS (SELECT 1 FROM BusinessDayLog WHERE BusinessDate = @startDate)
            UPDATE BusinessDayLog 
            SET EndedAt = DATEADD(MINUTE, 480, GETUTCDATE()), EndedBy = @username 
            WHERE BusinessDate = @startDate
          ELSE
            INSERT INTO BusinessDayLog (BusinessDate, StartedAt, StartedBy, EndedAt, EndedBy)
            VALUES (@startDate, DATEADD(MINUTE, 480, GETUTCDATE()), @username, DATEADD(MINUTE, 480, GETUTCDATE()), @username)
        `);

      // Record append-only audit trail (using Singapore time UTC+8)
      await pool.request()
        .input("startDate", sql.Date, activeStartDate)
        .input("username", sql.VarChar(30), actionUser)
        .query(`
          INSERT INTO BusinessDayAuditLog (BusinessDate, EventType, EventTime, ActionBy)
          VALUES (@startDate, 'DAY_END', DATEADD(MINUTE, 480, GETUTCDATE()), @username)
        `);
    }

    // 1. Finalize artist bonus transactions for the active business day
    //    This must happen BEFORE DateEntry is cleared (we need the active StartDate)
    let bonusResult = null;
    try {
      bonusResult = await processDayEndBonusCalculations(pool);
      console.log('[DayEnd] Artist bonus finalization:', bonusResult);
    } catch (bonusErr) {
      // Non-fatal: log but continue with Day End
      console.error('[DayEnd] Artist bonus finalization error (non-fatal):', bonusErr.message);
    }

    // 2. Clear active business day — this officially ends the day
    await pool.request().query("DELETE FROM DateEntry");

    // Notify all connected clients to refresh settlement data
    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'day_ended' });

    res.json({
      success: true,
      message: "Day ended successfully",
      bonusFinalization: bonusResult,
    });
  } catch (err) {
    console.error("Day End Error:", err);
    res.status(500).json({ error: err.message });
  }
});


router.get("/active-day", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    if (result.recordset.length > 0) {
      const activeDate = result.recordset[0].StartDate;
      const formattedDate = activeDate instanceof Date ? activeDate.toISOString().split("T")[0] : activeDate;
      res.json({ success: true, active: true, startDate: formattedDate });
    } else {
      res.json({ success: true, active: false, startDate: null });
    }
  } catch (err) {
    console.error("Active Day Fetch Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/users-settlement", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const pool = getPool();
    const dateStr = fromDate || new Date().toISOString().split('T')[0];
    const endDateStr = toDate || dateStr;

    // 1. Fetch registered users from UserMaster (Admin and Cashier user groups only)
    const usersRes = await pool.request().query(`
      SELECT 
        CAST(u.UserId AS NVARCHAR(50)) AS CashierId,
        ISNULL(NULLIF(LTRIM(RTRIM(u.FullName)), ''), u.UserName) AS CashierName,
        ISNULL(u.UserName, '-') AS UserLogin,
        ISNULL(u.UserCode, '-') AS UserCode,
        ISNULL(g.UserGroupName, 'Cashier') AS RoleName
      FROM UserMaster u
      LEFT JOIN UserGroupMaster g ON u.UserGroupid = g.UserGroupId
      WHERE UPPER(LTRIM(RTRIM(ISNULL(g.UserGroupName, '')))) IN ('ADMIN', 'CASHIER', 'ADMINISTRATOR', 'SUPERADMIN')
         OR UPPER(LTRIM(RTRIM(ISNULL(u.UserName, '')))) IN ('ADMIN', 'UNIPRO', 'OWNER', 'CASHIER')
      ORDER BY u.UserName ASC
    `);

    // 2. Fetch login-wise sales for date range
    const salesRes = await pool.request()
      .input("fromDate", sql.Date, new Date(dateStr))
      .input("toDate", sql.Date, new Date(endDateStr))
      .query(`
        WITH HeaderTotals AS (
          SELECT
            sh.CashierId,
            COUNT(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN 1 END) AS TotalBills,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.SubTotal ELSE 0 END), 0) AS TotalSubTotal,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.DiscountAmount ELSE 0 END), 0) AS TotalDiscount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.ServiceCharge ELSE 0 END), 0) AS TotalServiceCharge,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.TotalTax ELSE 0 END), 0) AS TotalTax,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.TakeawayCharge ELSE 0 END), 0) AS TotalTakeaway,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.VoidItemAmount ELSE 0 END), 0) AS TotalVoidAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.VoidItemQty ELSE 0 END), 0) AS TotalVoidQty,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.RoundedBy ELSE 0 END), 0) AS TotalRounded,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 THEN sh.SysAmount ELSE 0 END), 0) AS TotalSales,
            ISNULL(SUM(CASE WHEN sh.IsCancelled = 1 THEN 1 ELSE 0 END), 0) AS CancelledBills
          FROM SettlementHeader sh
          WHERE COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE)) BETWEEN @fromDate AND @toDate
          GROUP BY sh.CashierId
        ),
        PaymentTotals AS (
          SELECT
            sh.CashierId,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CASH','CAS','1') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CashAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CARD','VISA','MASTER','MASTERCARD','AMEX') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CardAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('PAYNOW','3') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS PayNowAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('NETS','2') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS NetsAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('MEMBER','5') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS MemberAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CREDIT','6') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CreditAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('GRAB','10') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS GrabAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('FOODPANDA','9') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS FoodPandaAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('FOC','4','FREE OF CHARGE','FREE') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS FocAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('UPI','GPAY','PAYTM','PHONEPE') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS UpiAmount,
            ISNULL(SUM(CASE WHEN ISNULL(sh.IsCancelled, 0) = 0 AND UPPER(ISNULL(sts.PayMode,'')) LIKE 'YEAHPAY%' THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS YeahPayAmount
          FROM SettlementHeader sh
          LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
          WHERE COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE)) BETWEEN @fromDate AND @toDate
          GROUP BY sh.CashierId
        ),
        CreditCollections AS (
          SELECT
            cct.CreatedBy AS CashierIdRaw,
            ISNULL(SUM(cct.PaidAmount), 0) AS CreditCollectedAmount
          FROM CustomerCreditTransactions cct
          WHERE cct.TransactionType = 'PAYMENT'
            AND ISNULL(cct.CustomerType, 'CREDIT') = 'CREDIT'
            AND CAST(COALESCE(cct.start_date, cct.CreatedDate) AS DATE) BETWEEN @fromDate AND @toDate
          GROUP BY cct.CreatedBy
        )
        SELECT
          CAST(sh.CashierId AS NVARCHAR(50)) AS CashierIdRaw,
          sh.CashierId,
          ISNULL(h.TotalSubTotal, 0) AS TotalSubTotal,
          ISNULL(h.TotalDiscount, 0) AS TotalDiscount,
          ISNULL(h.TotalServiceCharge, 0) AS TotalServiceCharge,
          ISNULL(h.TotalTax, 0) AS TotalTax,
          ISNULL(h.TotalTakeaway, 0) AS TotalTakeaway,
          ISNULL(h.TotalSales, 0) AS TotalSales,
          ISNULL(p.CashAmount, 0) AS CashAmount,
          ISNULL(p.CardAmount, 0) AS CardAmount,
          ISNULL(p.PayNowAmount, 0) AS PayNowAmount,
          ISNULL(p.NetsAmount, 0) AS NetsAmount,
          ISNULL(p.MemberAmount, 0) AS MemberAmount,
          ISNULL(p.CreditAmount, 0) AS CreditAmount,
          ISNULL(p.GrabAmount, 0) AS GrabAmount,
          ISNULL(p.FoodPandaAmount, 0) AS FoodPandaAmount,
          ISNULL(p.UpiAmount, 0) AS UpiAmount,
          ISNULL(p.YeahPayAmount, 0) AS YeahPayAmount,
          ISNULL(cc.CreditCollectedAmount, 0) AS CreditCollectedAmount
        FROM SettlementHeader sh
        LEFT JOIN HeaderTotals h ON h.CashierId = sh.CashierId
        LEFT JOIN PaymentTotals p ON p.CashierId = sh.CashierId
        LEFT JOIN CreditCollections cc ON (
          TRY_CAST(cc.CashierIdRaw AS UNIQUEIDENTIFIER) = TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER)
          OR CAST(cc.CashierIdRaw AS NVARCHAR(50)) = CAST(sh.CashierId AS NVARCHAR(50))
          OR LOWER(LTRIM(RTRIM(cc.CashierIdRaw))) = LOWER(LTRIM(RTRIM(sh.CashierId)))
        )
        WHERE COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE), CAST(sh.CreatedOn AS DATE)) BETWEEN @fromDate AND @toDate
          AND ISNULL(sh.IsCancelled, 0) = 0
        GROUP BY
          CAST(sh.CashierId AS NVARCHAR(50)), sh.CashierId,
          h.TotalSubTotal, h.TotalDiscount, h.TotalServiceCharge, h.TotalTax, h.TotalTakeaway, h.TotalSales,
          p.CashAmount, p.CardAmount, p.PayNowAmount, p.NetsAmount, p.MemberAmount, p.CreditAmount, p.GrabAmount, p.FoodPandaAmount, p.UpiAmount, p.YeahPayAmount,
          cc.CreditCollectedAmount
      `);

    const salesMap = {};
    (salesRes.recordset || []).forEach(row => {
      if (row.CashierId) {
        const key = String(row.CashierId).trim().toLowerCase();
        salesMap[key] = row;
      }
    });

    const userList = (usersRes.recordset || []).map(u => {
      const uId = String(u.CashierId || "").trim().toLowerCase();
      const uName = String(u.UserLogin || "").trim().toLowerCase();
      const uFull = String(u.CashierName || "").trim().toLowerCase();

      const salesData = salesMap[uId] || salesMap[uName] || salesMap[uFull] || {};

      return {
        CashierId: u.CashierId,
        CashierName: u.CashierName,
        UserLogin: u.UserLogin,
        RoleName: u.RoleName,
        TotalBills: salesData.TotalBills || 0,
        CancelledBills: salesData.CancelledBills || 0,
        TotalSales: salesData.TotalSales || 0,
        TotalSubTotal: salesData.TotalSubTotal || 0,
        TotalDiscount: salesData.TotalDiscount || 0,
        TotalServiceCharge: salesData.TotalServiceCharge || 0,
        TotalTax: salesData.TotalTax || 0,
        TotalTakeaway: salesData.TotalTakeaway || 0,
        CashAmount: salesData.CashAmount || 0,
        CardAmount: salesData.CardAmount || 0,
        PayNowAmount: salesData.PayNowAmount || 0,
        NetsAmount: salesData.NetsAmount || 0,
        MemberAmount: salesData.MemberAmount || 0,
        CreditAmount: salesData.CreditAmount || 0,
        GrabAmount: salesData.GrabAmount || 0,
        FoodPandaAmount: salesData.FoodPandaAmount || 0,
        UpiAmount: salesData.UpiAmount || 0,
        YeahPayAmount: salesData.YeahPayAmount || 0,
        CreditCollectedAmount: salesData.CreditCollectedAmount || 0,
      };
    });

    res.json({ success: true, data: userList });
  } catch (err) {
    console.error("Users Settlement Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/day-log", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }
    const pool = getPool();
    const result = await pool.request()
      .input("date", sql.Date, date)
      .query("SELECT CONVERT(VARCHAR(19), StartedAt, 120) AS StartedAt, StartedBy, CONVERT(VARCHAR(19), EndedAt, 120) AS EndedAt, EndedBy FROM BusinessDayLog WHERE BusinessDate = @date");
    
    if (result.recordset.length > 0) {
      res.json({ success: true, data: result.recordset[0] });
    } else {
      // Check if DateEntry has a started day for this date (Self-Healing)
      const dateEntryRes = await pool.request()
        .input("date", sql.Date, date)
        .query("SELECT username, CONVERT(VARCHAR(19), CreatedDate, 120) AS CreatedDate FROM DateEntry WHERE StartDate = @date");
      
      if (dateEntryRes.recordset.length > 0) {
        const entry = dateEntryRes.recordset[0];
        // Insert missing BusinessDayLog entry
        await pool.request()
          .input("date", sql.Date, date)
          .input("username", sql.VarChar(30), entry.username || "admin")
          .input("createdDate", sql.VarChar(19), entry.CreatedDate)
          .query(`
            INSERT INTO BusinessDayLog (BusinessDate, StartedAt, StartedBy)
            VALUES (@date, @createdDate, @username)
          `);
        
        res.json({
          success: true,
          data: {
            StartedAt: entry.CreatedDate,
            StartedBy: entry.username || "admin",
            EndedAt: null,
            EndedBy: null
          }
        });
      } else {
        res.json({ success: true, data: null });
      }
    }
  } catch (err) {
    console.error("Day Log Fetch Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /day-history?date=YYYY-MM-DD or /day-history?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD
router.get("/day-history", async (req, res) => {
  try {
    const { date, fromDate, toDate } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `
      SELECT AuditId, BusinessDate, EventType, CONVERT(VARCHAR(19), EventTime, 120) AS EventTime, ActionBy, Remarks
      FROM BusinessDayAuditLog
    `;

    if (date) {
      request.input("date", sql.Date, date);
      query += ` WHERE BusinessDate = @date`;
    } else if (fromDate && toDate) {
      request.input("fromDate", sql.Date, fromDate);
      request.input("toDate", sql.Date, toDate);
      query += ` WHERE BusinessDate BETWEEN @fromDate AND @toDate`;
    }

    query += ` ORDER BY EventTime DESC`;

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset || [] });
  } catch (err) {
    console.error("Day History Fetch Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================
// 1️⃣ CHECK IF DAY IS SETTLED
// ============================================
router.get('/check', authenticateToken, async (req, res) => {
  try {
    let { outletId, date } = req.query;

    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }

    console.log('📡 Check settlement:', { outletId, date });

    const pool = getPool();
    const result = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, date)
      .query(`SELECT Id, Status FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate`);

    res.json({
      success: true,
      settled: result.recordset.length > 0 && result.recordset[0]?.Status === 'COMPLETED',
      settlementId: result.recordset[0]?.Id || null
    });
  } catch (err) {
    console.error('Check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 2️⃣ GET OPENING CASH
// ============================================
router.get('/opening-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, date } = req.query;

    // ✅ FIX: Safely parse integer or fallback to 1 for string IDs like 'SR'
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      outletId = 1;
    }

    const pool = getPool();
    const result = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, date)
      .query(`SELECT OpeningCashJSON, OpeningCashTotal FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate`);

    if (result.recordset.length === 0) {
      return res.json({ success: true, data: null });
    }

    if (!result.recordset[0]?.OpeningCashJSON) {
      return res.json({ success: true, data: { total: result.recordset[0].OpeningCashTotal || 0 } });
    }

    const data = JSON.parse(result.recordset[0].OpeningCashJSON);
    res.json({
      success: true,
      data: {
        notes: data.notes || {},
        coins: data.coins || {},
        total: result.recordset[0].OpeningCashTotal || 0
      }
    });
  } catch (err) {
    console.error('Get opening cash error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 3️⃣ SAVE OPENING CASH
// ============================================
router.post('/opening-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, settlementDate, notes, coins, total, cashierName } = req.body;

    // ✅ FIX: Safely parse integer or fallback to 1 for string IDs like 'SR'
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      outletId = 1;
    }

    const openingCashJSON = JSON.stringify({ notes, coins });
    const pool = getPool();

    await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .input('openingCashJSON', sql.NVarChar, openingCashJSON)
      .input('openingCashTotal', sql.Decimal(10, 2), total || 0)
      .input('cashierName', sql.NVarChar, cashierName || '')
      .query(`
        MERGE settlement AS target
        USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
        ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
        WHEN MATCHED THEN
          UPDATE SET OpeningCashJSON = @openingCashJSON, OpeningCashTotal = @openingCashTotal, CashierName = @cashierName, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (OutletId, SettlementDate, CashierName, OpeningCashJSON, OpeningCashTotal, CreatedAt)
          VALUES (@outletId, @settlementDate, @cashierName, @openingCashJSON, @openingCashTotal, GETDATE());
      `);

    res.json({ success: true, message: 'Opening cash saved' });
  } catch (err) {
    console.error('Save opening cash error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================
// 7️⃣ GET PHYSICAL CASH
// ============================================
router.get('/physical-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, date } = req.query;

    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }

    const pool = getPool();
    const result = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, date)
      .query(`SELECT PhysicalCashJSON, PhysicalCashTotal FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate`);

    if (result.recordset.length === 0 || !result.recordset[0]?.PhysicalCashJSON) {
      return res.json({ success: true, data: null });
    }

    const data = JSON.parse(result.recordset[0].PhysicalCashJSON);
    res.json({
      success: true,
      data: {
        notes: data.notes || {},
        coins: data.coins || {},
        total: result.recordset[0].PhysicalCashTotal || 0
      }
    });
  } catch (err) {
    console.error('Get physical cash error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 8️⃣ SAVE PHYSICAL CASH
// ============================================
router.post('/physical-cash', authenticateToken, async (req, res) => {
  try {
    let { outletId, settlementDate, notes, coins, total } = req.body;

    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }

    const physicalCashJSON = JSON.stringify({ notes, coins });
    const pool = getPool();

    await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .input('physicalCashJSON', sql.NVarChar, physicalCashJSON)
      .input('physicalCashTotal', sql.Decimal(10, 2), total || 0)
      .query(`
        MERGE settlement AS target
        USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
        ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
        WHEN MATCHED THEN
          UPDATE SET PhysicalCashJSON = @physicalCashJSON, PhysicalCashTotal = @physicalCashTotal, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (OutletId, SettlementDate, PhysicalCashJSON, PhysicalCashTotal, CreatedAt)
          VALUES (@outletId, @settlementDate, @physicalCashJSON, @physicalCashTotal, GETDATE());
      `);

    res.json({ success: true });
  } catch (err) {
    console.error('Save physical cash error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 9️⃣ FINALIZE SETTLEMENT
// ============================================
router.post('/finalize', authenticateToken, async (req, res) => {
  try {
    let { outletId, settlementDate, cashierName, totalSales, totalDiscount, voidAmount, netSales,
      cashReceived, openingCash, manualCashOutTotal, expectedClosing, physicalCash,
      variance, varianceStatus, cashAmount, cardAmount, upiAmount, paynowAmount, valueCardAmount } = req.body;

    // ✅ FIX: Convert to integer
    outletId = parseInt(outletId);
    if (isNaN(outletId)) {
      return res.status(400).json({ error: 'Invalid outletId' });
    }

    const paymentBreakdownJSON = JSON.stringify({
      cash: cashAmount || 0, card: cardAmount || 0, upi: upiAmount || 0,
      paynow: paynowAmount || 0, valuecard: valueCardAmount || 0
    });

    const pool = getPool();

    // Check if already settled
    const checkResult = await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .query(`SELECT Id FROM settlement WHERE OutletId = @outletId AND SettlementDate = @settlementDate AND Status = 'COMPLETED'`);

    if (checkResult.recordset.length > 0) {
      return res.status(400).json({ error: 'Day already settled' });
    }

    await pool.request()
      .input('outletId', sql.Int, outletId)
      .input('settlementDate', sql.Date, settlementDate)
      .input('cashierName', sql.NVarChar, cashierName || '')
      .input('totalSales', sql.Decimal(10, 2), totalSales || 0)
      .input('totalDiscount', sql.Decimal(10, 2), totalDiscount || 0)
      .input('voidAmount', sql.Decimal(10, 2), voidAmount || 0)
      .input('netSales', sql.Decimal(10, 2), netSales || 0)
      .input('cashReceived', sql.Decimal(10, 2), cashReceived || 0)
      .input('expectedClosing', sql.Decimal(10, 2), expectedClosing || 0)
      .input('cashVariance', sql.Decimal(10, 2), variance || 0)
      .input('varianceStatus', sql.NVarChar, varianceStatus || 'BALANCED')
      .input('paymentBreakdownJSON', sql.NVarChar, paymentBreakdownJSON)
      .input('status', sql.NVarChar, 'COMPLETED')
      .input('settledBy', sql.NVarChar, req.user.id || '')
      .query(`
        MERGE settlement AS target
        USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
        ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
        WHEN MATCHED THEN
          UPDATE SET 
            TotalSales = @totalSales,
            TotalDiscount = @totalDiscount,
            VoidAmount = @voidAmount,
            NetSales = @netSales,
            CashReceived = @cashReceived,
            ExpectedClosingCash = @expectedClosing,
            CashVariance = @cashVariance,
            VarianceStatus = @varianceStatus,
            PaymentBreakdownJSON = @paymentBreakdownJSON,
            Status = @status,
            SettledBy = @settledBy,
            SettledAt = GETDATE(),
            UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (
            OutletId, SettlementDate, CashierName, TotalSales, TotalDiscount, 
            VoidAmount, NetSales, CashReceived, ExpectedClosingCash, CashVariance, 
            VarianceStatus, PaymentBreakdownJSON, Status, SettledBy, SettledAt, 
            CreatedAt, UpdatedAt
          )
          VALUES (
            @outletId, @settlementDate, @cashierName, @totalSales, @totalDiscount, 
            @voidAmount, @netSales, @cashReceived, @expectedClosing, @cashVariance, 
            @varianceStatus, @paymentBreakdownJSON, @status, @settledBy, GETDATE(), 
            GETDATE(), GETDATE()
          );
      `);

    res.json({ success: true });
  } catch (err) {
    console.error('Error finalizing:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 10️⃣ GET DENOMINATIONS
// ============================================
router.get('/denominations', authenticateToken, async (req, res) => {
  try {
    const type = req.query.type === 'CLOSE' ? 'CLOSE' : 'OPEN';
    const { date, screenType } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `
      SELECT CurrencyValue, NoteCount 
      FROM OpeningCashDenomination 
      WHERE Type = @type
    `;
    request.input('type', sql.VarChar, type);

    const targetScreenType = screenType || 'CB';
    request.input('screenType', sql.VarChar, targetScreenType);
    query += ` AND (ScreenType = @screenType OR (ScreenType IS NULL AND @screenType = 'CB'))`;

    if (date) {
      request.input('date', sql.Date, date);
      query += ` AND CAST(CreatedOn as DATE) = @date`;
    } else {
      query += ` AND CAST(CreatedOn as DATE) = CAST(GETDATE() as DATE)`;
    }

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error getting denominations:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 11️⃣ SAVE DENOMINATIONS
// ============================================
router.post('/save-denominations', authenticateToken, async (req, res) => {
  try {
    const { denominations, type, date, outletId, screenType } = req.body;
    const recordType = type === 'CLOSE' ? 'CLOSE' : 'OPEN';
    const targetScreenType = screenType || 'CB';

    if (!denominations || !Array.isArray(denominations)) {
      return res.status(400).json({ error: 'Invalid denominations data' });
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Day Start / Day End validation check
      const activeDayRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
      if (activeDayRes.recordset.length === 0) {
        throw new Error("No active business date. Please Start Day first.");
      }
      const activeStartDate = activeDayRes.recordset[0].StartDate;
      const formattedStartDate = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : activeStartDate;

      const request = new sql.Request(transaction);
      const createdBy = req.user?.userName || req.user?.username || 'Admin';

      const targetDate = date ? new Date(date) : new Date();

      // Delete existing records for targetDate and targetScreenType to allow "update"
      request.input('targetDate', sql.Date, targetDate);
      request.input('screenType', sql.VarChar, targetScreenType);
      await request.query(`
        DELETE FROM OpeningCashDenomination 
        WHERE CAST(CreatedOn as DATE) = @targetDate
        AND Type = '${recordType}'
        AND (ScreenType = @screenType OR (ScreenType IS NULL AND @screenType = 'CB'))
      `);

      // Loop through and insert each denomination that has a count > 0
      for (const item of denominations) {
        if (item.count > 0) {
          const insertReq = new sql.Request(transaction);
          insertReq.input('value', sql.Decimal(10, 2), item.value);
          insertReq.input('count', sql.Int, item.count);
          insertReq.input('recordType', sql.VarChar, recordType);
          insertReq.input('createdBy', sql.VarChar, createdBy);
          insertReq.input('targetDate', sql.Date, targetDate);
          insertReq.input('screenType', sql.VarChar, targetScreenType);
          insertReq.input('startDate', sql.Date, formattedStartDate);

          const dateValue = date ? '@targetDate' : 'GETDATE()';
          await insertReq.query(`
            INSERT INTO OpeningCashDenomination (CurrencyValue, NoteCount, Type, CreatedBy, CreatedOn, ScreenType, start_date)
            VALUES (@value, @count, @recordType, @createdBy, ${dateValue}, @screenType, @startDate)
          `);
        }
      }

      // Sync to settlement table
      const notes = {};
      const coins = {};
      let totalAmount = 0;
      for (const item of denominations) {
        if (item.count > 0) {
          totalAmount += item.value * item.count;
          const key = item.value.toFixed(2);
          if (item.value >= 1) {
            notes[key] = item.count;
          } else {
            coins[key] = item.count;
          }
        }
      }
      const jsonStr = JSON.stringify({ notes, coins });

      const parsedOutletId = parseInt(outletId) || 1;

      if (recordType === 'OPEN') {
        const setRequest = new sql.Request(transaction);
        setRequest.input('outletId', sql.Int, parsedOutletId);
        setRequest.input('settlementDate', sql.Date, targetDate);
        setRequest.input('openingCashJSON', sql.NVarChar, jsonStr);
        setRequest.input('openingCashTotal', sql.Decimal(10, 2), totalAmount);
        setRequest.input('cashierName', sql.NVarChar, createdBy || '');
        await setRequest.query(`
          MERGE settlement AS target
          USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
          ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
          WHEN MATCHED THEN
            UPDATE SET OpeningCashJSON = @openingCashJSON, OpeningCashTotal = @openingCashTotal, CashierName = @cashierName, UpdatedAt = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (OutletId, SettlementDate, CashierName, OpeningCashJSON, OpeningCashTotal, CreatedAt)
            VALUES (@outletId, @settlementDate, @cashierName, @openingCashJSON, @openingCashTotal, GETDATE());
        `);
      } else if (recordType === 'CLOSE') {
        const setRequest = new sql.Request(transaction);
        setRequest.input('outletId', sql.Int, parsedOutletId);
        setRequest.input('settlementDate', sql.Date, targetDate);
        setRequest.input('physicalCashJSON', sql.NVarChar, jsonStr);
        setRequest.input('physicalCashTotal', sql.Decimal(10, 2), totalAmount);
        await setRequest.query(`
          MERGE settlement AS target
          USING (SELECT @outletId as OutletId, @settlementDate as SettlementDate) AS source
          ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
          WHEN MATCHED THEN
            UPDATE SET PhysicalCashJSON = @physicalCashJSON, PhysicalCashTotal = @physicalCashTotal, UpdatedAt = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (OutletId, SettlementDate, PhysicalCashJSON, PhysicalCashTotal, CreatedAt)
            VALUES (@outletId, @settlementDate, @physicalCashJSON, @physicalCashTotal, GETDATE());
        `);
      }

      await transaction.commit();
      // Notify all connected clients to refresh settlement data
      const io = req.app.get('io');
      if (io) io.emit('settlement_updated', { action: 'denominations_saved' });
      res.json({ success: true, message: 'Denominations saved successfully' });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Error saving denominations:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// 12️⃣ CASH OUT CRUD OPERATIONS
// ============================================

// GET Cash Out entries for a specific terminal (or ALL) for today
router.get('/cash-out/:terminal', authenticateToken, async (req, res) => {
  try {
    const { terminal } = req.params;
    const { fromDate, toDate, userId } = req.query;
    const pool = getPool();
    const request = pool.request();

    let dateFilter = "COALESCE(CAST(CashOutDate as DATE), start_date) = CAST(GETDATE() as DATE)";
    if (fromDate && toDate) {
      request.input("fromDate", sql.Date, new Date(fromDate));
      request.input("toDate", sql.Date, new Date(toDate));
      dateFilter = "COALESCE(CAST(CashOutDate as DATE), start_date) BETWEEN @fromDate AND @toDate";
    }

    let userFilter = "";
    if (userId && userId !== "ALL" && userId !== "0") {
      request.input("userIdParam", sql.VarChar, userId);
      userFilter = ` AND (
        LOWER(LTRIM(RTRIM(CreatedBy))) = LOWER(LTRIM(RTRIM(@userIdParam))) 
        OR TRY_CAST(CreatedBy AS NVARCHAR(50)) = @userIdParam
        OR CreatedBy IN (SELECT UserName FROM UserMaster WHERE CAST(UserId AS NVARCHAR(50)) = @userIdParam OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@userIdParam))) OR LOWER(LTRIM(RTRIM(FullName))) = LOWER(LTRIM(RTRIM(@userIdParam))))
        OR CreatedBy IN (SELECT FullName FROM UserMaster WHERE CAST(UserId AS NVARCHAR(50)) = @userIdParam OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@userIdParam))) OR LOWER(LTRIM(RTRIM(FullName))) = LOWER(LTRIM(RTRIM(@userIdParam))))
      )`;
    }

    let query = `
      SELECT CashOutId, CashOutNo, CashOutDate, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn, start_date, AttachmentUrl
      FROM CashOutEntry 
      WHERE ${dateFilter}${userFilter}
    `;

    query += ` ORDER BY CreatedOn DESC`;

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error fetching cash out entries:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET Cash In entries for today
router.get('/cash-in/:terminal', authenticateToken, async (req, res) => {
  try {
    const { terminal } = req.params;
    const { fromDate, toDate, userId } = req.query;
    const pool = getPool();
    const request = pool.request();

    let dateFilter = "COALESCE(CAST(CashInDate as DATE), start_date) = CAST(GETDATE() as DATE)";
    if (fromDate && toDate) {
      request.input("fromDate", sql.Date, new Date(fromDate));
      request.input("toDate", sql.Date, new Date(toDate));
      dateFilter = "COALESCE(CAST(CashInDate as DATE), start_date) BETWEEN @fromDate AND @toDate";
    }

    let userFilter = "";
    if (userId && userId !== "ALL" && userId !== "0") {
      request.input("userIdParam", sql.VarChar, userId);
      userFilter = ` AND (
        LOWER(LTRIM(RTRIM(ci.CreatedBy))) = LOWER(LTRIM(RTRIM(@userIdParam))) 
        OR TRY_CAST(ci.CreatedBy AS NVARCHAR(50)) = @userIdParam 
        OR LOWER(LTRIM(RTRIM(sh.CashierId))) = LOWER(LTRIM(RTRIM(@userIdParam))) 
        OR TRY_CAST(sh.CashierId AS NVARCHAR(50)) = @userIdParam
        OR ci.CreatedBy IN (SELECT UserName FROM UserMaster WHERE CAST(UserId AS NVARCHAR(50)) = @userIdParam OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@userIdParam))) OR LOWER(LTRIM(RTRIM(FullName))) = LOWER(LTRIM(RTRIM(@userIdParam))))
        OR ci.CreatedBy IN (SELECT FullName FROM UserMaster WHERE CAST(UserId AS NVARCHAR(50)) = @userIdParam OR LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@userIdParam))) OR LOWER(LTRIM(RTRIM(FullName))) = LOWER(LTRIM(RTRIM(@userIdParam))))
      )`;
    }

    let query = `
      SELECT 
        ci.CashInId, 
        ci.CashInNo, 
        ci.CashInDate, 
        ci.Amount, 
        ci.Reason, 
        ci.Remarks, 
        ci.PaymentMode, 
        ci.ReferenceNo, 
        ci.TerminalCode, 
        ci.CreatedBy, 
        ci.CreatedOn, 
        ci.start_date, 
        ci.AttachmentUrl,
        CASE 
          WHEN ci.Reason = 'Ledger Payment' OR ci.Reason = 'Credit Settlement' THEN 'LEDGER'
          WHEN ci.Reason = 'Cash Sale' THEN 'SALE'
          WHEN ci.Remarks LIKE 'Auto Cash In from BILL%' THEN 'SALE'
          WHEN ci.Remarks LIKE 'Auto Cash In from MEMBER%' THEN 'LEDGER'
          WHEN sh.SettlementID IS NOT NULL THEN 'SALE'
          WHEN cct.SettlementId IS NOT NULL THEN 'LEDGER'
          WHEN ptd.PaymentTransactionId IS NOT NULL THEN 'LEDGER'
          WHEN ci.Reason = 'Cash In' AND (ci.Remarks LIKE '%MEMBER%' OR ci.Remarks LIKE '%CREDIT%') THEN 'LEDGER'
          ELSE 'MANUAL'
        END AS CashInType
      FROM CashInEntry ci
      LEFT JOIN SettlementHeader sh ON ci.ReferenceNo = CAST(sh.SettlementID AS VARCHAR(50))
      LEFT JOIN CustomerCreditTransactions cct ON ci.ReferenceNo = CAST(cct.SettlementId AS VARCHAR(50))
      LEFT JOIN PaymentTransactionDetails ptd ON ci.ReferenceNo = CAST(ptd.PaymentTransactionId AS VARCHAR(50))
      WHERE ${dateFilter.replace(/start_date/g, 'ci.start_date').replace(/CashInDate/g, 'ci.CashInDate')}${userFilter}
    `;

    query += ` ORDER BY ci.CreatedOn DESC`;

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Error fetching cash in entries:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST new Cash In entry
router.post('/cash-in', authenticateToken, async (req, res) => {
  try {
    const { amount, reason, remarks, paymentMode, referenceNo, terminalCode, date, attachmentUrl } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const createdBy = req.body.createdBy || req.user?.userName || req.user?.username || req.user?.id || req.user?.userId || 'Admin';
    const pool = getPool();

    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, '');
    const randId = Math.floor(1000 + Math.random() * 9000);
    const cashInNo = `CI-${dateStr}-${randId}`;

    const result = await pool.request()
      .input('CashInNo', sql.VarChar, cashInNo)
      .input('Amount', sql.Decimal(18, 2), amount)
      .input('Reason', sql.VarChar, reason || '')
      .input('Remarks', sql.VarChar, remarks || '')
      .input('PaymentMode', sql.VarChar, paymentMode || 'Cash')
      .input('ReferenceNo', referenceNo || '')
      .input('TerminalCode', sql.VarChar, terminalCode || '')
      .input('CreatedBy', sql.VarChar, createdBy)
      .input('targetDate', sql.Date, targetDate)
      .input('AttachmentUrl', sql.VarChar(500), attachmentUrl || null)
      .query(`
        INSERT INTO CashInEntry (CashInNo, CashInDate, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn, start_date, AttachmentUrl)
        OUTPUT inserted.*
        VALUES (@CashInNo, @targetDate, @Amount, @Reason, @Remarks, @PaymentMode, @ReferenceNo, @TerminalCode, @CreatedBy, @targetDate, @targetDate, @AttachmentUrl)
      `);

    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'cash_in_added' });
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('Error creating cash in entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE Cash In entry
router.delete('/cash-in/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    await pool.request()
      .input('CashInId', sql.UniqueIdentifier, id)
      .query('DELETE FROM CashInEntry WHERE CashInId = @CashInId');
    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'cash_in_deleted' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting cash in entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update Cash In entry
router.put('/cash-in/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, remarks, paymentMode, referenceNo, terminalCode, attachmentUrl } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const pool = getPool();
    const result = await pool.request()
      .input('CashInId', sql.UniqueIdentifier, id)
      .input('Amount', sql.Decimal(18, 2), amount)
      .input('Reason', sql.VarChar, reason || '')
      .input('Remarks', sql.VarChar, remarks || '')
      .input('PaymentMode', sql.VarChar, paymentMode || 'Cash')
      .input('ReferenceNo', referenceNo || '')
      .input('TerminalCode', sql.VarChar, terminalCode || '')
      .input('AttachmentUrl', sql.VarChar(500), attachmentUrl || null)
      .query(`
        UPDATE CashInEntry
        SET Amount = @Amount, Reason = @Reason, Remarks = @Remarks, PaymentMode = @PaymentMode, 
            ReferenceNo = @ReferenceNo, TerminalCode = @TerminalCode, AttachmentUrl = @AttachmentUrl
        OUTPUT inserted.*
        WHERE CashInId = @CashInId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Cash in entry not found' });
    }

    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'cash_in_updated' });
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('Error updating cash in entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST new Cash Out entry
router.post('/cash-out', authenticateToken, async (req, res) => {
  try {
    const { amount, reason, remarks, paymentMode, referenceNo, terminalCode, date, attachmentUrl } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const createdBy = req.body.createdBy || req.user?.userName || req.user?.username || req.user?.id || req.user?.userId || 'Admin';
    const pool = getPool();

    // Generate simple auto-incrementing/timestamp-based CashOutNo
    const targetDate = date ? new Date(date) : new Date();
    const dateStr = targetDate.toISOString().slice(0, 10).replace(/-/g, '');
    const randId = Math.floor(1000 + Math.random() * 9000);
    const cashOutNo = `CO-${dateStr}-${randId}`;

    const result = await pool.request()
      .input('CashOutNo', sql.VarChar, cashOutNo)
      .input('Amount', sql.Decimal(18, 2), amount)
      .input('Reason', sql.VarChar, reason || '')
      .input('Remarks', sql.VarChar, remarks || '')
      .input('PaymentMode', sql.VarChar, paymentMode || 'Cash')
      .input('ReferenceNo', sql.VarChar, referenceNo || '')
      .input('TerminalCode', sql.VarChar, terminalCode || '')
      .input('CreatedBy', sql.VarChar, createdBy)
      .input('targetDate', sql.Date, targetDate)
      .input('AttachmentUrl', sql.VarChar(500), attachmentUrl || null)
      .query(`
        INSERT INTO CashOutEntry (CashOutNo, CashOutDate, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn, start_date, AttachmentUrl)
        OUTPUT inserted.*
        VALUES (@CashOutNo, @targetDate, @Amount, @Reason, @Remarks, @PaymentMode, @ReferenceNo, @TerminalCode, @CreatedBy, @targetDate, @targetDate, @AttachmentUrl)
      `);

    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'cash_out_added' });
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('Error creating cash out entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT update Cash Out entry
router.put('/cash-out/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, remarks, paymentMode, referenceNo, terminalCode, attachmentUrl } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const pool = getPool();
    const result = await pool.request()
      .input('CashOutId', sql.UniqueIdentifier, id)
      .input('Amount', sql.Decimal(18, 2), amount)
      .input('Reason', sql.VarChar, reason || '')
      .input('Remarks', sql.VarChar, remarks || '')
      .input('PaymentMode', sql.VarChar, paymentMode || 'Cash')
      .input('ReferenceNo', sql.VarChar, referenceNo || '')
      .input('TerminalCode', sql.VarChar, terminalCode || '')
      .input('AttachmentUrl', sql.VarChar(500), attachmentUrl || null)
      .query(`
        UPDATE CashOutEntry
        SET Amount = @Amount, Reason = @Reason, Remarks = @Remarks, PaymentMode = @PaymentMode, 
            ReferenceNo = @ReferenceNo, TerminalCode = @TerminalCode, AttachmentUrl = @AttachmentUrl
        OUTPUT inserted.*
        WHERE CashOutId = @CashOutId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Cash out entry not found' });
    }

    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'cash_out_updated' });
    res.json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error('Error updating cash out entry:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE Cash Out entry
router.delete('/cash-out/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const result = await pool.request()
      .input('CashOutId', sql.UniqueIdentifier, id)
      .query(`
        DELETE FROM CashOutEntry
        WHERE CashOutId = @CashOutId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Cash out entry not found' });
    }

    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'cash_out_deleted' });
    res.json({ success: true, message: 'Cash out entry deleted successfully' });
  } catch (err) {
    console.error('Error deleting cash out entry:', err);
    res.status(500).json({ error: err.message });
  }
});


// GET Artist Cash Box entries
router.get('/artist-cashbox', authenticateToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `SELECT * FROM ArtistCashBox`;
    if (fromDate && toDate) {
      request.input('fromDate', sql.Date, new Date(fromDate));
      request.input('toDate', sql.Date, new Date(toDate));
      query += ` WHERE ISNULL(start_date, CAST(CreatedDate AS DATE)) BETWEEN @fromDate AND @toDate`;
    }
    query += ` ORDER BY CreatedDate DESC`;

    const result = await request.query(query);
    res.json({ success: true, data: result.recordset || [] });
  } catch (err) {
    console.error('Error fetching artist cashbox:', err);
    res.status(500).json({ error: err.message });
  }
});


// POST Cash Box Entry
router.post('/artist-cashbox', authenticateToken, async (req, res) => {
  try {
    const { ArtistName, Amount } = req.body;

    if (!ArtistName || !Amount) {
      return res.status(400).json({
        error: 'Artist Name and Amount are required'
      });
    }

    const pool = getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Day Start / Day End validation check
      const activeDayRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
      if (activeDayRes.recordset.length === 0) {
        throw new Error("No active business date. Please Start Day first.");
      }
      const activeStartDate = activeDayRes.recordset[0].StartDate;
      const formattedStartDate = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : activeStartDate;

      console.log('[CASHBOX] STEP 1: Skip ArtistCashBox table insert...');
      console.log('[CASHBOX] STEP 1 OK');

      console.log('[CASHBOX] STEP 2: Looking up DishMaster...');
      // 2. Look up DishMaster for this artist
      const dishQuery = await transaction.request()
        .input('ArtistName', sql.VarChar, ArtistName)
        .query(`
          SELECT TOP 1 d.DishId, d.DishGroupId,
                 cm.CategoryId, cm.CategoryName, 
                 dg.DishGroupName as SubCategoryName
          FROM DishMaster d
          LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
          WHERE d.Name = @ArtistName
        `);

      const dish = dishQuery.recordset[0] || {};
      const price = Amount; // User enters amount directly
      const qty = 1;
      console.log('[CASHBOX] STEP 2 OK - dish:', JSON.stringify(dish), '| qty:', qty, '| price:', price);

      // 2b. Insert sales record into dishOrderItemShare for the artist - REMOVED per user request
      const crypto = require('crypto');

      const settlementId = crypto.randomUUID();

      console.log('[CASHBOX] STEP 2b: Inserting into ArtistCashBox...');
      const cashboxId = crypto.randomUUID();
      await transaction.request()
        .input('CashBoxId', sql.UniqueIdentifier, cashboxId)
        .input('ArtistName', sql.VarChar, ArtistName)
        .input('Amount', sql.Decimal(18, 2), Amount)
        .input('SettlementID', sql.UniqueIdentifier, settlementId)
        .input('startDate', sql.Date, formattedStartDate)
        .query(`
          INSERT INTO ArtistCashBox (CashBoxId, ArtistName, Amount, CreatedDate, SettlementID, start_date)
          VALUES (@CashBoxId, @ArtistName, @Amount, GETDATE(), @SettlementID, @startDate)
        `);
      console.log('[CASHBOX] STEP 2b OK');

      const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' }).replace(/-/g, '');
      const billNo = `CB-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;

      const toGuidOrNull = (id) =>
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) ? id : null;
      const userId = toGuidOrNull(req.user?.id || req.user?.userId) || '00000000-0000-0000-0000-000000000000';
      console.log('[CASHBOX] userId:', userId);

      console.log('[CASHBOX] STEP 3: Inserting SettlementHeader...');
      // 3. Insert SettlementHeader
      await transaction.request()
        .input('SettlementID', sql.UniqueIdentifier, settlementId)
        .input('Amount', sql.Decimal(18, 2), Amount)
        .input('BillNo', sql.VarChar(50), billNo)
        .input('UserId', sql.UniqueIdentifier, userId)
        .input('startDate', sql.Date, formattedStartDate)
        .query(`
          INSERT INTO SettlementHeader (
            SettlementID, LastSettlementDate, LastDayEndDate, SubTotal, TotalTax, DiscountAmount, 
            DiscountType, BillNo, OrderType, TableNo, Section, SysAmount, ManualAmount, 
            CreatedBy, CreatedOn, VoidItemQty, VoidItemAmount, RoundedBy, ServiceCharge, IsCancelled, start_date
          ) VALUES (
            @SettlementID, GETDATE(), GETDATE(), @Amount, 0, 0, 
            'AMOUNT', @BillNo, 'CASHBOX', 'CASHBOX', 'CASHBOX', @Amount, @Amount, 
            @UserId, GETDATE(), 0, 0, 0, 0, 0, @startDate
          )
        `);
      console.log('[CASHBOX] STEP 3 OK');

      console.log('[CASHBOX] STEP 4: Inserting SettlementItemDetail...');
      // 4. Insert SettlementItemDetail
      await transaction.request()
        .input('SettlementID', sql.UniqueIdentifier, settlementId)
        .input('DishId', sql.UniqueIdentifier, dish.DishId || null)
        .input('DishGroupId', sql.UniqueIdentifier, dish.DishGroupId || null)
        .input('CategoryId', sql.UniqueIdentifier, dish.CategoryId || null)
        .input('SubCategoryId', sql.UniqueIdentifier, dish.DishGroupId || null)
        .input('DishName', sql.NVarChar(255), ArtistName)
        .input('CategoryName', sql.NVarChar(255), dish.CategoryName || 'ENTERTAINMENT')
        .input('SubCategoryName', sql.NVarChar(255), dish.SubCategoryName || 'Solo')
        .input('Qty', sql.Int, qty)
        .input('Price', sql.Decimal(18, 2), price)
        .input('Status', sql.NVarChar(50), 'NORMAL')
        .input('startDate', sql.Date, formattedStartDate)
        .query(`
          INSERT INTO SettlementItemDetail (
            SettlementID, DishId, DishGroupId, CategoryId, SubCategoryId,
            DishName, CategoryName, SubCategoryName,
            Qty, Price, OrderDateTime, Status, start_date
          ) VALUES (
            @SettlementID, @DishId, @DishGroupId, @CategoryId, @SubCategoryId,
            @DishName, @CategoryName, @SubCategoryName,
            @Qty, @Price, GETDATE(), @Status, @startDate
          )
        `);
      console.log('[CASHBOX] STEP 4 OK');

      console.log('[CASHBOX] STEP 5: Inserting SettlementTotalSales/Detail/TranDetail...');
      // 5. Insert SettlementTotalSales, SettlementDetail, SettlementTranDetail
      await transaction.request()
        .input('SettlementID', sql.UniqueIdentifier, settlementId)
        .input('Amount', sql.Money, Amount)
        .query(`
          INSERT INTO SettlementTotalSales (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff, ReceiptCount)
          VALUES (@SettlementID, 'Cash Box Entry', @Amount, @Amount, 0, 1);

          INSERT INTO SettlementDetail (SettlementId, Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount, IsCollected)
          VALUES (@SettlementID, 'Cash Box Entry', @Amount, @Amount, 0, 1, 0);

          INSERT INTO SettlementTranDetail (SettlementID, PayMode, CashIn, CashOut)
          VALUES (@SettlementID, 'Cash Box Entry', @Amount, 0);
        `);
      console.log('[CASHBOX] STEP 5 OK');

      console.log('[CASHBOX] STEP 6: Getting BusinessUnitId...');
      // 6. Insert PaymentDetailCur + PaymentDetail for report sync
      const paymentId = crypto.randomUUID();

      // Get default BusinessUnitId (required NOT NULL)
      const bizRes = await transaction.request().query(`SELECT TOP 1 BusinessUnitId FROM SettlementHeader WHERE IsCancelled = 0 ORDER BY CreatedOn DESC`);
      const bizId = bizRes.recordset[0]?.BusinessUnitId || 'FBFD4E31-5C91-4DEC-86EA-989D3B5639CA';
      console.log('[CASHBOX] STEP 6 bizId:', bizId);

      console.log('[CASHBOX] STEP 7: Inserting PaymentDetailCur + PaymentDetail...');
      await transaction.request()
        .input('PaymentId', sql.UniqueIdentifier, paymentId)
        .input('SettlementID', sql.UniqueIdentifier, settlementId)
        .input('Amount', sql.Decimal(18, 2), Amount)
        .input('UserId', sql.UniqueIdentifier, userId)
        .input('BizId', sql.UniqueIdentifier, bizId)
        .input('startDate', sql.Date, formattedStartDate)
        .query(`
          INSERT INTO PaymentDetailCur (
            PaymentId, RestaurantBillId, BilledFor, PaymentCollectedOn, 
            PaymentType, Paymode, Amount, Remarks, BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, start_date
          ) VALUES (
            @PaymentId, @SettlementID, 1, GETDATE(), 
            1, 1, @Amount, 'Cash Box Entry', @BizId, @UserId, GETDATE(), @UserId, GETDATE(), @startDate
          );

          INSERT INTO PaymentDetail (
            PaymentId, RestaurantBillId, SettlementId, InvoiceId, BilledFor, PaymentCollectedOn, 
            PaymentType, Paymode, Amount, Remarks, BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, isSettlement, start_date
          ) VALUES (
            @PaymentId, @SettlementID, @SettlementID, @SettlementID, 1, GETDATE(), 
            1, 1, @Amount, 'Cash Box Entry', @BizId, @UserId, GETDATE(), @UserId, GETDATE(), 1, @startDate
          );
        `);
      console.log('[CASHBOX] STEP 7 OK');

      await transaction.commit();
      console.log(`[CASHBOX] SUCCESS - settlement ${settlementId} for ${ArtistName} - Amount: ${Amount}`);

      res.json({
        success: true,
        settlementId
      });

    } catch (innerErr) {
      console.error('[CASHBOX] FAILED at step above. Error:', innerErr.message);
      try { await transaction.rollback(); } catch (e) { }
      throw innerErr;
    }

  } catch (err) {
    console.error('Cash Box Save Error:', err);
    res.status(500).json({
      error: err.message
    });
  }
});

// DELETE Artist Cash Box entry and its associated settlement records
router.delete('/artist-cashbox/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params; // CashBoxId
    const pool = getPool();
    
    // First, find the SettlementID associated with this CashBoxId
    const findRes = await pool.request()
      .input('CashBoxId', sql.UniqueIdentifier, id)
      .query('SELECT SettlementID FROM ArtistCashBox WHERE CashBoxId = @CashBoxId');
      
    if (findRes.recordset.length === 0) {
      return res.status(404).json({ error: 'Cash box entry not found' });
    }
    
    const settlementId = findRes.recordset[0].SettlementID;
    
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const request = new sql.Request(transaction);
      request.input('CashBoxId', sql.UniqueIdentifier, id);
      request.input('SettlementID', sql.UniqueIdentifier, settlementId);
      
      // Delete from ArtistCashBox
      await request.query('DELETE FROM ArtistCashBox WHERE CashBoxId = @CashBoxId');
      
      // Delete associated settlement records
      await request.query('DELETE FROM SettlementHeader WHERE SettlementID = @SettlementID');
      await request.query('DELETE FROM SettlementItemDetail WHERE SettlementID = @SettlementID');
      await request.query('DELETE FROM SettlementTotalSales WHERE SettlementID = @SettlementID');
      await request.query('DELETE FROM SettlementDetail WHERE SettlementId = @SettlementID');
      await request.query('DELETE FROM SettlementTranDetail WHERE SettlementID = @SettlementID');
      await request.query('DELETE FROM PaymentDetailCur WHERE RestaurantBillId = @SettlementID');
      await request.query('DELETE FROM PaymentDetail WHERE RestaurantBillId = @SettlementID');
      
      await transaction.commit();

      const io = req.app.get('io');
      if (io) io.emit('settlement_updated', { action: 'settlement_deleted' });

      res.json({ success: true, message: 'Cash box entry and associated settlement deleted successfully' });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (e) {}
      throw innerErr;
    }
  } catch (err) {
    console.error('Error deleting artist cashbox:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/artist-list', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();

    const result = await pool.request().query(`
      SELECT
        DishId,
        Name
      FROM DishMaster
      WHERE IsActive = 1
      and IsSplitDish = 1
      and IsGroupDish = 0
      ORDER BY Name
    `);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (err) {
    console.error('Artist List Error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/artist-sales', authenticateToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const pool = getPool();
    const request = pool.request();
    
    // Set fallback date parameters if none provided
    const parsedFrom = fromDate ? new Date(fromDate) : new Date();
    if (!fromDate) parsedFrom.setHours(0,0,0,0);
    const parsedTo = toDate ? new Date(toDate) : new Date();

    request.input("fromDate", sql.Date, parsedFrom);
    request.input("toDate", sql.Date, parsedTo);

    const result = await request.query(`
      SELECT 
        d.DishId,
        d.Name,
        ISNULL(targets.Amount, 0) as ActualSales,
        ISNULL(targets.TargetAmount, 0) as TargetAmount
      FROM DishMaster d
      LEFT JOIN (
        SELECT DishId, Amount, TargetAmount
        FROM dishOrderItemShare
        WHERE CAST(FromDate as DATE) = @fromDate AND CAST(ToDate as DATE) = @toDate
      ) targets ON d.DishId = targets.DishId
      WHERE d.IsActive = 1
        AND d.IsSplitDish = 1
        AND d.IsGroupDish = 0
      ORDER BY d.Name
    `);

    res.json({
      success: true,
      data: result.recordset
    });
  } catch (err) {
    console.error('Artist Sales Error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// GET live artist target dashboard — Entertainment sales exactly matching Item Sales Report
// joined with TargetAmount from dishOrderItemShare
router.get('/artist-target-live', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { fromDate, toDate } = req.query;

    const parsedFrom = fromDate ? new Date(fromDate) : new Date();
    if (!fromDate) parsedFrom.setHours(0, 0, 0, 0);
    const parsedTo = toDate ? new Date(toDate) : new Date();

    const request = pool.request();
    request.input('fromDate', sql.Date, parsedFrom);
    request.input('toDate', sql.Date, parsedTo);

    const result = await request.query(`
      DECLARE @sgtStart DATETIME = CAST(@fromDate AS DATETIME);
      DECLARE @sgtEnd   DATETIME = DATEADD(DAY, 1, CAST(@toDate AS DATETIME));

      -- Live Entertainment sales (same query as Item Sales Report)
      WITH AppSales AS (
        SELECT
          ISNULL(
            (SELECT TOP 1 LTRIM(RTRIM(target_a.CustomerName))
             FROM dishOrderItemShare target_a
             WHERE LTRIM(RTRIM(sid.DishName)) = LTRIM(RTRIM(target_a.CustomerName))
                OR sid.DishName LIKE '%' + LTRIM(RTRIM(target_a.CustomerName)) + '%'),
            ISNULL(d.Name, 'Unknown')
          ) AS ArtistName,
          SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED'
                   THEN CAST(CASE WHEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) - (CASE WHEN sid.DiscountType = 'percentage' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) * (ISNULL(sid.DiscountAmount, 0) / 100.0) ELSE ISNULL(sid.Qty, 0) * (CASE WHEN ISNULL(sid.DiscountAmount, 0) > ISNULL(sid.Price, 0) THEN ISNULL(sid.Price, 0) ELSE ISNULL(sid.DiscountAmount, 0) END) END) - ISNULL(sid.VIPDiscountAmount, 0) < 0 THEN 0 ELSE (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) - (CASE WHEN sid.DiscountType = 'percentage' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) * (ISNULL(sid.DiscountAmount, 0) / 100.0) ELSE ISNULL(sid.Qty, 0) * (CASE WHEN ISNULL(sid.DiscountAmount, 0) > ISNULL(sid.Price, 0) THEN ISNULL(sid.Price, 0) ELSE ISNULL(sid.DiscountAmount, 0) END) END) - ISNULL(sid.VIPDiscountAmount, 0) END AS decimal(18,2))
                   ELSE 0 END) AS totalAmount
        FROM SettlementHeader sh
        INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
        LEFT JOIN DishMaster d ON sid.DishId = d.DishId
        WHERE sh.LastSettlementDate >= @sgtStart
          AND sh.LastSettlementDate <  @sgtEnd
          AND ISNULL(sh.OrderType, '') <> 'CASHBOX'
          AND ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), 'Unmapped') = 'Entertainment'
        GROUP BY 
          ISNULL(
            (SELECT TOP 1 LTRIM(RTRIM(target_a.CustomerName))
             FROM dishOrderItemShare target_a
             WHERE LTRIM(RTRIM(sid.DishName)) = LTRIM(RTRIM(target_a.CustomerName))
                OR sid.DishName LIKE '%' + LTRIM(RTRIM(target_a.CustomerName)) + '%'),
            ISNULL(d.Name, 'Unknown')
          )
      ),
      ProfSales AS (
        SELECT
          ISNULL(
            (SELECT TOP 1 LTRIM(RTRIM(target_b.CustomerName))
             FROM dishOrderItemShare target_b
             WHERE LTRIM(RTRIM(d.Name)) = LTRIM(RTRIM(target_b.CustomerName))
                OR d.Name LIKE '%' + LTRIM(RTRIM(target_b.CustomerName)) + '%'),
            ISNULL(d.Name, 'Unknown')
          ) AS ArtistName,
          SUM(CASE WHEN rod.StatusCode <> 0
                   THEN CAST(ISNULL(rod.TotalDetailLineAmount, 0) AS decimal(18,2))
                   ELSE 0 END) AS totalAmount
        FROM RestaurantOrderDetail rod
        INNER JOIN RestaurantOrder ro ON rod.OrderId = ro.OrderId
        LEFT JOIN DishMaster d ON rod.DishId = d.DishId
        LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
        LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
        WHERE ro.OrderDateTime >= @sgtStart
          AND ro.OrderDateTime <  @sgtEnd
          AND ISNULL(ro.StatusCode, 0) = 3
          AND ISNULL(cm.CategoryName, 'Unmapped') = 'Entertainment'
          AND NOT EXISTS (
            SELECT 1 FROM SettlementHeader sh_dup WHERE sh_dup.BillNo = ro.OrderNumber
          )
        GROUP BY 
          ISNULL(
            (SELECT TOP 1 LTRIM(RTRIM(target_b.CustomerName))
             FROM dishOrderItemShare target_b
             WHERE LTRIM(RTRIM(d.Name)) = LTRIM(RTRIM(target_b.CustomerName))
                OR d.Name LIKE '%' + LTRIM(RTRIM(target_b.CustomerName)) + '%'),
            ISNULL(d.Name, 'Unknown')
          )
      ),
      CashBoxSales AS (
        SELECT
          LTRIM(RTRIM(ArtistName)) AS ArtistName,
          SUM(Amount) AS totalAmount
        FROM ArtistCashBox
        WHERE CAST(CreatedDate AS DATE) >= @fromDate
          AND CAST(CreatedDate AS DATE) <= @toDate
        GROUP BY LTRIM(RTRIM(ArtistName))
      ),
      CombinedSales AS (
        SELECT ArtistName, SUM(totalAmount) AS ActualSales
        FROM (
          SELECT ArtistName, totalAmount FROM AppSales
          UNION ALL
          SELECT ArtistName, totalAmount FROM ProfSales
          UNION ALL
          SELECT ArtistName, totalAmount FROM CashBoxSales
        ) t
        GROUP BY ArtistName
      ),
      -- Latest TargetAmount per artist name from dishOrderItemShare
      LatestTargets AS (
        SELECT
          CustomerName,
          MAX(TargetAmount) AS TargetAmount
        FROM dishOrderItemShare
        WHERE TargetAmount > 0
        GROUP BY CustomerName
      )
      SELECT
        s.ArtistName,
        ISNULL(s.ActualSales, 0)       AS ActualSales,
        ISNULL(lt.TargetAmount, 0)     AS TargetAmount
      FROM CombinedSales s
      LEFT JOIN LatestTargets lt ON lt.CustomerName = s.ArtistName
      WHERE s.ActualSales > 0
      ORDER BY s.ActualSales DESC;
    `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Artist Target Live Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST to save/upsert artist target in dishOrderItemShare
router.post('/artist-target', authenticateToken, async (req, res) => {
  try {
    const { dishId, artistName, targetAmount, fromDate, toDate } = req.body;
    if (!dishId || targetAmount === undefined || !fromDate || !toDate) {
      return res.status(400).json({ error: 'dishId, targetAmount, fromDate, and toDate are required' });
    }

    const pool = getPool();
    const parsedFrom = new Date(fromDate);
    const parsedTo = new Date(toDate);
    
    // Check if target already exists for this dishId and exact date range
    const checkResult = await pool.request()
      .input('dishId', sql.UniqueIdentifier, dishId)
      .input('fromDate', sql.Date, parsedFrom)
      .input('toDate', sql.Date, parsedTo)
      .query(`
        SELECT Id FROM dishOrderItemShare 
        WHERE DishId = @dishId 
          AND CAST(FromDate as DATE) = @fromDate 
          AND CAST(ToDate as DATE) = @toDate
      `);

    if (checkResult.recordset.length > 0) {
      // Update TargetAmount on existing record
      await pool.request()
        .input('dishId', sql.UniqueIdentifier, dishId)
        .input('fromDate', sql.Date, parsedFrom)
        .input('toDate', sql.Date, parsedTo)
        .input('targetAmount', sql.Decimal(18, 2), targetAmount)
        .query(`
          UPDATE dishOrderItemShare 
          SET TargetAmount = @targetAmount 
          WHERE DishId = @dishId 
            AND CAST(FromDate as DATE) = @fromDate 
            AND CAST(ToDate as DATE) = @toDate
        `);
    } else {
      // Insert new record with TargetAmount set
      const crypto = require('crypto');
      const newId = crypto.randomUUID();
      await pool.request()
        .input('id', sql.UniqueIdentifier, newId)
        .input('artistName', sql.VarChar(255), artistName)
        .input('fromDate', sql.Date, parsedFrom)
        .input('toDate', sql.Date, parsedTo)
        .input('dishId', sql.UniqueIdentifier, dishId)
        .input('targetAmount', sql.Decimal(18, 2), targetAmount)
        .query(`
          INSERT INTO dishOrderItemShare (Id, CustomerName, IsSelected, CreatedDate, Amount, FromDate, ToDate, DishId, OrderDishId, TargetAmount)
          VALUES (@id, @artistName, 1, GETDATE(), 0, @fromDate, @toDate, @dishId, NULL, @targetAmount)
        `);
    }

    res.json({ success: true, message: 'Target saved successfully' });
  } catch (err) {
    console.error('Error saving artist target:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
