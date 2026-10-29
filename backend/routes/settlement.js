const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../config/db");

// ===== TOTAL SALES =====
router.get("/total-sales/:terminal", async (req, res) => {
  try {
    const { fromDate, toDate, userId } = req.query;
    const pool = await poolPromise;
    const request = pool.request();

    let dateFilter = "CAST(COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE), CAST(sh.CreatedOn AS DATE)) AS DATE) = CAST(GETDATE() AS DATE)";

    if (fromDate && toDate) {
      const fDate = fromDate.replace(/[^0-9T:.-]/g, '');
      const tDate = toDate.replace(/[^0-9T:.-]/g, '');
      dateFilter = `CAST(COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE), CAST(sh.CreatedOn AS DATE)) AS DATE) BETWEEN CAST('${fDate}' AS DATE) AND CAST('${tDate}' AS DATE)`;
    }

    let userFilter = "";
    if (userId && userId !== "ALL" && userId !== "0") {
      request.input("UserId", sql.VarChar, userId);
      userFilter = `AND (
        TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = @UserId 
        OR CAST(sh.CashierId AS NVARCHAR(50)) = @UserId
        OR LOWER(LTRIM(RTRIM(sh.CashierId))) = LOWER(LTRIM(RTRIM(@UserId)))
      )`;
    }

    const result = await request.query(`
      SELECT
        ISNULL(SUM(sh.SubTotal),0) AS SubTotal,
        ISNULL(SUM(sh.DiscountAmount),0) AS DiscountAmount,
        ISNULL(SUM(sh.ServiceCharge),0) AS ServiceCharge,
        ISNULL(SUM(sh.TakeawayCharge),0) AS TakeawayCharge,
        ISNULL(SUM(sh.TotalTax),0) AS TotalTax,
        ISNULL(SUM(sh.RoundedBy),0) AS RoundedBy,
        COUNT(sh.SettlementID) AS InvoiceCount,
        ISNULL(SUM(sh.SysAmount),0) AS NetTotal
      FROM SettlementHeader sh
      WHERE (sh.IsCancelled = 0 OR sh.IsCancelled IS NULL)
        AND ${dateFilter}
        ${userFilter}
    `);
    const data = result.recordset[0] || {};
    res.json(data);
  } catch (err) {
    console.error("❌ TOTAL SALES ERROR:", err);
    res.status(500).send(err.message);
  }
});

