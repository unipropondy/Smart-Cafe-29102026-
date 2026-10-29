// DEMO_2026_PONDY/backend/services/payment.service.js

const sql = require("mssql");
const config = require('../config');
const YeahPayService = require('./yeahpay.service');

const toGuidOrNull = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (guidRegex.test(str)) {
    return str;
  }
  return null;
};

async function processSplitPayments({
  referenceType,
  referenceId,
  payments,
  transaction,
  businessUnitId = null,
  cashierId = null,
  orderId = null,
  now = new Date(),
  receiptCount = 0,
  startDate = undefined   // Optional override: pass original start_date so Settlement screen stays correct after change-payment
}) {
  if (!payments || !Array.isArray(payments) || payments.length === 0) {
    throw new Error("Payments array is required and cannot be empty.");
  }

  // 1️⃣ Fetch paymode config
  const paymodeRequest = new sql.Request(transaction);
  const paymodesRes = await paymodeRequest.query(`
    SELECT 
      Position, 
      PayMode, 
      Description,
      DeviceSN,
      DeviceSalt,
      YeahPayEnabled,
      Active
    FROM [dbo].[Paymode] 
    WHERE Active = 1
  `);
  const activePaymodes = paymodesRes.recordset;

  // 2️⃣ Process each payment
  for (const payment of payments) {
    const amount = parseFloat(payment.amount);
    if (isNaN(amount) || amount <= 0) {
      throw new Error("Payment amount must be greater than zero.");
    }

    // Resolve paymode
    let dbPaymode = activePaymodes.find(pm => 
      pm.Position === Number(payment.payModeId) || 
      String(pm.PayMode).trim().toUpperCase() === String(payment.payModeId || payment.payMode || "").trim().toUpperCase() ||
      (pm.Description && String(pm.Description).trim().toUpperCase() === String(payment.payModeId || payment.payMode || "").trim().toUpperCase())
    );

    if (!dbPaymode) {
      throw new Error(`Invalid or inactive payment mode specified: ${payment.payModeId || payment.payMode}`);
    }

    const payModeId = dbPaymode.Position;
    const payModeName = ((dbPaymode.Description && dbPaymode.Description.trim()) || dbPaymode.PayMode).trim();
    const referenceNo = payment.referenceNo || payment.referenceNumber || null;

    // ============================================================
    // 🆕 CHECK: Is YeahPay enabled?
    // ============================================================
    let gatewayResponse = null;
    let gatewayReferenceNo = null;
    let isYeahPay = false;

    // ✅✅✅ CRITICAL CHECK - YeahPay Enabled?
    // Skip terminal call if payment was already processed via /api/yeahpay/* endpoint
    const _terminalAlreadyDone = payment.isTerminalAlreadyProcessed === true;
    if (dbPaymode.YeahPayEnabled && dbPaymode.DeviceSN && !_terminalAlreadyDone) {
      
      isYeahPay = true;
      console.log(`🔄 [YEAHPAY] 🔥🔥🔥 YeahPay ENABLED for ${payModeName}`);
      console.log(`🔄 [YEAHPAY] DeviceSN: ${dbPaymode.DeviceSN}`);
      console.log(`🔄 [YEAHPAY] Amount: ${amount}`);
      console.log(`🔄 [YEAHPAY] ReferenceId: ${referenceId}`);
      
      // ✅ Validate DeviceSalt
      if (!dbPaymode.DeviceSalt) {
        throw new Error(`DeviceSalt not configured for ${payModeName}`);
      }

      // ✅ CREATE YEAHPAY SERVICE
      const yeahpay = new YeahPayService({
        appId: config.appId,
        deviceSn: dbPaymode.DeviceSN,
        secret: dbPaymode.DeviceSalt,
        syncApiUrl: config.syncApiUrl,
        asyncApiUrl: config.asyncApiUrl,
        serverPublicKeyPem: config.serverPublicKeyPem,
        clientPrivateKeyPem: config.clientPrivateKeyPem
      });

      // ── Determine YeahPay action using EXACT mode name ──────────────────────
      // Use exact normalized comparisons — never .includes() — so "Yeahpay Paynow"
      // and "Yeahpay Card" never bleed into each other's API call.
      const _pmNorm = payModeName.trim().toUpperCase();
      const _isYeahPayPayNow = _pmNorm === 'YEAHPAY PAYNOW';
      const _isYeahPayCard   = _pmNorm === 'YEAHPAY CARD';

      // ✅ DETERMINE ACTION
      let action;
      if (_isYeahPayPayNow) {
        action = 'TRADE.QRCODE.PayNowPay';
        console.log(`🔄 [YEAHPAY] Action: PayNow Payment`);
      } else if (_isYeahPayCard) {
        action = 'TRADE.CARD.CONSUME';
        console.log(`🔄 [YEAHPAY] Action: Card Payment`);
      } else {
        throw new Error(`YeahPay not supported for payment mode: ${payModeName}`);
      }

      // ✅✅✅ CALL YEAHPAY API
      try {
        console.log(`🔄 [YEAHPAY] 🚀🚀🚀 Calling YeahPay API...`);
        console.log(`🔄 [YEAHPAY] Action: ${action}`);
        console.log(`🔄 [YEAHPAY] Amount: ${amount}`);
        console.log(`🔄 [YEAHPAY] bizOrderId: ${referenceId}`);

        if (_isYeahPayPayNow) {
            gatewayResponse = await yeahpay.processPayNowPayment({
                amount: amount,
                deviceSn: dbPaymode.DeviceSN,
                salt: dbPaymode.DeviceSalt,
                appId: config.appId
            });
        } else if (_isYeahPayCard) {
            gatewayResponse = await yeahpay.processCardPayment({
                amount: amount,
                deviceSn: dbPaymode.DeviceSN,
                salt: dbPaymode.DeviceSalt,
                appId: config.appId
            });
        }

        console.log(`✅ [YEAHPAY] Response received:`, JSON.stringify(gatewayResponse));

        // ✅ Extract reference number
        if (gatewayResponse.data?.tradeCardResponse?.referenceNo) {
          gatewayReferenceNo = gatewayResponse.data.tradeCardResponse.referenceNo;
        } else if (gatewayResponse.data?.tradeScanPaymentResponse?.orderId) {
          gatewayReferenceNo = gatewayResponse.data.tradeScanPaymentResponse.orderId;
        }

        // ✅ Log to PaymentGatewayTransactions
        await logGatewayTransaction({
          settlementId: referenceType === 'BILL' ? referenceId : null,
          memberId: referenceType === 'MEMBER' ? referenceId : null,
          payModeId,
          deviceSn: dbPaymode.DeviceSN,
          requestPayload: JSON.stringify({ action, amount, bizOrderId: referenceId }),
          responsePayload: JSON.stringify(gatewayResponse),
          responseCode: gatewayResponse.responseCode || gatewayResponse.code,
          responseMsg: gatewayResponse.error || gatewayResponse.data?.msg,
          status: gatewayResponse.success ? 'SUCCESS' : 'FAILED'
        }, transaction);

        // ❌ If gateway fails
        // After getting gatewayResponse:

if (!gatewayResponse.success) {
    const errorCode = gatewayResponse.code || gatewayResponse.responseCode;
    const errorMsg = gatewayResponse.msg || gatewayResponse.error || 'Payment declined';
    
    // ✅ Handle cancellation separately
    if (errorCode === -1027) {
        console.log(`ℹ️ [YEAHPAY] Transaction cancelled by user on terminal`);
        throw new Error('Transaction cancelled on terminal. Please try again.');
    }
    
    // ✅ Handle timeout
    if (errorCode === -1028 || errorCode === -1008 || errorCode === 50003) {
        console.log(`⏰ [YEAHPAY] Transaction timeout`);
        throw new Error('Transaction timed out. Please check terminal connection.');
    }
    
    // ✅ Handle other errors
    console.error(`❌ [YEAHPAY] Failed: ${errorMsg} (${errorCode})`);
    throw new Error(errorMsg || 'Payment gateway declined transaction');
}

        console.log(`✅ [YEAHPAY] 🎉🎉🎉 SUCCESS! Reference: ${gatewayReferenceNo}`);

      } catch (apiError) {
        console.error(`❌ [YEAHPAY] API Error:`, apiError.message);
        console.error(`❌ [YEAHPAY] Full Error:`, apiError);

        await logGatewayTransaction({
          settlementId: referenceType === 'BILL' ? referenceId : null,
          memberId: referenceType === 'MEMBER' ? referenceId : null,
          payModeId,
          deviceSn: dbPaymode.DeviceSN,
          requestPayload: JSON.stringify({ action, amount, bizOrderId: referenceId }),
          responsePayload: JSON.stringify({ error: apiError.message }),
          responseCode: -1,
          responseMsg: apiError.message,
          status: 'FAILED'
        }, transaction);

        throw apiError;
      }
      if (_terminalAlreadyDone) {
        console.log(`✅ [YEAHPAY] Terminal already processed for ${payModeName} — skipping duplicate API call, saving to DB only.`);
      } else {
        console.log(`ℹ️ [YEAHPAY] NOT enabled for ${payModeName}`);
        console.log(`   YeahPayEnabled: ${dbPaymode.YeahPayEnabled}`);
        console.log(`   DeviceSN: ${dbPaymode.DeviceSN || 'NULL'}`);
      }
    }

    // ============================================================
    // 🆕 CHECK: Is NETS payment mode?
    // ============================================================
    const _pmUpper = payModeName.trim().toUpperCase();
    const isNetsMode = _pmUpper === 'NETS' || _pmUpper === 'NETS CARD' || _pmUpper === 'NETS QR';

    if (isNetsMode) {
      if (_terminalAlreadyDone) {
        console.log(`✅ [NETS] Terminal already processed for ${payModeName} (ref: ${payment.referenceNo || payment.stan || ''}) — saving to DB.`);
        gatewayReferenceNo = payment.referenceNo || payment.approvalCode || payment.stan || null;
      } else {
        console.log(`🔄 [NETS] Invoking NETS ECR II terminal for ${payModeName}...`);
        const { defaultNetsService } = require('./nets/netsService');
        const isQr = _pmUpper === 'NETS QR';
        const netsRes = await defaultNetsService.processPurchase({
          amount,
          isQrOnTerminal: isQr,
          ecrRef: referenceId,
          lockKey: `ref_${referenceId}`
        });

        if (!netsRes.success || !netsRes.isApproved) {
          throw new Error(`NETS payment declined: ${netsRes.message || netsRes.responseDesc || 'Declined by terminal/host'}`);
        }

        gatewayReferenceNo = netsRes.approvalCode || netsRes.stan || netsRes.rrn || null;
        gatewayResponse = netsRes;
      }
    }

    // ============================================================
    // 3️⃣ ALWAYS save to PaymentTransactionDetails (including start_date)
    // ============================================================
    let ptdStartDate;
    if (startDate !== undefined) {
      ptdStartDate = startDate;
    } else {
      ptdStartDate = null;
      const activeDayRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
      if (activeDayRes.recordset.length > 0) {
        ptdStartDate = activeDayRes.recordset[0].StartDate;
      }
    }

    const detailReq = new sql.Request(transaction);
    detailReq
      .input("ReferenceType", sql.NVarChar(50), referenceType)
      .input("ReferenceId", sql.UniqueIdentifier, toGuidOrNull(referenceId))
      .input("PayModeId", sql.Int, payModeId)
      .input("Amount", sql.Decimal(18, 2), amount)
      .input("ReferenceNo", sql.NVarChar(100), gatewayReferenceNo || referenceNo)
      .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(cashierId))
      .input("startDate", sql.Date, ptdStartDate);

    await detailReq.query(`
      INSERT INTO [dbo].[PaymentTransactionDetails] (
        PaymentTransactionId, ReferenceType, ReferenceId, PayModeId, Amount, 
        ReferenceNo, CreatedDate, CreatedBy, start_date
      ) VALUES (
        NEWID(), @ReferenceType, @ReferenceId, @PayModeId, @Amount, 
        @ReferenceNo, GETDATE(), @CreatedBy, @startDate
      )
    `);

    // ============================================================
    // 🆕 AUTO CASH IN ENTRY FOR CASH PAYMENTS
    // ============================================================
    const isCashMode = payModeName.toUpperCase().trim() === 'CASH';
    if (isCashMode) {
      // Use caller-supplied startDate override; fall back to DateEntry lookup
      let cashStartDate;
      if (startDate !== undefined) {
        cashStartDate = startDate;
      } else {
        cashStartDate = null;
        const activeDayRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
        if (activeDayRes.recordset.length > 0) {
          cashStartDate = activeDayRes.recordset[0].StartDate;
        }
      }

      let cashierName = 'Admin';
      if (cashierId && cashierId !== '00000000-0000-0000-0000-000000000000') {
        const userRes = await transaction.request()
          .input("UserId", sql.UniqueIdentifier, cashierId)
          .query("SELECT TOP 1 UserName FROM UserMaster WHERE UserId = @UserId");
        if (userRes.recordset.length > 0) {
          cashierName = userRes.recordset[0].UserName;
        }
      }

      let terminalCode = '';
      if (referenceType === 'BILL') {
        const termRes = await transaction.request()
          .input("SettlementID", sql.UniqueIdentifier, referenceId)
          .query("SELECT TOP 1 TerminalCode FROM SettlementHeader WHERE SettlementID = @SettlementID");
        terminalCode = termRes.recordset[0]?.TerminalCode || '';
      }

      const dateStr = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' }).replace(/-/g, '');
      const randId = Math.floor(1000 + Math.random() * 9000);
      const cashInNo = `CI-${dateStr}-${randId}`;

      const cashInReq = new sql.Request(transaction);
      await cashInReq
        .input('CashInNo', sql.VarChar, cashInNo)
        .input('Amount', sql.Decimal(18, 2), amount)
        .input('Reason', sql.VarChar, referenceType === 'MEMBER' ? 'Ledger Payment' : 'Cash In')
        .input('Remarks', sql.VarChar, `Auto Cash In from ${referenceType}: ${referenceId}`)
        .input('PaymentMode', sql.VarChar, 'Cash')
        .input('ReferenceNo', sql.VarChar, String(referenceId))
        .input('TerminalCode', sql.VarChar, terminalCode)
        .input('CreatedBy', sql.VarChar, cashierName)
        .input('startDate', sql.Date, cashStartDate)
        .query(`
          INSERT INTO CashInEntry (CashInNo, CashInDate, Amount, Reason, Remarks, PaymentMode, ReferenceNo, TerminalCode, CreatedBy, CreatedOn, start_date)
          VALUES (@CashInNo, GETDATE(), @Amount, @Reason, @Remarks, @PaymentMode, @ReferenceNo, @TerminalCode, @CreatedBy, GETDATE(), @startDate)
        `);
    }

    // ============================================================
    // 4️⃣ If BILL, write to legacy tables
    // ============================================================
    if (referenceType === 'BILL') {
      // Use caller-supplied startDate if provided (e.g. change-payment preserves the original payment date);
      // otherwise fall back to the active business day from DateEntry.
      let resolvedStartDate;
      if (startDate !== undefined) {
        // Caller explicitly passed a date (or null) — honour it
        resolvedStartDate = startDate;
      } else {
        // No override: fetch from active business day
        resolvedStartDate = null;
        const activeDayRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
        if (activeDayRes.recordset.length > 0) {
          resolvedStartDate = activeDayRes.recordset[0].StartDate;
        }
      }

      const legacyReq = new sql.Request(transaction);

      await legacyReq
        .input("RestaurantBillId", sql.UniqueIdentifier, toGuidOrNull(referenceId))
        .input("PaymentOrderId", sql.UniqueIdentifier, toGuidOrNull(orderId))
        .input("BilledFor", sql.Int, 1)
        .input("PaymentType", sql.Int, 1)
        .input("Paymode", sql.Int, payModeId)
        .input("Amount", sql.Decimal(18, 2), amount)
        .input("ReferenceNo", sql.VarChar(100), gatewayReferenceNo || referenceNo)
        .input("Remarks", sql.VarChar(500), payModeName + (gatewayResponse ? ' (Gateway)' : ''))
        .input("BusinessUnitId", sql.UniqueIdentifier, toGuidOrNull(businessUnitId))
        .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(cashierId))
        .input("startDate", sql.Date, resolvedStartDate)
        .query(`
          DECLARE @PayId UNIQUEIDENTIFIER = NEWID();

          INSERT INTO [dbo].[PaymentDetailCur] (
            PaymentId, RestaurantBillId, BilledFor, PaymentCollectedOn,
            PaymentType, Paymode, Amount, ReferenceNumber, Remarks,
            BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, start_date
          ) VALUES (
            @PayId, @RestaurantBillId, @BilledFor, GETDATE(),
            @PaymentType, @Paymode, @Amount, @ReferenceNo, @Remarks,
            @BusinessUnitId, @CreatedBy, GETDATE(), @CreatedBy, GETDATE(), @startDate
          );

          INSERT INTO [dbo].[PaymentDetail] (
            PaymentId, RestaurantBillId, SettlementId, InvoiceId, OrderId,
            BilledFor, PaymentCollectedOn, PaymentType, Paymode, Amount,
            ReferenceNumber, Remarks, BusinessUnitId,
            CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, isSettlement, start_date
          ) VALUES (
            @PayId, @RestaurantBillId, @RestaurantBillId, @RestaurantBillId, @PaymentOrderId,
            @BilledFor, GETDATE(), @PaymentType, @Paymode, @Amount,
            @ReferenceNo, @Remarks, @BusinessUnitId,
            @CreatedBy, GETDATE(), @CreatedBy, GETDATE(), 1, @startDate
          );
        `);

      // ============================================================
      // 5️⃣ Update Settlement tables
      // ============================================================
      const settReq = new sql.Request(transaction);
      settReq
        .input("SettlementID", sql.UniqueIdentifier, referenceId)
        .input("PayMode", sql.VarChar(50), payModeName)
        .input("SysAmount", sql.Money, amount)
        .input("ManualAmount", sql.Money, amount)
        .input("AmountDiff", sql.Money, 0)
        .input("ReceiptCount", sql.Numeric(18, 0), receiptCount)
        .input("GatewayReference", sql.NVarChar(100), gatewayReferenceNo);

      let settlementSql = `
        INSERT INTO SettlementTotalSales (
          SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff, ReceiptCount, GatewayReference
        ) VALUES (
          @SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff, @ReceiptCount, @GatewayReference
        );

        INSERT INTO [dbo].[SettlementDetail] (
          SettlementId, Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount, IsCollected
        ) VALUES (
          @SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff, @ReceiptCount, 0
        );

        INSERT INTO SettlementTranDetail (
          SettlementID, PayMode, CashIn, CashOut
        ) VALUES (
          @SettlementID, @PayMode, @SysAmount, 0
        );
      `;

      if (payModeName.toUpperCase().trim() === 'CREDIT' || payModeName.toUpperCase().trim() === 'MEMBER') {
        settlementSql += `
          INSERT INTO SettlementCreditSales (
            SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff
          ) VALUES (
            @SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff
          );
        `;
      }

      await settReq.query(settlementSql);
    }
  }
}

