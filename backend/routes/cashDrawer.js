const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');
const { authenticateToken } = require('../middleware/auth');
const { getActiveOrganization } = require('../utils/organizationHelper');

// POST /api/cash-drawer/log
router.post('/log', authenticateToken, async (req, res) => {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  
  try {
    // Day Start / Day End validation check
    const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    if (activeDayRes.recordset.length === 0) {
      return res.status(400).json({ success: false, error: "No active business date. Please Start Day first." });
    }
    const activeStartDate = activeDayRes.recordset[0].StartDate;
    const formattedStartDate = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : activeStartDate;

    const {
      outletId, terminalCode, actionType, amount, tenderedAmount, changeAmount,
      orderId, reason, remark, openedByUserId, approvedByUserId, openSource, isSuccess
    } = req.body;

    const cashierName = req.user?.userName || req.user?.username || 'Admin';
    const userId = req.user?.id || req.user?.userId || '00000000-0000-0000-0000-000000000000';
    const parsedOutletId = parseInt(outletId) || 1;
    const finalTerminalCode = terminalCode || '';

    // Get dynamic active BusinessUnitId (required column in database schema)
    const org = await getActiveOrganization();
    const businessUnitId = org.businessUnitId;

    await transaction.begin();

    // 0. Backend Validation for Duplicate SALE Logs (3-Layer Protection Layer 2)
    if ((actionType === 'SALE' || openSource === 'SALE') && orderId && String(orderId).trim() !== '') {
      const checkReq = new sql.Request(transaction);
      const dupCheck = await checkReq
        .input('CheckOrderId', sql.NVarChar(100), String(orderId).trim())
        .query(`SELECT COUNT(*) as cnt FROM CashDrawerLog WHERE OrderId = @CheckOrderId AND OpenSource = 'SALE'`);
      
      if (dupCheck.recordset[0].cnt > 0) {
        await transaction.rollback();
        return res.status(400).json({ success: false, error: 'Duplicate SALE drawer log for this OrderId is not allowed.' });
      }
    }

    const request = new sql.Request(transaction);

    // 1. Insert Cash Drawer Log
    await request
      .input('BusinessUnitId', sql.UniqueIdentifier, businessUnitId)
      .input('UserId', sql.UniqueIdentifier, userId)
      .input('OutletId', sql.Int, parsedOutletId)
      .input('TerminalCode', sql.NVarChar(50), finalTerminalCode)
      .input('ActionType', sql.NVarChar(30), actionType || 'OTHER')
      .input('Amount', sql.Decimal(18, 2), amount || 0)
      .input('TenderedAmount', sql.Decimal(18, 2), tenderedAmount || 0)
      .input('ChangeAmount', sql.Decimal(18, 2), changeAmount || 0)
      .input('OrderId', sql.NVarChar(100), orderId || '')
      .input('Reason', sql.NVarChar(100), reason || '')
      .input('Remark', sql.NVarChar(500), remark || '')
      .input('OpenedByUserId', sql.NVarChar(100), openedByUserId || userId)
      .input('ApprovedByUserId', sql.NVarChar(100), approvedByUserId || '')
      .input('OpenSource', sql.NVarChar(20), openSource || 'MANUAL')
      .input('IsSuccess', sql.Bit, isSuccess !== false ? 1 : 0)
      .query(`
        INSERT INTO CashDrawerLog
          (BusinessUnitId, UserId, OutletId, TerminalCode, ActionType, Amount, TenderedAmount, ChangeAmount, OrderId,
           Reason, Remark, OpenedByUserId, ApprovedByUserId, OpenSource, IsSuccess, CreatedOn)
        VALUES
          (@BusinessUnitId, @UserId, @OutletId, @TerminalCode, @ActionType, @Amount, @TenderedAmount, @ChangeAmount, @OrderId,
           @Reason, @Remark, @OpenedByUserId, @ApprovedByUserId, @OpenSource, @IsSuccess, GETDATE())
      `);

    // 2. Settlement Integration — PROFESSIONAL POS DESIGN:
    //    Financial records (CashInEntry/CashOutEntry) are ALWAYS written once a supervisor
    //    approves the action (PIN verified on frontend). This matches industry standards
    //    (MICROS, Square, Toast): the FINANCIAL transaction is the source of truth.
    //    'IsSuccess' in CashDrawerLog tracks HARDWARE trigger only — if the printer is
    //    offline the drawer may not open physically, but the cash movement still happened
    //    and must appear in settlement. Cashier can manually open drawer in that case.
    if (actionType && amount > 0) {
      if (actionType === 'CASH_IN' && amount > 0) {
        // Fetch SGT date directly from remote SQL server clock (myerpcloud.dyndns.org)
        const dateRes = await new sql.Request(transaction).query("SELECT FORMAT(GETDATE(), 'yyyyMMdd') as dateStr");
        const dateStr = dateRes.recordset[0].dateStr;
        const randId = Math.floor(1000 + Math.random() * 9000);
        const cashInNo = `CI-${dateStr}-${randId}`;
 
        const cashInReq = new sql.Request(transaction);
        await cashInReq
          .input('CashInNo', sql.VarChar(50), cashInNo)
          .input('Amount', sql.Decimal(18, 2), amount)
          .input('Reason', sql.VarChar(255), reason || 'Cash Drawer Deposit')
          .input('Remarks', sql.VarChar(sql.MAX), remark || '')
          .input('PaymentMode', sql.VarChar(50), 'Cash')
          .input('ReferenceNo', orderId || '')
          .input('TerminalCode', sql.VarChar(50), finalTerminalCode)
          .input('CreatedBy', sql.VarChar(100), cashierName)
          .input('startDate', sql.Date, formattedStartDate)
          .query(`
            INSERT INTO CashInEntry (CashInNo, CashInDate, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn, start_date)
            VALUES (@CashInNo, CAST(GETDATE() AS DATE), @Amount, @Reason, @Remarks, @PaymentMode, @ReferenceNo, @TerminalCode, @CreatedBy, GETDATE(), @startDate)
          `);
      } else if (actionType === 'CASH_OUT' && amount > 0) {
        // Fetch SGT date directly from remote SQL server clock (myerpcloud.dyndns.org)
        const dateRes = await new sql.Request(transaction).query("SELECT FORMAT(GETDATE(), 'yyyyMMdd') as dateStr");
        const dateStr = dateRes.recordset[0].dateStr;
        const randId = Math.floor(1000 + Math.random() * 9000);
        const cashOutNo = `CO-${dateStr}-${randId}`;

        const cashOutReq = new sql.Request(transaction);
        await cashOutReq
          .input('CashOutNo', sql.VarChar(50), cashOutNo)
          .input('Amount', sql.Decimal(18, 2), amount)
          .input('Reason', sql.VarChar(255), reason || 'Cash Drawer Withdrawal')
          .input('Remarks', sql.VarChar(sql.MAX), remark || '')
          .input('PaymentMode', sql.VarChar(50), 'Cash')
          .input('ReferenceNo', sql.VarChar(100), orderId || '')
          .input('TerminalCode', sql.VarChar(50), finalTerminalCode)
          .input('CreatedBy', sql.VarChar(100), cashierName)
          .input('startDate', sql.Date, formattedStartDate)
          .query(`
            INSERT INTO CashOutEntry (CashOutNo, CashOutDate, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn, start_date)
            VALUES (@CashOutNo, CAST(GETDATE() AS DATE), @Amount, @Reason, @Remarks, @PaymentMode, @ReferenceNo, @TerminalCode, @CreatedBy, GETDATE(), @startDate)
          `);
      } else if (actionType === 'OPENING_FLOAT' && amount > 0) {
        // Update settlement opening totals
        const setReq = new sql.Request(transaction);
        await setReq
          .input('outletId', sql.Int, parsedOutletId)
          .input('openingCashTotal', sql.Decimal(10, 2), amount)
          .input('cashierName', sql.NVarChar(100), cashierName)
          .query(`
            MERGE settlement AS target
            USING (SELECT @outletId as OutletId, CAST(GETDATE() AS DATE) as SettlementDate) AS source
            ON (target.OutletId = source.OutletId AND target.SettlementDate = source.SettlementDate)
            WHEN MATCHED THEN
              UPDATE SET OpeningCashTotal = @openingCashTotal, CashierName = @cashierName, UpdatedAt = GETDATE()
            WHEN NOT MATCHED THEN
              INSERT (OutletId, SettlementDate, CashierName, OpeningCashTotal, CreatedAt)
              VALUES (@outletId, CAST(GETDATE() AS DATE), @cashierName, @openingCashTotal, GETDATE());
          `);

        // Upsert OpeningCashDenomination with Type = 'OPEN'
        const denomReq = new sql.Request(transaction);
        await denomReq
          .input('value', sql.Decimal(18, 2), amount)
          .input('createdBy', sql.VarChar(100), cashierName)
          .input('startDate', sql.Date, formattedStartDate)
          .query(`
            DELETE FROM OpeningCashDenomination 
            WHERE CAST(CreatedOn as DATE) = CAST(GETDATE() as DATE)
            AND Type = 'OPEN'
            AND (ScreenType = 'CB' OR ScreenType IS NULL);

            INSERT INTO OpeningCashDenomination (CurrencyValue, NoteCount, Type, CreatedBy, CreatedOn, ScreenType, start_date)
            VALUES (@value, 1, 'OPEN', @createdBy, GETDATE(), 'CB', @startDate);
          `);
      }
    }

    await transaction.commit();
    res.json({ success: true });
  } catch (err) {
    console.error('Cash drawer log error:', err);
    try { await transaction.rollback(); } catch (e) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/cash-drawer/logs
router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const { fromDate, toDate, actionType, userId, terminalCode } = req.query;
    const pool = getPool();
    const request = pool.request();

    let where = '1=1';

    if (fromDate) {
      request.input('fromDate', sql.VarChar, fromDate);
      where += ' AND l.CreatedOn >= CAST(@fromDate AS DATETIME)';
    }
    if (toDate) {
      request.input('toDate', sql.VarChar, toDate);
      where += ' AND l.CreatedOn <= CAST(@toDate AS DATETIME)';
    }
    if (actionType && actionType !== 'ALL') {
      request.input('actionType', sql.NVarChar(30), actionType);
      where += ' AND l.ActionType = @actionType';
    }
    if (userId && userId !== 'ALL') {
      request.input('userId', sql.NVarChar(100), userId);
      where += ' AND l.OpenedByUserId = @userId';
    }
    if (terminalCode && terminalCode !== 'ALL') {
      request.input('terminalCode', sql.NVarChar(50), terminalCode);
      where += ' AND l.TerminalCode = @terminalCode';
    }

    const result = await request.query(`
      SELECT 
        l.*,
        u1.FullName AS OpenedByName,
        u2.FullName AS ApprovedByName
      FROM CashDrawerLog l
      LEFT JOIN UserMaster u1 ON CAST(l.OpenedByUserId AS NVARCHAR(100)) = CAST(u1.UserId AS NVARCHAR(100))
      LEFT JOIN UserMaster u2 ON CAST(l.ApprovedByUserId AS NVARCHAR(100)) = CAST(u2.UserId AS NVARCHAR(100))
      WHERE ${where}
      ORDER BY l.CreatedOn DESC
    `);

    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Cash drawer logs error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/cash-drawer/reasons
router.get('/reasons', authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(
      `SELECT Description FROM CashDrawerRemarks ORDER BY Description`
    );
    res.json({ success: true, data: result.recordset.map(r => r.Description) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