// ===== PAYMENT DETAILS =====
router.get("/payment/:terminal/:userId", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const { terminal, userId } = req.params;
    const pool = await poolPromise;
    const request = pool.request();

    request.input("TerminalCode", sql.VarChar, terminal);
    // Build the date filter expressions for each data source
    let shDateFilter     = "CAST(COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE), CAST(sh.CreatedOn AS DATE)) AS DATE) = CAST(GETDATE() AS DATE)";
    let cctBizDateFilter = "CAST(COALESCE(start_date, CreatedDate) AS DATE) = CAST(GETDATE() AS DATE)";
    let ptdDateFilter    = "COALESCE(ptd.start_date, CAST(ptd.CreatedDate AS DATE)) = CAST(GETDATE() AS DATE)";
    let pdcDateFilter    = "COALESCE(pdc.start_date, CAST(pdc.CreatedOn AS DATE)) = CAST(GETDATE() AS DATE)";

    if (fromDate && toDate) {
      const fDate = fromDate.replace(/[^0-9T:.-]/g, '');
      const tDate = toDate.replace(/[^0-9T:.-]/g, '');
      shDateFilter     = `CAST(COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE), CAST(sh.CreatedOn AS DATE)) AS DATE) BETWEEN CAST('${fDate}' AS DATE) AND CAST('${tDate}' AS DATE)`;
      cctBizDateFilter = `CAST(COALESCE(start_date, CreatedDate) AS DATE) BETWEEN CAST('${fDate}' AS DATE) AND CAST('${tDate}' AS DATE)`;
      ptdDateFilter    = `COALESCE(ptd.start_date, CAST(ptd.CreatedDate AS DATE)) BETWEEN CAST('${fDate}' AS DATE) AND CAST('${tDate}' AS DATE)`;
      pdcDateFilter    = `COALESCE(pdc.start_date, CAST(pdc.CreatedOn AS DATE)) BETWEEN CAST('${fDate}' AS DATE) AND CAST('${tDate}' AS DATE)`;
    }

    let userFilter = "";
    let ptdUserFilter = "";
    let creditUserFilter = "";
    if (userId && userId !== "ALL" && userId !== "0") {
      request.input("UserIdParam", sql.VarChar, userId);
      userFilter = `AND (
        TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = @UserIdParam 
        OR CAST(sh.CashierId AS NVARCHAR(50)) = @UserIdParam
        OR LOWER(LTRIM(RTRIM(sh.CashierId))) = LOWER(LTRIM(RTRIM(@UserIdParam)))
      )`;

      ptdUserFilter = `AND (
        TRY_CAST(ptd.CreatedBy AS UNIQUEIDENTIFIER) = @UserIdParam 
        OR CAST(ptd.CreatedBy AS NVARCHAR(50)) = @UserIdParam
        OR LOWER(LTRIM(RTRIM(ptd.CreatedBy))) = LOWER(LTRIM(RTRIM(@UserIdParam)))
      )`;

      creditUserFilter = `AND (
        TRY_CAST(CreatedBy AS UNIQUEIDENTIFIER) = @UserIdParam 
        OR CAST(CreatedBy AS NVARCHAR(50)) = @UserIdParam
        OR LOWER(LTRIM(RTRIM(CreatedBy))) = LOWER(LTRIM(RTRIM(@UserIdParam)))
      )`;
    }

    // Fetch active bill payments from PaymentTransactionDetails with user filter
    const billsResult = await request.query(`
      -- PRIMARY: PaymentTransactionDetails joined to SettlementHeader for date + Paymode for name
      SELECT
        LTRIM(RTRIM(ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(pm.Description)), ''), pm.PayMode), ''))) AS PaymodeName,
        ISNULL(SUM(ptd.Amount), 0) AS Amount,
        COUNT(*) AS PayCount
      FROM PaymentTransactionDetails ptd
      INNER JOIN SettlementHeader sh ON sh.SettlementID = ptd.ReferenceId
      LEFT  JOIN Paymode pm ON pm.Position = ptd.PayModeId
      WHERE ptd.ReferenceType = 'BILL'
        AND ${shDateFilter}
        AND UPPER(LTRIM(RTRIM(ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(pm.Description)), ''), pm.PayMode), '')))) NOT IN ('CREDIT', 'MEMBER')
        AND ptd.ReferenceId NOT IN (
            SELECT RestaurantBillId FROM RestaurantInvoiceCur
            WHERE StatusCode = 4 AND RestaurantBillId IS NOT NULL
        )
        ${userFilter}
      GROUP BY LTRIM(RTRIM(ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(pm.Description)), ''), pm.PayMode), '')))

      UNION ALL

      -- FALLBACK: PaymentDetailCur for legacy orders that have no PTD row
      SELECT
        LTRIM(RTRIM(ISNULL(pdc.Remarks, ''))) AS PaymodeName,
        ISNULL(SUM(pdc.Amount), 0) AS Amount,
        COUNT(*) AS PayCount
      FROM PaymentDetailCur pdc
      INNER JOIN SettlementHeader sh ON sh.SettlementID = pdc.RestaurantBillId
      WHERE ${pdcDateFilter}
        AND UPPER(LTRIM(RTRIM(ISNULL(pdc.Remarks, '')))) NOT IN ('CREDIT', 'MEMBER')
        AND (pdc.RestaurantBillId IS NULL OR pdc.RestaurantBillId NOT IN (
            SELECT RestaurantBillId FROM RestaurantInvoiceCur
            WHERE StatusCode = 4 AND RestaurantBillId IS NOT NULL
        ))
        -- Exclude any bill that already has a PTD row (to prevent double-counting)
        AND (pdc.RestaurantBillId IS NULL OR pdc.RestaurantBillId NOT IN (
            SELECT DISTINCT ptd2.ReferenceId
            FROM PaymentTransactionDetails ptd2
            WHERE ptd2.ReferenceType = 'BILL'
              AND ${ptdDateFilter.replace(/ptd\./g, 'ptd2.')}
        ))
        ${userFilter}
      GROUP BY LTRIM(RTRIM(ISNULL(pdc.Remarks, '')))
    `);

    // Fetch credit outstanding & issued amounts separately for Credit Activity tracking
    const creditOutstandingResult = await request.query(`
      SELECT
        ISNULL(SUM(OutstandingAmount), 0) AS Amount,
        ISNULL(SUM(BillAmount), 0) AS BilledAmount,
        ISNULL(SUM(PaidAmount), 0) AS PaidAmount,
        COUNT(*) AS PayCount
      FROM CustomerCreditTransactions
      WHERE TransactionType = 'CREDIT_SALE'
        AND ISNULL(CustomerType, 'CREDIT') = 'CREDIT'
        AND ${cctBizDateFilter}
        ${creditUserFilter}
    `);

    // Non-cash credit settlements directly from PaymentTransactionDetails (ReferenceType='MEMBER')
    const ledgerResult = await request.query(`
      SELECT
        pm.PayMode AS PaymodeName,
        ISNULL(SUM(ptd.Amount), 0) AS Amount,
        COUNT(*) AS PayCount
      FROM PaymentTransactionDetails ptd
      INNER JOIN Paymode pm ON ptd.PayModeId = pm.Position
      WHERE ptd.ReferenceType = 'MEMBER'
        AND UPPER(pm.PayMode) NOT LIKE '%CASH%'
        AND ${ptdDateFilter}
        ${ptdUserFilter}
      GROUP BY pm.PayMode
    `);

    // Cash credit settlements: CCT PAYMENT rows with CASH paymentMethod
    const creditCashSettledResult = await request.query(`
      SELECT
        ISNULL(SUM(cct.PaidAmount), 0) AS Amount,
        COUNT(*) AS PayCount
      FROM CustomerCreditTransactions cct
      WHERE cct.TransactionType = 'PAYMENT'
        AND ISNULL(cct.CustomerType, 'CREDIT') = 'CREDIT'
        AND UPPER(LTRIM(RTRIM(cct.PaymentMethod))) LIKE '%CASH%'
        AND ${cctBizDateFilter.replace('start_date', 'cct.start_date')}
        ${creditUserFilter}
    `);

    const normalizePayMode = (paymentMethod = "CASH") => {
      const raw = String(paymentMethod || "CASH").toUpperCase().trim();
      if (raw === "Q-R" || raw === "Q.R.") return "QR";
      if (raw === "PAY_NOW" || raw === "PAY NOW") return "PAYNOW";
      if (raw === "U-P-I") return "UPI";
      if (raw === "G-PAY") return "GPAY";
      if (raw === "P-H-O-N-E") return "PHONE";
      if (raw === "P-A-Y-T-M") return "PAYTM";
      if (raw === "CAS" || raw === "1") return "CASH";
      if (raw === "2") return "NETS";
      if (raw === "3") return "PAYNOW";
      if (raw === "4") return "UPI";
      if (raw === "5") return "MEMBER";
      if (raw === "6") return "CREDIT";
      return raw;
    };

    // Aggregate cash/non-cash movements
    const aggregated = {};
    
    (billsResult.recordset || []).forEach(row => {
      const normName = normalizePayMode(row.PaymodeName);
      if (!aggregated[normName]) {
        aggregated[normName] = { PaymodeName: normName, Amount: 0, PayCount: 0 };
      }
      aggregated[normName].Amount += parseFloat(row.Amount) || 0;
      aggregated[normName].PayCount += parseInt(row.PayCount, 10) || 0;
    });

    (ledgerResult.recordset || []).forEach(row => {
      const normName = normalizePayMode(row.PaymodeName);
      const ledgerName = `Credit Settlement - ${normName}`;
      if (!aggregated[ledgerName]) {
        aggregated[ledgerName] = { PaymodeName: ledgerName, Amount: 0, PayCount: 0 };
      }
      aggregated[ledgerName].Amount += parseFloat(row.Amount) || 0;
      aggregated[ledgerName].PayCount += parseInt(row.PayCount, 10) || 0;
    });

    // Add cash credit settlements
    const cashSettled = creditCashSettledResult.recordset[0] || {};
    const cashSettledAmt = parseFloat(cashSettled.Amount) || 0;
    if (cashSettledAmt > 0) {
      const cashLedgerName = 'Credit Settlement - CASH';
      if (!aggregated[cashLedgerName]) {
        aggregated[cashLedgerName] = { PaymodeName: cashLedgerName, Amount: 0, PayCount: 0 };
      }
      aggregated[cashLedgerName].Amount += cashSettledAmt;
      aggregated[cashLedgerName].PayCount += parseInt(cashSettled.PayCount, 10) || 0;
    }

    // creditOutstandingResult is now a single row (CREDIT-only, no GROUP BY)
    const creditRow = creditOutstandingResult.recordset[0] || {};
    const creditOutstandingData = [{
      PaymodeName: 'CREDIT',
      Amount: parseFloat(creditRow.Amount) || 0,
      BilledAmount: parseFloat(creditRow.BilledAmount) || 0,
      PaidAmount: parseFloat(creditRow.PaidAmount) || 0,
      PayCount: parseInt(creditRow.PayCount, 10) || 0,
    }];

    res.json({
      payments: Object.values(aggregated),
      creditOutstanding: creditOutstandingData
    });

  } catch (err) {
    console.error("❌ PAYMENT ERROR:", err);
    res.status(500).send(err.message);
  }
});