// ============================================================
// LOG GATEWAY TRANSACTION
// ============================================================
async function logGatewayTransaction(data, transaction) {
  const request = new sql.Request(transaction);
  await request
    .input('SettlementId', sql.UniqueIdentifier, toGuidOrNull(data.settlementId))
    .input('MemberId', sql.UniqueIdentifier, toGuidOrNull(data.memberId))
    .input('PayModeId', sql.Int, data.payModeId)
    .input('DeviceSN', sql.NVarChar(100), data.deviceSn)
    .input('RequestPayload', sql.NVarChar(sql.MAX), data.requestPayload || '')
    .input('ResponsePayload', sql.NVarChar(sql.MAX), data.responsePayload || '')
    .input('ResponseCode', sql.Int, data.responseCode)
    .input('ResponseMsg', sql.NVarChar(500), data.responseMsg || '')
    .input('Status', sql.NVarChar(20), data.status)
    .query(`
      INSERT INTO PaymentGatewayTransactions (
        SettlementId, MemberId, PayModeId, DeviceSN,
        RequestPayload, ResponsePayload, ResponseCode, ResponseMsg, Status,
        RequestTime, ResponseTime
      ) VALUES (
        @SettlementId, @MemberId, @PayModeId, @DeviceSN,
        @RequestPayload, @ResponsePayload, @ResponseCode, @ResponseMsg, @Status,
        GETDATE(), GETDATE()
      )
    `);
}

module.exports = {
  processSplitPayments
};