// ===== TRANSACTIONS =====
router.get("/transactions/:terminal/:userId", async (req, res) => {
  try {
    // [TEMP FIX]: Commenting this out because the 'Transactions' table is missing,
    // which was causing the tedious driver to throw a fatal unhandled rejection stream error
    /*
    const pool = await poolPromise;

    const result = await pool.request()
      .input("TerminalCode", sql.VarChar, req.params.terminal)
      .input("UserId", sql.VarChar, req.params.userId)
      .query(`SELECT 
              ISNULL(TransactionMode,'') AS TransactionMode,
              ISNULL(TransactionType,'') AS TransactionType,
              ISNULL(Amount,0) AS Amount
              FROM Transactions
              WHERE TerminalCode = @TerminalCode
         AND UserId = @UserId
      `);

    res.json(result.recordset || []);
    */

    res.json([]);

  } catch (err) {
    console.error("❌ TRANSACTION ERROR:", err);
    res.status(500).send(err.message);
  }
});


// ===== SALES SUMMARY =====
router.get("/sales-summary/:terminal", async (req, res) => {
  try {
    const { fromDate, toDate, userId } = req.query;
    const pool = await poolPromise;
    const request = pool.request();
    request.input("TerminalCode", sql.VarChar, req.params.terminal);

    let dateFilter = "";
    if (fromDate && toDate) {
      const fDate = fromDate.replace(/[^0-9T:.-]/g, '');
      const tDate = toDate.replace(/[^0-9T:.-]/g, '');
      dateFilter = `AND start_date BETWEEN CAST('${fDate}' AS DATE) AND CAST('${tDate}' AS DATE)`;
    }

    let userFilter = "";
    if (userId && userId !== "ALL" && userId !== "0") {
      request.input("UserIdParam", sql.VarChar, userId);
      userFilter = `AND (
        TRY_CAST(CreatedBy AS UNIQUEIDENTIFIER) = @UserIdParam 
        OR CAST(CreatedBy AS NVARCHAR(50)) = @UserIdParam
        OR LOWER(LTRIM(RTRIM(CreatedBy))) = LOWER(LTRIM(RTRIM(@UserIdParam)))
      )`;
    }

    const result = await request.query(`
      SELECT 
        ISNULL(Paymode,'') AS Paymode,
        ISNULL(SUM(Amount),0) AS Amount
      FROM PaymentDetailCur
      WHERE TerminalCode = @TerminalCode
        AND isSettlement = 0
        AND (RestaurantBillId IS NULL OR RestaurantBillId NOT IN (
            SELECT RestaurantBillId 
            FROM RestaurantInvoiceCur 
            WHERE StatusCode = 4 AND RestaurantBillId IS NOT NULL
        ))
        ${dateFilter}
        ${userFilter}
      GROUP BY Paymode 
    `);

    res.json(result.recordset || []);

  } catch (err) {
    console.error("❌ SALES SUMMARY ERROR:", err);
    res.status(500).send(err.message);
  }
});


// ===== CHECK PENDING ORDERS =====
router.get("/pending-orders", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT * FROM RestaurantOrderCur
      WHERE StatusCode < 5
    `);

    res.json({
      hasPending: result.recordset.length > 0,
      data: result.recordset
    });

  } catch (err) {
    console.error("❌ PENDING ERROR:", err);
    res.status(500).send(err.message);
  }
});


// ===== SAVE SETTLEMENT =====
router.post("/settlement", async (req, res) => {
  const { terminal, userId } = req.body;

  try {
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    const request = new sql.Request(transaction);

    // HEADER
    const result = await request
      .input("TerminalCode", sql.VarChar, terminal)
      .input("UserId", sql.VarChar, userId)
      .query(`
        INSERT INTO SettlementHeader (
          SettlementId,
          TerminalCode,
          CreatedBy,
          CreatedOn
        )
        OUTPUT INSERTED.SettlementId
        VALUES (NEWID(), @TerminalCode, @UserId, GETDATE())
      `);

    const settlementId = result.recordset[0].SettlementId;

    // UPDATE ONLY THIS TERMINAL
    await request
      .input("TerminalCode", sql.VarChar, terminal)
      .query(`
        UPDATE PaymentDetailCur
        SET isSettlement = 1
        WHERE isSettlement = 0
        AND TerminalCode = @TerminalCode
      `);

    await transaction.commit();

    // Notify all connected clients to refresh settlement data
    const io = req.app.get('io');
    if (io) io.emit('settlement_updated', { action: 'settlement_saved' });

    res.json({
      message: "Settlement Completed ✅",
      settlementId
    });

  } catch (err) {
    console.error("❌ SETTLEMENT ERROR:", err);
    res.status(500).send(err.message);
  }
});


// ===== LAST SETTLEMENT =====
router.get("/last-settlement/:terminal", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input("TerminalCode", sql.VarChar, req.params.terminal)
      .query(`
        SELECT 
          ISNULL(MAX(CreatedOn), DATEADD(DAY,-1,GETDATE())) AS LastSettlementDate
        FROM SettlementHeader
        WHERE TerminalCode = @TerminalCode
      `);

    res.json(result.recordset[0]);

  } catch (err) {
    console.error("❌ LAST SETTLEMENT ERROR:", err);
    res.status(500).send(err.message);
  }
});


// ===== TERMINAL LIST =====
router.get("/terminals", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT TerminalCode, TerminalName FROM TerminalMaster
    `);

    console.log("🔥 TERMINALS FROM DB 👉", result.recordset);

    res.json(result.recordset);

  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

module.exports = router;
