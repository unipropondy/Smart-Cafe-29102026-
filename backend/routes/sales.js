const express = require("express");
const router = express.Router();
const { poolPromise } = require("../config/db");
// Public payment-methods endpoint: returns all active paymodes from dbo.Paymode
router.get("/payment-methods", async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT 
          RTRIM(LTRIM(PayMode))       as payMode,
          RTRIM(LTRIM(Description))   as description,
          Position,
          Active        as active,
          DeviceSN,
          DeviceSalt,
          YeahPayEnabled,
          ISNULL(Commission, 0)      as commission,
          ISNULL(ServiceCharge, 0)   as serviceCharge,
          ISNULL(IsEntertainment, 0) as isEntertainment,
          ISNULL(IsVoucher, 0)       as isVoucher
        FROM [dbo].[Paymode] 
        ORDER BY Position ASC
      `);
      res.json(result.recordset || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

const { authenticateToken } = require("../middleware/auth");
router.use(authenticateToken);

router.use(async (req, res, next) => {
  // Pass through query params untouched from client
  next();
});

const sql = require("mssql");
const { runInTransaction } = require("../utils/transactionHelper");
const { getActiveOrganization } = require("../utils/organizationHelper");
const { processSplitPayments } = require("../services/payment.service");
const { getBusinessDaySqlBounds } = require("../utils/timezoneHelper");
const { getBusinessTimezoneSettings, getCompanySettings } = require("../utils/settingsCache");
const { sendBalanceNotification } = require("../utils/whatsappService");
const PaymentService = require('../services/payment.service');

// Helper to generate a random 8-character hex ID (e.g. A996E780)
const generateRandomBillId = () => {
    return Math.random().toString(16).slice(2, 10).toUpperCase();
};

const normalizeReportPayModeSql = (columnName = "sts.PayMode", settlementIdColumn = "sh.SettlementID") => {
  const resolvedPayMode = `COALESCE(NULLIF(LTRIM(RTRIM(${columnName})), ''), (
    SELECT TOP 1 LTRIM(RTRIM(pd2.Remarks))
    FROM (
      SELECT Remarks, RestaurantBillId FROM PaymentDetailCur WHERE Remarks IS NOT NULL AND LTRIM(RTRIM(Remarks)) <> ''
      UNION ALL
      SELECT Remarks, RestaurantBillId FROM PaymentDetail WHERE Remarks IS NOT NULL AND LTRIM(RTRIM(Remarks)) <> ''
    ) pd2
    WHERE pd2.RestaurantBillId = ${settlementIdColumn}
  ))`;

  const rawSql = `
    UPPER(ISNULL(
      (SELECT TOP 1 LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(Description)), ''), PayMode))) 
       FROM Paymode pm 
       WHERE LTRIM(RTRIM(pm.PayMode)) = LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))
          OR LTRIM(RTRIM(pm.Description)) = LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))
          OR CAST(pm.Position AS NVARCHAR(10)) = LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))
      ),
      CASE
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('YEAHPAY PAYNOW', '7') OR UPPER(${resolvedPayMode}) LIKE '%YEAHPAY%PAYNOW%' THEN 'YEAHPAY PAYNOW'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('YEAHPAY CARD', '8') OR UPPER(${resolvedPayMode}) LIKE '%YEAHPAY%CARD%' THEN 'YEAHPAY CARD'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('CAS', 'CASH', '1') THEN 'CASH'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('CARD', 'VISA', 'MASTER', 'MASTERCARD', 'AMEX', 'DINERS') THEN 'CARD'
        WHEN (UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('PAYNOW', '3') OR UPPER(${resolvedPayMode}) LIKE '%PAYNOW%') AND UPPER(${resolvedPayMode}) NOT LIKE '%YEAHPAY%' THEN 'PAYNOW'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('GRAB', '10') OR UPPER(${resolvedPayMode}) LIKE '%GRAB%' THEN 'GRAB'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('FOODPANDA', '9') OR UPPER(${resolvedPayMode}) LIKE '%FOODPANDA%' THEN 'FOODPANDA'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('NETS', '2') OR UPPER(${resolvedPayMode}) LIKE '%NETS%' THEN 'NETS'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('FOC', '4') OR UPPER(${resolvedPayMode}) LIKE '%FOC%' OR UPPER(${resolvedPayMode}) LIKE '%FREE%' THEN 'FOC'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('UPI', 'GPAY', 'PAYTM', 'PHONEPE') OR UPPER(${resolvedPayMode}) LIKE '%UPI%' OR UPPER(${resolvedPayMode}) LIKE '%GPAY%' THEN 'UPI'
        WHEN UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, '')))) IN ('MEMBER', '5') OR UPPER(${resolvedPayMode}) LIKE '%MEMBER%' THEN 'MEMBER'
        ELSE UPPER(LTRIM(RTRIM(ISNULL(${resolvedPayMode}, 'CASH'))))
      END
    ))
  `;

  return rawSql;
};

const getReportDateRange = (req) => {
  const filter = (req.query.filter || "daily").toLowerCase();
  const start = new Date();
  const end = new Date();

  // Default to day boundaries
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (filter === "weekly") {
    start.setDate(start.getDate() - 6);
  } else if (filter === "monthly") {
    start.setDate(1);
    // end maintains today
  } else if (filter === "yearly") {
    start.setFullYear(start.getFullYear() - 1);
    // end maintains today
  }
  // Daily uses today's start/end

  return { start, end };
};

const resolveBusinessDateColumn = (col) => {
  const cleanCol = String(col).trim();
  if (cleanCol.includes("LastSettlementDate")) {
    const prefix = cleanCol.includes(".") ? cleanCol.split(".")[0] + "." : "";
    return `COALESCE(${prefix}start_date, ${prefix}LastSettlementDate)`;
  }
  if (cleanCol.includes("ptd.")) {
    const prefix = cleanCol.includes(".") ? cleanCol.split(".")[0] + "." : "";
    return `COALESCE(${prefix}start_date, ${prefix}CreatedDate)`;
  }
  if (cleanCol.includes("cct.")) {
    const prefix = cleanCol.includes(".") ? cleanCol.split(".")[0] + "." : "";
    return `COALESCE(${prefix}start_date, ${prefix}CreatedDate)`;
  }
  if (cleanCol.includes("InvoiceDate")) {
    const prefix = cleanCol.includes(".") ? cleanCol.split(".")[0] + "." : "";
    return `COALESCE(${prefix}start_date, ${prefix}InvoiceDate)`;
  }
  return cleanCol;
};

const getReportDateWhereSql = (filter = "daily", saleDateColumn = "sh.LastSettlementDate", date = null, startDate = null, endDate = null) => {
  if (startDate && endDate) {
    return getReportDateWhereSqlForRange(startDate, endDate, saleDateColumn);
  }

  const targetDate = date ? `'${date}'` : 'GETDATE()';
  const safeTargetDate = `CAST(CAST(${targetDate} AS DATETIME) AS DATE)`;

  const cleanCol = String(saleDateColumn).trim();
  if (cleanCol.includes("LastSettlementDate")) {
    const prefix = cleanCol.includes(".") ? cleanCol.split(".")[0] + "." : "";
    switch (String(filter).toLowerCase()) {
      case "weekly":
        return `((CAST(${prefix}start_date AS DATE) >= DATEADD(DAY, -6, ${safeTargetDate}) AND CAST(${prefix}start_date AS DATE) <= ${safeTargetDate}) OR (CAST(${prefix}LastSettlementDate AS DATE) >= DATEADD(DAY, -6, ${safeTargetDate}) AND CAST(${prefix}LastSettlementDate AS DATE) <= ${safeTargetDate}))`;
      case "monthly":
        return `((MONTH(CAST(${prefix}start_date AS DATE)) = MONTH(${safeTargetDate}) AND YEAR(CAST(${prefix}start_date AS DATE)) = YEAR(${safeTargetDate})) OR (MONTH(CAST(${prefix}LastSettlementDate AS DATE)) = MONTH(${safeTargetDate}) AND YEAR(CAST(${prefix}LastSettlementDate AS DATE)) = YEAR(${safeTargetDate})))`;
      case "yearly":
        return `((CAST(${prefix}start_date AS DATE) >= DATEADD(YEAR, -1, ${safeTargetDate}) AND CAST(${prefix}start_date AS DATE) <= ${safeTargetDate}) OR (CAST(${prefix}LastSettlementDate AS DATE) >= DATEADD(YEAR, -1, ${safeTargetDate}) AND CAST(${prefix}LastSettlementDate AS DATE) <= ${safeTargetDate}))`;
      case "daily":
      default:
        return `(CAST(${prefix}start_date AS DATE) = ${safeTargetDate} OR CAST(${prefix}LastSettlementDate AS DATE) = ${safeTargetDate})`;
    }
  }

  saleDateColumn = resolveBusinessDateColumn(saleDateColumn);
  switch (String(filter).toLowerCase()) {
    case "weekly":
      return `CAST(${saleDateColumn} AS DATE) >= DATEADD(DAY, -6, ${safeTargetDate}) AND CAST(${saleDateColumn} AS DATE) <= ${safeTargetDate}`;
    case "monthly":
      return `MONTH(CAST(${saleDateColumn} AS DATE)) = MONTH(${safeTargetDate}) AND YEAR(CAST(${saleDateColumn} AS DATE)) = YEAR(${safeTargetDate})`;
    case "yearly":
      return `CAST(${saleDateColumn} AS DATE) >= DATEADD(YEAR, -1, ${safeTargetDate}) AND CAST(${saleDateColumn} AS DATE) <= ${safeTargetDate}`;
    case "daily":
    default:
      return `CAST(${saleDateColumn} AS DATE) = ${safeTargetDate}`;
  }
};

const getReportDateWhereSqlForRange = (startDateStr, endDateStr, saleDateColumn = "sh.LastSettlementDate") => {
  const sgtStart = `CAST('${startDateStr}' AS DATE)`;
  const sgtEnd = `CAST('${endDateStr}' AS DATE)`;
  const cleanCol = String(saleDateColumn).trim();
  if (cleanCol.includes("LastSettlementDate")) {
    const prefix = cleanCol.includes(".") ? cleanCol.split(".")[0] + "." : "";
    return `((CAST(${prefix}start_date AS DATE) >= ${sgtStart} AND CAST(${prefix}start_date AS DATE) <= ${sgtEnd}) OR (CAST(${prefix}LastSettlementDate AS DATE) >= ${sgtStart} AND CAST(${prefix}LastSettlementDate AS DATE) <= ${sgtEnd}))`;
  }
  const resolved = resolveBusinessDateColumn(saleDateColumn);
  return `CAST(${resolved} AS DATE) >= ${sgtStart} AND CAST(${resolved} AS DATE) <= ${sgtEnd}`;
};

const normalizeReportFilter = (filter = "daily") => {
  const normalized = String(filter || "daily").toLowerCase();
  return ["daily", "weekly", "monthly", "yearly"].includes(normalized) ? normalized : "daily";
};

const parseCsv = (value) => String(value || "")
  .split(",")
  .map((v) => v.trim().toUpperCase())
  .filter(Boolean);

const normalizePayMode = (paymentMethod = "CASH") => {
  const raw = String(paymentMethod || "CASH").toUpperCase().trim();

  // ── Exact normalized comparisons only ───────────────────────────────────
  // Broad .includes() checks are order-dependent and fragile: "Yeahpay Card"
  // could fall into the generic CARD bucket if checked out of order.
  // Exact matches are unambiguous regardless of order.

  // Cash
  if (raw === "CASH" || raw === "CAS") return "CASH";

  // YeahPay terminal modes — MUST be exact; never fall through to generic CARD/PAYNOW
  if (raw === "YEAHPAY PAYNOW" || raw.includes("YEAHPAY PAYNOW")) return "YEAHPAY PAYNOW";
  if (raw === "YEAHPAY CARD"   || raw.includes("YEAHPAY CARD"))   return "YEAHPAY CARD";

  // Standard payment modes — exact matches
  if (raw === "CARD" || raw === "VISA" || raw === "MASTER" || raw === "MASTERCARD" || raw === "AMEX" || raw === "DINERS") return "CARD";
  if (raw === "PAYNOW" || raw === "3") return "PAYNOW";
  if (raw === "GRAB"  || raw === "10") return "GRAB";
  if (raw === "FOODPANDA" || raw === "9") return "FOODPANDA";
  if (raw === "UPI"   || raw === "4" || raw === "GPAY" || raw === "PAYTM" || raw.startsWith("PHONE")) return "UPI";
  if (raw === "NETS"  || raw === "2") return "NETS";
  if (raw === "MEMBER" || raw === "5") return "MEMBER";
  if (raw === "CREDIT" || raw === "6") return "CREDIT";
  if (raw === "LEDGER" || raw === "LEDGER CREDIT") return "LEDGER";
  if (raw === "FOC") return "FOC";

  // Unknown mode — pass through as-is so it is stored verbatim in the DB
  return raw;
};

const toGuidOrNull = (value) => {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
};

const DEFAULT_GUID = "00000000-0000-0000-0000-000000000000";

const sanitizeGuid = (value, fallback = DEFAULT_GUID) => {
  return toGuidOrNull(value) || fallback;
};

const resolveCashierUserId = async (poolOrTx, inputCashierId) => {
  try {
    const textVal = String(inputCashierId || "").trim();

    // 1. If valid GUID, check if exists in UserMaster
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(textVal)) {
      const req1 = poolOrTx.request();
      req1.input("GuidVal", sql.UniqueIdentifier, textVal);
      const res1 = await req1.query("SELECT TOP 1 UserId FROM UserMaster WHERE UserId = @GuidVal");
      if (res1.recordset.length > 0) {
        return res1.recordset[0].UserId;
      }
    }

    // 2. If username, usercode, or fullname passed (e.g. "admin", "123", "javi", "owner", "javith")
    if (textVal && textVal !== "0" && textVal !== "00000000-0000-0000-0000-000000000000") {
      const req2 = poolOrTx.request();
      req2.input("StrVal", sql.NVarChar(100), textVal);
      const res2 = await req2.query(`
        SELECT TOP 1 UserId FROM UserMaster 
        WHERE LOWER(LTRIM(RTRIM(UserName))) = LOWER(LTRIM(RTRIM(@StrVal)))
           OR LOWER(LTRIM(RTRIM(UserCode))) = LOWER(LTRIM(RTRIM(@StrVal)))
           OR LOWER(LTRIM(RTRIM(FullName))) = LOWER(LTRIM(RTRIM(@StrVal)))
      `);
      if (res2.recordset.length > 0) {
        return res2.recordset[0].UserId;
      }
    }

    // 3. Fallback: Get active admin/cashier user from UserMaster so CashierId is NEVER empty!
    const reqFallback = poolOrTx.request();
    const fallbackRes = await reqFallback.query(`
      SELECT TOP 1 UserId FROM UserMaster 
      WHERE UserGroupId = 'DFCF23EE-F6F4-4885-8D26-0056C657595F' OR UserGroupId = 'E6EAA22D-44ED-420F-96CA-5468F0D25DB4'
      ORDER BY CreatedDate ASC
    `);
    if (fallbackRes.recordset.length > 0) {
      return fallbackRes.recordset[0].UserId;
    }

    const anyUserRes = await poolOrTx.request().query("SELECT TOP 1 UserId FROM UserMaster ORDER BY CreatedDate ASC");
    if (anyUserRes.recordset.length > 0) {
      return anyUserRes.recordset[0].UserId;
    }

    return DEFAULT_GUID;
  } catch (err) {
    console.error("Error resolving cashier user ID:", err);
    return DEFAULT_GUID;
  }
};

const validateSalePayload = ({ totalAmount, paymentMethod, items, payments }) => {
  if (payments && Array.isArray(payments) && payments.length > 0) {
    let sum = 0;
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      const amt = parseFloat(p.amount);
      if (isNaN(amt) || amt <= 0) {
        return `Payment row ${i + 1} has an invalid or negative amount.`;
      }
      if (!p.payModeId && !p.payMode) {
        return `Payment row ${i + 1} is missing a payment mode.`;
      }
      sum += amt;
    }
    const diff = Math.abs(sum - Number(totalAmount));
    if (diff > 0.01) {
      return `Total paid amount (${sum.toFixed(2)}) does not match the bill total (${Number(totalAmount).toFixed(2)})`;
    }
  } else if (!paymentMethod || !String(paymentMethod).trim()) {
    return "Payment mode is required";
  }

  const numericTotal = Number(totalAmount);
  if (!Number.isFinite(numericTotal) || numericTotal < 0) {
    return "Total amount must be at least zero";
  }

  if (!Array.isArray(items) || items.length === 0) {
    return "At least one sale item is required";
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    const dishId = item.dishId || item.id;
    const dishName = item.dish_name || item.name;
    const qty = Number(item.qty);
    const price = Number(item.price);

    if (!dishId && !dishName) return `Item ${i + 1} is missing dish information`;
    if (!Number.isFinite(qty) || qty <= 0) return `Item ${i + 1} has invalid quantity`;
    if (!Number.isFinite(price) || price < 0) return `Item ${i + 1} has invalid price`;
  }

  return null;
};

/* ================= SALES LIST & SUMMARY ================= */
router.get("/all", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const { startDate, endDate } = req.query;

    const isDateStr = (str) => typeof str === "string" && /^\d{4}-\d{2}-\d{2}$/.test(str);
    const useRange = isDateStr(startDate) && isDateStr(endDate);

    let queryStr = "";
    if (useRange) {
      const shWhere = getReportDateWhereSqlForRange(startDate, endDate, "sh.LastSettlementDate");
      const cctWhere = getReportDateWhereSqlForRange(startDate, endDate, "cct.CreatedDate");
      queryStr = `
        SELECT * FROM (
           SELECT 
             sh.SettlementID, 
             CONVERT(VARCHAR(33), sh.LastSettlementDate, 126) + '+08:00' AS SettlementDate, 
             COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE)) AS BusinessDate,
             sh.BillNo AS OrderId, 
             sh.OrderType,
             sh.TableNo, 
             sh.Section, 
             sh.CashierId, 
             sh.BillNo, 
             sh.SER_NAME,
             ISNULL(um.FullName, ISNULL(um.UserName, 'Unknown')) AS CashierName,
             ${normalizeReportPayModeSql("sts.PayMode")} as PayMode,
             ISNULL(sts.SysAmount, sh.SysAmount) as SysAmount,
             ISNULL(sts.ManualAmount, sh.ManualAmount) as ManualAmount,
             sh.SubTotal as SubTotal,
             ISNULL(sh.DiscountAmount, 0) as DiscountAmount,
             sh.DiscountType as DiscountType,
             ISNULL(sh.ServiceCharge, 0) as ServiceCharge,
             ISNULL(sh.TotalTax, 0) as TotalTax,
             ISNULL(sh.TakeawayCharge, 0) as TakeawayCharge,
             ISNULL(sts.ReceiptCount, 0) as ReceiptCount,
             ISNULL(sh.VoidItemQty, 0) as VoidQty,
             ISNULL(sh.VoidItemAmount, 0) as VoidAmount,
             sh.IsCancelled,
             sh.CancellationReason,
             sh.CancelledDate as CancelledDate,
             sh.CancelledByUserName,
             ri.OrderId AS MasterOrderId,
             ISNULL(ri.TotalDiscountAmount, 0) as TotalDiscountAmount,
             ISNULL(ri.TotalLineItemDiscountAmount, 0) as TotalLineItemDiscountAmount,
             sh.RoundedBy as RoundedBy,
             ISNULL(ri.DiscountPercentage, 0) as DiscountPercentage,
             ISNULL(cct_sale.OutstandingAmount, 0) AS OutstandingAmount,
             COALESCE(mm.Name, ccm.Name, mm_sale.Name, ccm_sale.Name) AS CustomerName,
             NULL AS CreditOrderNo,
             sh.GuestName as GuestName,
             sh.Pax as Pax,
             COALESCE(sh.entry_status, ro.entry_status) AS entryStatus,
             COALESCE(mm.Phone, ccm.Phone, mm_sale.Phone, ccm_sale.Phone) AS CustomerPhone,
             CASE 
               WHEN mm.MemberId IS NOT NULL OR mm_sale.MemberId IS NOT NULL THEN 'MEMBER'
               WHEN ccm.CustomerId IS NOT NULL OR ccm_sale.CustomerId IS NOT NULL THEN 'CREDIT'
               ELSE NULL
             END AS CustomerType
           FROM SettlementHeader sh
           LEFT JOIN RestaurantOrderCur ro ON sh.BillNo = ro.OrderNumber
           LEFT JOIN (
             SELECT SettlementID, LTRIM(RTRIM(PayMode)) AS PayMode, AVG(SysAmount) AS SysAmount, AVG(ManualAmount) AS ManualAmount, MAX(ReceiptCount) AS ReceiptCount
             FROM SettlementTotalSales
             GROUP BY SettlementID, LTRIM(RTRIM(PayMode))
           ) sts ON sh.SettlementID = sts.SettlementID
           LEFT JOIN RestaurantInvoice ri ON sh.SettlementID = ri.RestaurantBillId
           LEFT JOIN CustomerCreditTransactions cct_sale ON sh.SettlementID = cct_sale.SettlementId AND cct_sale.TransactionType = 'CREDIT_SALE'
           LEFT JOIN MemberMaster mm ON sh.MemberId = mm.MemberId
           LEFT JOIN CreditCustomerMaster ccm ON sh.MemberId = ccm.CustomerId
           LEFT JOIN MemberMaster mm_sale ON cct_sale.MemberId = mm_sale.MemberId
           LEFT JOIN CreditCustomerMaster ccm_sale ON cct_sale.MemberId = ccm_sale.CustomerId
           LEFT JOIN UserMaster um ON TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = um.UserId
           WHERE ${shWhere}

           UNION ALL

           SELECT 
             cct.TransactionId AS SettlementID,
             CONVERT(VARCHAR(33), cct.CreatedDate, 126) + '+08:00' AS SettlementDate,
             COALESCE(cct.start_date, CAST(cct.CreatedDate AS DATE)) AS BusinessDate,
             CASE 
               WHEN cct.CustomerType = 'CREDIT' THEN 'Credit Payment Collected'
               WHEN cct.CustomerType = 'MEMBER' THEN 'Member Payment Collected'
               WHEN m.CustomerId IS NOT NULL THEN 'Credit Payment Collected'
               WHEN mm.MemberId IS NOT NULL THEN 'Member Payment Collected'
               ELSE 'Credit Payment Collected'
             END AS OrderId,
             'LEDGER' AS OrderType,
             'LEDGER' AS TableNo,
             COALESCE(m.Name, mm.Name, 'Customer') AS Section,
             CAST(cct.CreatedBy AS VARCHAR(50)) AS CashierId,
             cct.Remarks AS BillNo,
             'Cashier' AS SER_NAME,
             ISNULL(um.FullName, ISNULL(um.UserName, 'Unknown')) AS CashierName,
             cct.PaymentMethod AS PayMode,
             cct.PaidAmount AS SysAmount,
             cct.PaidAmount AS ManualAmount,
             cct.PaidAmount AS SubTotal,
             0 AS DiscountAmount,
             NULL AS DiscountType,
             0 AS ServiceCharge,
             0 AS TotalTax,
             0 AS TakeawayCharge,
             1 AS ReceiptCount,
             0 AS VoidQty,
             0 AS VoidAmount,
             0 AS IsCancelled,
             NULL AS CancellationReason,
             NULL AS CancelledDate,
             NULL AS CancelledByUserName,
             NULL AS MasterOrderId,
             0 AS TotalDiscountAmount,
             0 AS TotalLineItemDiscountAmount,
             0 AS RoundedBy,
             0 AS DiscountPercentage,
             0 AS OutstandingAmount,
             COALESCE(m.Name, mm.Name) AS CustomerName,
             (SELECT TOP 1 tx.BillNo FROM CustomerCreditAllocations cca JOIN CustomerCreditTransactions tx ON cca.InvoiceTransactionId = tx.TransactionId WHERE cca.PaymentTransactionId = cct.TransactionId) AS CreditOrderNo,
             COALESCE(m.Name, mm.Name) AS GuestName,
             NULL AS Pax,
             NULL AS entryStatus,
             COALESCE(m.Phone, mm.Phone) AS CustomerPhone,
             ISNULL(cct.CustomerType, CASE WHEN m.CustomerId IS NOT NULL THEN 'CREDIT' ELSE 'MEMBER' END) AS CustomerType
           FROM CustomerCreditTransactions cct
           LEFT JOIN CreditCustomerMaster m ON cct.MemberId = m.CustomerId AND (cct.CustomerType = 'CREDIT' OR cct.CustomerType IS NULL)
           LEFT JOIN MemberMaster mm ON cct.MemberId = mm.MemberId AND (cct.CustomerType = 'MEMBER' OR (cct.CustomerType IS NULL AND m.CustomerId IS NULL))
           LEFT JOIN UserMaster um ON TRY_CAST(cct.CreatedBy AS UNIQUEIDENTIFIER) = um.UserId
           WHERE cct.TransactionType = 'PAYMENT' AND ${cctWhere}
        ) CombinedSales
        ORDER BY SettlementDate DESC
      `;
    } else {
      queryStr = `
        SELECT TOP 200 * FROM (
           SELECT 
             sh.SettlementID, 
             CONVERT(VARCHAR(33), sh.LastSettlementDate, 126) + '+08:00' AS SettlementDate, 
             COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE)) AS BusinessDate,
             sh.BillNo AS OrderId, 
             sh.OrderType,
             sh.TableNo, 
             sh.Section, 
             sh.CashierId, 
             sh.BillNo, 
             sh.SER_NAME,
             ISNULL(um.FullName, ISNULL(um.UserName, 'Unknown')) AS CashierName,
             ${normalizeReportPayModeSql("sts.PayMode")} as PayMode,
             ISNULL(sts.SysAmount, sh.SysAmount) as SysAmount,
             ISNULL(sts.ManualAmount, sh.ManualAmount) as ManualAmount,
             sh.SubTotal as SubTotal,
             ISNULL(sh.DiscountAmount, 0) as DiscountAmount,
             sh.DiscountType as DiscountType,
             ISNULL(sh.ServiceCharge, 0) as ServiceCharge,
             ISNULL(sh.TotalTax, 0) as TotalTax,
             ISNULL(sh.TakeawayCharge, 0) as TakeawayCharge,
             ISNULL(sts.ReceiptCount, 0) as ReceiptCount,
             ISNULL(sh.VoidItemQty, 0) as VoidQty,
             ISNULL(sh.VoidItemAmount, 0) as VoidAmount,
             sh.IsCancelled,
             sh.CancellationReason,
             sh.CancelledDate as CancelledDate,
             sh.CancelledByUserName,
             ri.OrderId AS MasterOrderId,
             ISNULL(ri.TotalDiscountAmount, 0) as TotalDiscountAmount,
             ISNULL(ri.TotalLineItemDiscountAmount, 0) as TotalLineItemDiscountAmount,
             sh.RoundedBy as RoundedBy,
             ISNULL(ri.DiscountPercentage, 0) as DiscountPercentage,
             ISNULL(cct_sale.OutstandingAmount, 0) AS OutstandingAmount,
             COALESCE(mm.Name, ccm.Name, mm_sale.Name, ccm_sale.Name) AS CustomerName,
             NULL AS CreditOrderNo,
             sh.GuestName as GuestName,
             sh.Pax as Pax,
             COALESCE(sh.entry_status, ro.entry_status) AS entryStatus,
             COALESCE(mm.Phone, ccm.Phone, mm_sale.Phone, ccm_sale.Phone) AS CustomerPhone,
             CASE 
               WHEN mm.MemberId IS NOT NULL OR mm_sale.MemberId IS NOT NULL THEN 'MEMBER'
               WHEN ccm.CustomerId IS NOT NULL OR ccm_sale.CustomerId IS NOT NULL THEN 'CREDIT'
               ELSE NULL
             END AS CustomerType
           FROM SettlementHeader sh
           LEFT JOIN RestaurantOrderCur ro ON sh.BillNo = ro.OrderNumber
           LEFT JOIN (
             SELECT SettlementID, LTRIM(RTRIM(PayMode)) AS PayMode, AVG(SysAmount) AS SysAmount, AVG(ManualAmount) AS ManualAmount, MAX(ReceiptCount) AS ReceiptCount
             FROM SettlementTotalSales
             GROUP BY SettlementID, LTRIM(RTRIM(PayMode))
           ) sts ON sh.SettlementID = sts.SettlementID
           LEFT JOIN RestaurantInvoice ri ON sh.SettlementID = ri.RestaurantBillId
           LEFT JOIN CustomerCreditTransactions cct_sale ON sh.SettlementID = cct_sale.SettlementId AND cct_sale.TransactionType = 'CREDIT_SALE'
           LEFT JOIN MemberMaster mm ON sh.MemberId = mm.MemberId
           LEFT JOIN CreditCustomerMaster ccm ON sh.MemberId = ccm.CustomerId
           LEFT JOIN MemberMaster mm_sale ON cct_sale.MemberId = mm_sale.MemberId
           LEFT JOIN CreditCustomerMaster ccm_sale ON cct_sale.MemberId = ccm_sale.CustomerId
           LEFT JOIN UserMaster um ON TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = um.UserId
 
           UNION ALL
 
           SELECT 
             cct.TransactionId AS SettlementID,
             CONVERT(VARCHAR(33), cct.CreatedDate, 126) + '+08:00' AS SettlementDate,
             COALESCE(cct.start_date, CAST(cct.CreatedDate AS DATE)) AS BusinessDate,
             CASE 
               WHEN cct.CustomerType = 'CREDIT' THEN 'Credit Payment Collected'
               WHEN cct.CustomerType = 'MEMBER' THEN 'Member Payment Collected'
               WHEN m.CustomerId IS NOT NULL THEN 'Credit Payment Collected'
               WHEN mm.MemberId IS NOT NULL THEN 'Member Payment Collected'
               ELSE 'Credit Payment Collected'
             END AS OrderId,
             'LEDGER' AS OrderType,
             'LEDGER' AS TableNo,
             COALESCE(m.Name, mm.Name, 'Customer') AS Section,
             CAST(cct.CreatedBy AS VARCHAR(50)) AS CashierId,
            cct.Remarks AS BillNo,
            'Cashier' AS SER_NAME,
             ISNULL(um.FullName, ISNULL(um.UserName, 'Unknown')) AS CashierName,
             cct.PaymentMethod AS PayMode,
            cct.PaidAmount AS SysAmount,
            cct.PaidAmount AS ManualAmount,
            cct.PaidAmount AS SubTotal,
            0 AS DiscountAmount,
            NULL AS DiscountType,
            0 AS ServiceCharge,
            0 AS TotalTax,
            0 AS TakeawayCharge,
            1 AS ReceiptCount,
            0 AS VoidQty,
            0 AS VoidAmount,
            0 AS IsCancelled,
            NULL AS CancellationReason,
            NULL AS CancelledDate,
            NULL AS CancelledByUserName,
            NULL AS MasterOrderId,
            0 AS TotalDiscountAmount,
            0 AS TotalLineItemDiscountAmount,
            0 AS RoundedBy,
            0 AS DiscountPercentage,
            0 AS OutstandingAmount,
            COALESCE(m.Name, mm.Name) AS CustomerName,
             (SELECT TOP 1 tx.BillNo FROM CustomerCreditAllocations cca JOIN CustomerCreditTransactions tx ON cca.InvoiceTransactionId = tx.TransactionId WHERE cca.PaymentTransactionId = cct.TransactionId) AS CreditOrderNo,
            COALESCE(m.Name, mm.Name) AS GuestName,
            NULL AS Pax,
            NULL AS entryStatus,
            COALESCE(m.Phone, mm.Phone) AS CustomerPhone,
            ISNULL(cct.CustomerType, CASE WHEN m.CustomerId IS NOT NULL THEN 'CREDIT' ELSE 'MEMBER' END) AS CustomerType
          FROM CustomerCreditTransactions cct
          LEFT JOIN CreditCustomerMaster m ON cct.MemberId = m.CustomerId AND (cct.CustomerType = 'CREDIT' OR cct.CustomerType IS NULL)
          LEFT JOIN MemberMaster mm ON cct.MemberId = mm.MemberId AND (cct.CustomerType = 'MEMBER' OR (cct.CustomerType IS NULL AND m.CustomerId IS NULL))
           LEFT JOIN UserMaster um ON TRY_CAST(cct.CreatedBy AS UNIQUEIDENTIFIER) = um.UserId
           WHERE cct.TransactionType = 'PAYMENT'
         ) CombinedSales
        ORDER BY SettlementDate DESC
      `;
    }

    const result = await pool.request().query(queryStr);
    const records = result.recordset || [];
    let finalRecords = [];
    if (records.length > 0) {
      const masterOrderIds = records
        .map(r => r.MasterOrderId)
        .filter(id => id && id.length > 30);

      const mergeMap = {};
      if (masterOrderIds.length > 0) {
        try {
          const formattedIds = masterOrderIds.map(id => `'${id}'`).join(',');
          const mergeResult = await pool.request().query(`
            SELECT 
              omh.ParentOrderId, 
              omh.ChildTableNo,
              COALESCE(ro.OrderNumber, ro_cur.OrderNumber) AS ChildOrderNo
            FROM OrderMergeHistory omh
            LEFT JOIN RestaurantOrder ro ON omh.ChildOrderId = ro.OrderId
            LEFT JOIN RestaurantOrderCur ro_cur ON omh.ChildOrderId = ro_cur.OrderId
            WHERE omh.ParentOrderId IN (${formattedIds})
          `);
          
          mergeResult.recordset.forEach(row => {
            const parentId = String(row.ParentOrderId).toLowerCase();
            const childTable = String(row.ChildTableNo || "").trim();
            const childOrder = String(row.ChildOrderNo || "").trim();
            const displayStr = childTable ? `T${childTable}${childOrder ? ` [#${childOrder}]` : ""}` : childOrder;
            if (displayStr) {
              if (!mergeMap[parentId]) mergeMap[parentId] = [];
              mergeMap[parentId].push(displayStr);
            }
          });
        } catch (mergeErr) {
          console.error("⚠️ [Report API] Failed to fetch merge history details:", mergeErr.message);
        }
      }

      records.forEach(row => {
        const parentId = row.MasterOrderId ? String(row.MasterOrderId).toLowerCase() : null;
        
        // 1. Merge details
        if (parentId && mergeMap[parentId]) {
          row.isMerged = true;
          row.mergedDetails = [...new Set(mergeMap[parentId])].join(', ');
        } else {
          row.isMerged = false;
          row.mergedDetails = "";
        }

        // Standard check for split by item that already has suffix in BillNo
        if (row.BillNo && row.BillNo.includes('-S')) {
          row.isSplit = true;
          row.splitNo = 'S' + row.BillNo.split('-S').pop();
        } else {
          row.isSplit = false;
          row.splitNo = "";
        }
        finalRecords.push(row);
      });
    }

    res.json(finalRecords);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/transactions", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { startDate, endDate } = req.query;
    const result = await pool.request()
      .input("Start", sql.DateTime, startDate || new Date(new Date().setDate(new Date().getDate() - 30)))
      .input("End", sql.DateTime, endDate || new Date())
      .query(`
        SELECT sh.SettlementID, CONVERT(VARCHAR(33), sh.LastSettlementDate, 126) + '+08:00' as LastSettlementDate, sh.BillNo, sh.SysAmount AS TotalAmount, sts.PayMode,
        CONVERT(VARCHAR(8), sh.LastSettlementDate, 112) + '-' + RIGHT('0000' + CAST(sh.OrderId AS VARCHAR(10)), 4) AS OrderId,
        sh.IsCancelled, sh.CancellationReason
        FROM SettlementHeader sh
        LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
        WHERE sh.LastSettlementDate >= DATEADD(hour, -12, CAST(@Start AS DATETIME))
        AND sh.LastSettlementDate <= DATEADD(hour, 36, CAST(@End AS DATETIME))
        ORDER BY sh.LastSettlementDate DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/range", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { startDate, endDate } = req.query;
    const isDateStr = (str) => typeof str === "string" && /^\d{4}-\d{2}-\d{2}$/.test(str);
    let whereClause = "";
    const reqQuery = pool.request();
    if (isDateStr(startDate) && isDateStr(endDate)) {
      whereClause = getReportDateWhereSqlForRange(startDate, endDate, "sh.LastSettlementDate");
    } else {
      reqQuery.input("Start", sql.DateTime, startDate);
      reqQuery.input("End", sql.DateTime, endDate);
      whereClause = `sh.LastSettlementDate >= DATEADD(hour, -12, CAST(@Start AS DATETIME)) AND sh.LastSettlementDate <= DATEADD(hour, 36, CAST(@End AS DATETIME))`;
    }
    const result = await reqQuery.query(`
        SELECT ISNULL(SUM(sts.SysAmount), 0) AS TotalSales, 
        COUNT(sh.SettlementID) AS TransactionCount
        FROM SettlementHeader sh
        INNER JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
        WHERE ${whereClause}
      `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/settlement/:id", async (req, res) => {
  try {
    const pool = await poolPromise;
    const orderId = req.params.id;

    // Fetch the header
    const headerResult = await pool.request()
      .input("OrderId", sql.UniqueIdentifier, orderId)
      .query("SELECT TOP 1 * FROM SettlementHeader WHERE OrderId = @OrderId OR SettlementID = @OrderId");
    
    let header;
    let items = [];
    let payments = [];

    if (headerResult.recordset.length > 0) {
      header = headerResult.recordset[0];
      const settlementId = header.SettlementID;

      // ✅ Fix: Tedious serializes MSSQL datetime as "...Z" (treats local SGT time as UTC).
      // Normalise LastSettlementDate → SettlementDate with explicit +08:00 so the frontend
      // parseDatabaseDate never double-adds 8 hours when formatting receipt timestamps.
      if (header.LastSettlementDate) {
        const rawDate = header.LastSettlementDate;
        let iso;
        if (rawDate instanceof Date) {
          // Tedious gives a JS Date whose UTC wall-clock == the SGT local time stored in MSSQL.
          // Re-interpret those UTC numbers AS SGT by replacing the trailing Z with +08:00.
          iso = rawDate.toISOString().replace(/Z$/, '+08:00');
        } else {
          const s = String(rawDate).replace(/Z$/i, '').replace(/[+-]\d{2}:\d{2}$/, '');
          iso = s + '+08:00';
        }
        header = { ...header, SettlementDate: iso };
      }

      // Fetch the items
      const itemsResult = await pool.request()
        .input("SettlementID", sql.UniqueIdentifier, settlementId)
        .query("SELECT * FROM SettlementItemDetail WHERE SettlementID = @SettlementID");
      items = itemsResult.recordset || [];

      // Fetch the payments (deduplicated by PaymentId to prevent double-counting across Cur and Master tables)
      const paymentsResult = await pool.request()
        .input("SettlementID", sql.UniqueIdentifier, settlementId)
        .query(`
          SELECT * FROM PaymentDetailCur WHERE RestaurantBillId = @SettlementID OR SettlementId = @SettlementID 
          UNION 
          SELECT * FROM PaymentDetail WHERE RestaurantBillId = @SettlementID OR SettlementId = @SettlementID
        `);
      payments = paymentsResult.recordset || [];
    } else {
      // Check CustomerCreditTransactions for LEDGER
      const ledgerResult = await pool.request()
        .input("TxId", sql.UniqueIdentifier, orderId)
        .query("SELECT * FROM CustomerCreditTransactions WHERE TransactionId = @TxId");
      
      if (ledgerResult.recordset.length === 0) {
        return res.status(404).json({ error: "Settlement not found" });
      }

      const ledger = ledgerResult.recordset[0];
      const customerName = ledger.Remarks ? ledger.Remarks.split('(')[0].trim() : 'Customer';
      header = {
        SettlementID: ledger.TransactionId,
        SettlementDate: (ledger.CreatedDate instanceof Date ? ledger.CreatedDate.toISOString().replace(/Z$/, '+08:00') : String(ledger.CreatedDate)),
        BillNo: ledger.Remarks || 'LEDGER_PAY',
        PayMode: ledger.PaymentMethod,
        SysAmount: ledger.PaidAmount,
        SubTotal: ledger.PaidAmount,
        OrderType: 'LEDGER',
        MemberId: ledger.MemberId,
        SER_NAME: 'Cashier',
        TableNo: 'LEDGER',
        Section: customerName
      };

      items = [{
        DishName: ledger.Remarks || 'Member Outstanding Payment',
        Qty: 1,
        Price: ledger.PaidAmount
      }];

      // Fetch the payments
      const ptdResult = await pool.request()
        .input("TxId", sql.UniqueIdentifier, orderId)
        .query("SELECT ptd.PayModeId, ptd.Amount, pm.PayMode FROM [dbo].[PaymentTransactionDetails] ptd LEFT JOIN [dbo].[Paymode] pm ON ptd.PayModeId = pm.Position WHERE ptd.ReferenceId = @TxId");
      
      if (ptdResult.recordset.length > 0) {
        payments = ptdResult.recordset.map(p => ({
          Paymode: p.PayMode || 'CASH',
          Amount: p.Amount
        }));
      } else {
        payments = [{
          Paymode: ledger.PaymentMethod || 'CASH',
          Amount: ledger.PaidAmount
        }];
      }
    }

    res.json({
      header,
      items,
      payments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/detail/:id", async (req, res) => {
  try {
    const pool = await poolPromise;
    let cleanId = req.params.id;
    if (cleanId && cleanId.length > 36) {
      cleanId = cleanId.substring(0, 36);
    }

    const itemsResult = await pool.request()
      .input("Id", sql.UniqueIdentifier, cleanId)
      .query("SELECT * FROM SettlementItemDetail WHERE SettlementID = @Id");
    
    const items = itemsResult.recordset || [];
    
    if (items.length > 0) {
      // Fetch the master OrderId for this settlement from RestaurantInvoice
      const orderIdResult = await pool.request()
        .input("Id", sql.UniqueIdentifier, cleanId)
        .query("SELECT OrderId FROM RestaurantInvoice WHERE RestaurantBillId = @Id");
        
      const orderId = orderIdResult.recordset[0]?.OrderId;
      
      if (orderId) {
        // Fetch modifiers from both history and live tables
        const modifiersResult = await pool.request()
          .input("OrderId", sql.UniqueIdentifier, orderId)
          .query(`
            SELECT OrderDetailId, DishId, ModifierId, ModifierName, Amount 
            FROM Restaurantmodifierdetail 
            WHERE OrderId = @OrderId
            UNION
            SELECT OrderDetailId, DishId, ModifierId, ModifierName, Amount 
            FROM RestaurantmodifierdetailCur 
            WHERE OrderId = @OrderId
          `);
          
        const modifiers = modifiersResult.recordset || [];
        
        // Group modifiers by OrderDetailId (falling back to DishId for legacy compatibility)
        items.forEach(item => {
          const itemMods = modifiers
            .filter(m => {
              if (item.OrderDetailId && m.OrderDetailId) {
                return String(m.OrderDetailId).toLowerCase() === String(item.OrderDetailId).toLowerCase();
              }
              return m.DishId && item.DishId && String(m.DishId).toLowerCase() === String(item.DishId).toLowerCase();
            })
            .map(m => ({ 
              name: m.ModifierName, 
              ModifierName: m.ModifierName, 
              Amount: m.Amount,
              ModifierId: m.ModifierId
            }));
          item.modifiers = itemMods;
        });
      }
    }
    
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/detail/:id/payments", async (req, res) => {
  try {
    const pool = await poolPromise;
    let cleanId = req.params.id;
    if (cleanId && cleanId.length > 36) {
      cleanId = cleanId.substring(0, 36);
    }

    const result = await pool.request()
      .input("Id", sql.UniqueIdentifier, cleanId)
      .query(`
        SELECT 
          ptd.PaymentTransactionId,
          ptd.ReferenceType,
          ptd.ReferenceId,
          ptd.PayModeId,
          ptd.Amount,
          ptd.ReferenceNo,
          COALESCE(NULLIF(LTRIM(RTRIM(pm.Description)), ''), LTRIM(RTRIM(pm.PayMode)), 'CASH') AS PayModeName
        FROM PaymentTransactionDetails ptd
        LEFT JOIN Paymode pm ON pm.Position = ptd.PayModeId
        WHERE ptd.ReferenceId = @Id AND ptd.ReferenceType = 'BILL'
      `);
    
    let payments = (result.recordset || []).map(row => ({
      ...row,
      PayModeName: (row.PayModeName && row.PayModeName.trim()) ? row.PayModeName.trim() : 'CASH'
    }));

    if (payments.length === 0) {
      // Fallback 1: Query PaymentDetailCur / PaymentDetail to see if there is a single payment mode recorded
      const pdResult = await pool.request()
        .input("Id", sql.UniqueIdentifier, cleanId)
        .query(`
          SELECT 
            pd.RestaurantBillId AS ReferenceId,
            pd.Amount,
            COALESCE(NULLIF(LTRIM(RTRIM(pm.Description)), ''), LTRIM(RTRIM(pm.PayMode)), 'CASH') AS PayModeName
          FROM PaymentDetailCur pd
          LEFT JOIN Paymode pm ON pd.Paymode = pm.Position
          WHERE pd.RestaurantBillId = @Id
        `);
      
      if (pdResult.recordset.length > 0) {
        payments = pdResult.recordset.map(row => ({
          PaymentTransactionId: null,
          ReferenceType: 'BILL',
          ReferenceId: row.ReferenceId,
          PayModeId: null,
          Amount: row.Amount,
          ReferenceNo: null,
          PayModeName: (row.PayModeName && row.PayModeName.trim()) ? row.PayModeName.trim() : 'CASH'
        }));
      } else {
        // Fallback 2: Query SettlementTotalSales or SettlementHeader to get the single payment mode and total amount
        const fallbackResult = await pool.request()
          .input("Id", sql.UniqueIdentifier, cleanId)
          .query(`
            SELECT DISTINCT TOP 1
              sh.SettlementID AS ReferenceId,
              sh.SysAmount AS Amount,
              sts.PayMode
            FROM SettlementHeader sh
            LEFT JOIN (
              SELECT SettlementID, LTRIM(RTRIM(PayMode)) AS PayMode, AVG(SysAmount) AS SysAmount, AVG(ManualAmount) AS ManualAmount, MAX(ReceiptCount) AS ReceiptCount
              FROM SettlementTotalSales
              GROUP BY SettlementID, LTRIM(RTRIM(PayMode))
            ) sts ON sh.SettlementID = sts.SettlementID
            WHERE sh.SettlementID = @Id
          `);
        if (fallbackResult.recordset.length > 0) {
          const row = fallbackResult.recordset[0];
          // Resolve paymode name from Paymode table using legacy field
          const paymodeNameResult = await pool.request()
            .input("PayMode", sql.VarChar(50), row.PayMode || '')
            .query(`
              SELECT TOP 1 COALESCE(NULLIF(LTRIM(RTRIM(Description)), ''), LTRIM(RTRIM(PayMode)), 'CASH') AS PayModeName
              FROM Paymode
              WHERE PayMode = @PayMode OR Description = @PayMode OR CAST(Position AS VARCHAR(10)) = @PayMode
            `);
          const rawResolvedName = paymodeNameResult.recordset[0]?.PayModeName || row.PayMode;
          const payModeName = (rawResolvedName && rawResolvedName.trim()) ? rawResolvedName.trim() : 'CASH';
          payments = [{
            PaymentTransactionId: null,
            ReferenceType: 'BILL',
            ReferenceId: row.ReferenceId,
            PayModeId: null,
            Amount: row.Amount,
            ReferenceNo: null,
            PayModeName: payModeName
          }];
      }
    }
  }
  res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get("/detail/:id/rewards", async (req, res) => {
  try {
    const pool = await poolPromise;
    let cleanId = req.params.id;
    if (cleanId && cleanId.length > 36) {
      cleanId = cleanId.substring(0, 36);
    }

    const rewardRes = await pool.request()
      .input("Id", sql.UniqueIdentifier, cleanId)
      .query(`
        SELECT TOP 1 
          PointsEarned, 
          PointsUsed, 
          MemberId,
          (SELECT TOP 1 RewardCredit FROM MemberMaster WHERE MemberId = rpd.MemberId) AS RewardCredit
        FROM RewardPointDetails rpd
        WHERE SettlementId = @Id
      `);
    if (rewardRes.recordset.length > 0) {
      res.json(rewardRes.recordset[0]);
    } else {
      res.json(null);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ================= LOGIN-WISE SALES REPORT ================= */
router.get("/login-wise-sales", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const filter = req.query.filter || "daily";
    const date = req.query.date;
    const { startDate, endDate } = req.query;
    const dateWhere = getReportDateWhereSql(filter, "sh.LastSettlementDate", date, startDate, endDate);
    const cctDateWhere = getReportDateWhereSql(filter, "cct.CreatedDate", date, startDate, endDate);
    console.log(`[REPORT API] type=login-wise-sales filter=${filter} date=${date || 'today'} range=${startDate || ''}..${endDate || ''}`);

    const result = await pool.request().query(`
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
        WHERE ${dateWhere}
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
        WHERE ${dateWhere}
        GROUP BY sh.CashierId
      ),
      CreditCollections AS (
        SELECT
          cct.CreatedBy AS CashierIdRaw,
          ISNULL(SUM(cct.PaidAmount), 0) AS CreditCollectedAmount
        FROM CustomerCreditTransactions cct
        WHERE cct.TransactionType = 'PAYMENT'
          AND ISNULL(cct.CustomerType, 'CREDIT') = 'CREDIT'
          AND ${cctDateWhere}
        GROUP BY cct.CreatedBy
      )
      SELECT
        u.UserId AS CashierId,
        ISNULL(NULLIF(LTRIM(RTRIM(u.FullName)), ''), u.UserName) AS CashierName,
        ISNULL(u.UserName, '-') AS UserLogin,
        ISNULL(u.UserCode, '-') AS UserCode,
        ISNULL(g.UserGroupCode, 'CASHIER') AS RoleCode,
        ISNULL(g.UserGroupName, 'Cashier') AS RoleName,
        ISNULL(h.TotalBills, 0) AS TotalBills,
        ISNULL(h.TotalSubTotal, 0) AS TotalSubTotal,
        ISNULL(h.TotalDiscount, 0) AS TotalDiscount,
        ISNULL(h.TotalServiceCharge, 0) AS TotalServiceCharge,
        ISNULL(h.TotalTax, 0) AS TotalTax,
        ISNULL(h.TotalTakeaway, 0) AS TotalTakeaway,
        ISNULL(h.TotalVoidAmount, 0) AS TotalVoidAmount,
        ISNULL(h.TotalVoidQty, 0) AS TotalVoidQty,
        ISNULL(h.TotalRounded, 0) AS TotalRounded,
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
        ISNULL(h.CancelledBills, 0) AS CancelledBills,
        ISNULL(cc.CreditCollectedAmount, 0) AS CreditCollectedAmount
      FROM (
        SELECT CAST(UserId AS NVARCHAR(50)) AS UserId, UserName, FullName, UserCode, UserGroupid FROM UserMaster
      ) u
      LEFT JOIN UserGroupMaster g ON u.UserGroupid = g.UserGroupId
      LEFT JOIN HeaderTotals h ON (
        TRY_CAST(h.CashierId AS UNIQUEIDENTIFIER) = u.UserId 
        OR CAST(h.CashierId AS NVARCHAR(50)) = u.UserId
        OR LOWER(LTRIM(RTRIM(h.CashierId))) = LOWER(LTRIM(RTRIM(u.UserName)))
        OR LOWER(LTRIM(RTRIM(h.CashierId))) = LOWER(LTRIM(RTRIM(u.UserCode)))
        OR LOWER(LTRIM(RTRIM(h.CashierId))) = LOWER(LTRIM(RTRIM(u.FullName)))
      )
      LEFT JOIN PaymentTotals p ON (
        TRY_CAST(p.CashierId AS UNIQUEIDENTIFIER) = u.UserId 
        OR CAST(p.CashierId AS NVARCHAR(50)) = u.UserId
        OR LOWER(LTRIM(RTRIM(p.CashierId))) = LOWER(LTRIM(RTRIM(u.UserName)))
        OR LOWER(LTRIM(RTRIM(p.CashierId))) = LOWER(LTRIM(RTRIM(u.UserCode)))
        OR LOWER(LTRIM(RTRIM(p.CashierId))) = LOWER(LTRIM(RTRIM(u.FullName)))
      )
      LEFT JOIN CreditCollections cc ON (
        TRY_CAST(cc.CashierIdRaw AS UNIQUEIDENTIFIER) = u.UserId
        OR CAST(cc.CashierIdRaw AS NVARCHAR(50)) = u.UserId
        OR LOWER(LTRIM(RTRIM(cc.CashierIdRaw))) = LOWER(LTRIM(RTRIM(u.UserName)))
        OR LOWER(LTRIM(RTRIM(cc.CashierIdRaw))) = LOWER(LTRIM(RTRIM(u.UserCode)))
        OR LOWER(LTRIM(RTRIM(cc.CashierIdRaw))) = LOWER(LTRIM(RTRIM(u.FullName)))
      )
      WHERE ISNULL(h.TotalSales, 0) > 0 OR ISNULL(cc.CreditCollectedAmount, 0) > 0
      ORDER BY TotalSales DESC, CashierName ASC
    `);

    console.log(`[REPORT API] type=login-wise-sales rows=${result.recordset.length}`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] login-wise-sales error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ================= LOGIN-WISE SETTLEMENT REPORT ================= */
router.get("/login-wise-settlement", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const filter = req.query.filter || "daily";
    const date = req.query.date;
    const { startDate, endDate } = req.query;
    const dateWhere = getReportDateWhereSql(filter, "sh.LastSettlementDate", date, startDate, endDate);
    console.log(`[REPORT API] type=login-wise-settlement filter=${filter} date=${date || 'today'} range=${startDate || ''}..${endDate || ''}`);

    const result = await pool.request().query(`
      SELECT
        CAST(sh.CashierId AS NVARCHAR(50)) AS CashierId,
        ISNULL(um.FullName, ISNULL(um.UserName, 'Unknown / QR')) AS CashierName,
        ISNULL(um.UserName, '-') AS UserLogin,
        LTRIM(RTRIM(ISNULL(sts.PayMode, 'CASH'))) AS PayMode,
        SUM(ISNULL(sts.SysAmount, 0)) AS SysAmount,
        SUM(ISNULL(sts.ManualAmount, 0)) AS ManualAmount,
        COUNT(DISTINCT sh.SettlementID) AS ReceiptCount
      FROM SettlementHeader sh
      INNER JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
      LEFT JOIN UserMaster um ON (
        TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = um.UserId
        OR CAST(sh.CashierId AS NVARCHAR(50)) = um.UserId
        OR LOWER(LTRIM(RTRIM(sh.CashierId))) = LOWER(LTRIM(RTRIM(um.UserName)))
        OR LOWER(LTRIM(RTRIM(sh.CashierId))) = LOWER(LTRIM(RTRIM(um.UserCode)))
        OR LOWER(LTRIM(RTRIM(sh.CashierId))) = LOWER(LTRIM(RTRIM(um.FullName)))
      )
      WHERE ${dateWhere}
        AND ISNULL(sh.IsCancelled, 0) = 0
      GROUP BY
        CAST(sh.CashierId AS NVARCHAR(50)),
        um.FullName, um.UserName,
        LTRIM(RTRIM(ISNULL(sts.PayMode, 'CASH')))
      ORDER BY CashierName, PayMode
    `);

    console.log(`[REPORT API] type=login-wise-settlement rows=${result.recordset.length}`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] login-wise-settlement error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/category", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const filter = req.query.filter || "daily";
    const date = req.query.date;
    const { startDate, endDate } = req.query;
    const appDateWhereSql = await getReportDateWhereSql(filter, "sh.LastSettlementDate", date, startDate, endDate);
    const legacyDateWhereSql = await getReportDateWhereSql(filter, "ri.InvoiceDate", date, startDate, endDate);
    const roDateWhereSql = await getReportDateWhereSql(filter, "ro.start_date", date, startDate, endDate);
    console.log(`[REPORT API] type=category filter=${filter} date=${date || 'today'} range=${startDate || ''}..${endDate || ''}`);

    const result = await pool.request().query(`
        WITH AppReport AS (
          SELECT
            ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')) AS categoryName,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') = 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN 
              CAST(CASE 
                WHEN sid.DiscountType = 'percentage' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) * (ISNULL(sid.DiscountAmount, 0) / 100.0)
                WHEN sid.DiscountType = 'FOC' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0))
                ELSE ISNULL(sid.Qty, 0) * (CASE WHEN ISNULL(sid.DiscountAmount, 0) > ISNULL(sid.Price, 0) THEN ISNULL(sid.Price, 0) ELSE ISNULL(sid.DiscountAmount, 0) END)
              END AS decimal(18, 2)) ELSE 0 END) AS discountAmount,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN 
              CAST((ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) - (CASE 
                WHEN sid.DiscountType = 'percentage' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) * (ISNULL(sid.DiscountAmount, 0) / 100.0)
                WHEN sid.DiscountType = 'FOC' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0))
                ELSE ISNULL(sid.Qty, 0) * (CASE WHEN ISNULL(sid.DiscountAmount, 0) > ISNULL(sid.Price, 0) THEN ISNULL(sid.Price, 0) ELSE ISNULL(sid.DiscountAmount, 0) END)
              END) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
          FROM SettlementHeader sh
          INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
          LEFT JOIN DishMaster d ON sid.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON COALESCE(sid.DishGroupId, d.DishGroupId) = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON COALESCE(sid.CategoryId, dg.CategoryId) = cm.CategoryId
          WHERE ${appDateWhereSql}
            AND ISNULL(sid.Qty, 0) > 0
            AND ISNULL(sh.IsCancelled, 0) = 0
            AND EXISTS (SELECT 1 FROM SettlementTotalSales WHERE SettlementID = sh.SettlementID)
          GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped'))
        ),
        LegacyReport AS (
          SELECT
            ISNULL(cm.CategoryName, 'Unmapped') AS categoryName,
            SUM(CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3))) AS totalQty,
            CAST(0 AS decimal(18, 3)) AS voidQty,
            CAST(0 AS decimal(18, 2)) AS discountAmount,
            SUM(CAST(ISNULL(rod.TotalDetailLineAmount, 0) AS decimal(18, 2))) AS totalAmount
          FROM RestaurantOrderDetail rod
          INNER JOIN (
            SELECT OrderId, RestaurantBillId, InvoiceDate, start_date 
            FROM (
              SELECT OrderId, RestaurantBillId, InvoiceDate, CreatedOn, start_date, ROW_NUMBER() OVER (PARTITION BY OrderId ORDER BY CreatedOn DESC) as rn
              FROM (
                SELECT OrderId, RestaurantBillId, InvoiceDate, CreatedOn, start_date FROM RestaurantInvoice WHERE StatusCode = 5
                UNION ALL
                SELECT OrderId, RestaurantBillId, InvoiceDate, CreatedOn, start_date FROM RestaurantInvoicecur WHERE StatusCode = 5
              ) CombinedInvoices
            ) DeduplicatedInvoices
            WHERE rn = 1
          ) ri ON rod.OrderId = ri.OrderId
          LEFT JOIN DishMaster d ON rod.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
          WHERE ${legacyDateWhereSql}
            AND NOT EXISTS (
              SELECT 1 FROM SettlementHeader sh_dup 
              WHERE sh_dup.SettlementID = ri.RestaurantBillId
            )
          GROUP BY ISNULL(cm.CategoryName, 'Unmapped')
        ),
        ProfessionalReport AS (
          SELECT
            ISNULL(cm.CategoryName, 'Unmapped') AS categoryName,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN rod.StatusCode = 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            CAST(0 AS decimal(18, 2)) AS discountAmount,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.TotalDetailLineAmount, 0) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
          FROM RestaurantOrderDetail rod
          INNER JOIN RestaurantOrder ro ON rod.OrderId = ro.OrderId
          LEFT JOIN DishMaster d ON rod.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
          WHERE ${roDateWhereSql}
            AND ISNULL(ro.StatusCode, 0) = 3
            AND NOT EXISTS (
              SELECT 1 FROM SettlementHeader sh_dup 
              WHERE sh_dup.BillNo = ro.OrderNumber
            )
          GROUP BY ISNULL(cm.CategoryName, 'Unmapped')
        )
        SELECT categoryName, SUM(totalQty) AS totalQty, SUM(voidQty) AS voidQty, SUM(discountAmount) AS discountAmount, SUM(totalAmount) AS totalAmount
        FROM (
          SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM AppReport
          UNION ALL
          SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM LegacyReport
          UNION ALL
          SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM ProfessionalReport
        ) ReportRows
        GROUP BY categoryName
        HAVING SUM(totalQty) > 0 OR SUM(totalAmount) > 0 OR SUM(voidQty) > 0
        ORDER BY totalAmount DESC, totalQty DESC, categoryName ASC
      `);

    console.log(`[REPORT API] type=category filter=${filter} rows=${result.recordset.length}`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] category error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/dish", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const filter = req.query.filter || "daily";
    const date = req.query.date;
    const { startDate, endDate } = req.query;
    const appDateWhereSql = await getReportDateWhereSql(filter, "sh.LastSettlementDate", date, startDate, endDate);
    const legacyDateWhereSql = await getReportDateWhereSql(filter, "ri.InvoiceDate", date, startDate, endDate);
    const roDateWhereSql = await getReportDateWhereSql(filter, "ro.start_date", date, startDate, endDate);
    console.log(`[REPORT API] type=dish filter=${filter} date=${date || 'today'} range=${startDate || ''}..${endDate || ''}`);

    // Fetch takeaway charges configuration to avoid SQL subqueries within aggregation functions
    const companySettingsResult = await pool.request().query("SELECT TOP 1 ISNULL(TakeawayCharges, 0) AS TakeawayCharges FROM CompanySettings");
    const defaultTakeawayCharge = companySettingsResult.recordset[0]?.TakeawayCharges ?? 0;

    const result = await pool.request().query(`
        WITH AppReport AS (
          SELECT
            ISNULL(NULLIF(LTRIM(RTRIM(sid.DishName)), ''), ISNULL(d.Name, 'Unknown')) AS dishName,
            ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')) AS categoryName,
            ISNULL(NULLIF(LTRIM(RTRIM(sid.SubCategoryName)), ''), ISNULL(dg.DishGroupName, 'Unmapped')) AS subCategoryName,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') = 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN 
              CAST(CASE 
                WHEN sid.DiscountType = 'percentage' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) * (ISNULL(sid.DiscountAmount, 0) / 100.0)
                WHEN sid.DiscountType = 'FOC' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0))
                ELSE ISNULL(sid.Qty, 0) * (CASE WHEN ISNULL(sid.DiscountAmount, 0) > ISNULL(sid.Price, 0) THEN ISNULL(sid.Price, 0) ELSE ISNULL(sid.DiscountAmount, 0) END)
              END AS decimal(18, 2)) ELSE 0 END) AS discountAmount,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN 
              CAST((ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) - (CASE 
                WHEN sid.DiscountType = 'percentage' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) * (ISNULL(sid.DiscountAmount, 0) / 100.0)
                WHEN sid.DiscountType = 'FOC' THEN (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0))
                ELSE ISNULL(sid.Qty, 0) * (CASE WHEN ISNULL(sid.DiscountAmount, 0) > ISNULL(sid.Price, 0) THEN ISNULL(sid.Price, 0) ELSE ISNULL(sid.DiscountAmount, 0) END)
              END) AS decimal(18, 2)) ELSE 0 END) AS totalAmount,
            SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' AND ISNULL(rod.isTakeAway, 0) = 1 THEN 
              CAST(ISNULL(sid.Qty, 0) * CASE WHEN ISNULL(d.TakeawayCharge, 0) > 0 THEN d.TakeawayCharge ELSE ${defaultTakeawayCharge} END AS decimal(18, 2))
              ELSE 0 END) AS takeawayCharge
          FROM SettlementHeader sh
          INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
          LEFT JOIN RestaurantOrderDetail rod ON sid.OrderDetailId = rod.OrderDetailId
          LEFT JOIN DishMaster d ON sid.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON COALESCE(sid.DishGroupId, d.DishGroupId) = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON COALESCE(sid.CategoryId, dg.CategoryId) = cm.CategoryId
          WHERE ${appDateWhereSql} AND ISNULL(sh.IsCancelled, 0) = 0
            AND EXISTS (SELECT 1 FROM SettlementTotalSales WHERE SettlementID = sh.SettlementID)
          GROUP BY 
            ISNULL(NULLIF(LTRIM(RTRIM(sid.DishName)), ''), ISNULL(d.Name, 'Unknown')), 
            ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')), 
            ISNULL(NULLIF(LTRIM(RTRIM(sid.SubCategoryName)), ''), ISNULL(dg.DishGroupName, 'Unmapped'))
        ),
        LegacyReport AS (
          SELECT
            ISNULL(d.Name, 'Unknown') AS dishName,
            ISNULL(cm.CategoryName, 'Unmapped') AS categoryName,
            ISNULL(dg.DishGroupName, 'Unmapped') AS subCategoryName,
            SUM(CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3))) AS totalQty,
            CAST(0 AS decimal(18, 3)) AS voidQty,
            CAST(0 AS decimal(18, 2)) AS discountAmount,
            SUM(CAST(ISNULL(rod.TotalDetailLineAmount, 0) AS decimal(18, 2))) AS totalAmount,
            SUM(CASE WHEN ISNULL(rod.isTakeAway, 0) = 1 THEN 
              CAST(ISNULL(rod.Quantity, 0) * CASE WHEN ISNULL(d.TakeawayCharge, 0) > 0 THEN d.TakeawayCharge ELSE ${defaultTakeawayCharge} END AS decimal(18, 2))
              ELSE 0 END) AS takeawayCharge
          FROM RestaurantOrderDetail rod
          INNER JOIN (
            SELECT OrderId, RestaurantBillId, InvoiceDate, start_date 
            FROM (
              SELECT OrderId, RestaurantBillId, InvoiceDate, CreatedOn, start_date, ROW_NUMBER() OVER (PARTITION BY OrderId ORDER BY CreatedOn DESC) as rn
              FROM (
                SELECT OrderId, RestaurantBillId, InvoiceDate, CreatedOn, start_date FROM RestaurantInvoice WHERE StatusCode = 5
                UNION ALL
                SELECT OrderId, RestaurantBillId, InvoiceDate, CreatedOn, start_date FROM RestaurantInvoicecur WHERE StatusCode = 5
              ) CombinedInvoices
            ) DeduplicatedInvoices
            WHERE rn = 1
          ) ri ON rod.OrderId = ri.OrderId
          LEFT JOIN DishMaster d ON rod.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
          WHERE ${legacyDateWhereSql}
            AND NOT EXISTS (
              SELECT 1 FROM SettlementHeader sh_dup 
              WHERE sh_dup.SettlementID = ri.RestaurantBillId
            )
          GROUP BY 
            ISNULL(d.Name, 'Unknown'), 
            ISNULL(cm.CategoryName, 'Unmapped'), 
            ISNULL(dg.DishGroupName, 'Unmapped')
        ),
        ProfessionalReport AS (
          SELECT
            ISNULL(rod.DishName, 'Unknown') AS dishName,
            ISNULL(cm.CategoryName, 'Unmapped') AS categoryName,
            ISNULL(dg.DishGroupName, 'Unmapped') AS subCategoryName,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
            SUM(CASE WHEN rod.StatusCode = 0 THEN CAST(ISNULL(rod.Quantity, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
            CAST(0 AS decimal(18, 2)) AS discountAmount,
            SUM(CASE WHEN rod.StatusCode <> 0 THEN CAST(ISNULL(rod.TotalDetailLineAmount, 0) AS decimal(18, 2)) ELSE 0 END) AS totalAmount,
            SUM(CASE WHEN rod.StatusCode <> 0 AND ISNULL(rod.isTakeAway, 0) = 1 THEN 
              CAST(ISNULL(rod.Quantity, 0) * CASE WHEN ISNULL(d.TakeawayCharge, 0) > 0 THEN d.TakeawayCharge ELSE ${defaultTakeawayCharge} END AS decimal(18, 2))
              ELSE 0 END) AS takeawayCharge
          FROM RestaurantOrderDetail rod
          INNER JOIN RestaurantOrder ro ON rod.OrderId = ro.OrderId
          LEFT JOIN DishMaster d ON rod.DishId = d.DishId
          LEFT JOIN DishGroupMaster dg ON d.DishGroupId = dg.DishGroupId
          LEFT JOIN CategoryMaster cm ON dg.CategoryId = cm.CategoryId
          WHERE ${roDateWhereSql}
            AND ISNULL(ro.StatusCode, 0) = 3
            AND NOT EXISTS (
              SELECT 1 FROM SettlementHeader sh_dup 
              WHERE sh_dup.BillNo = ro.OrderNumber
            )
          GROUP BY 
            ISNULL(rod.DishName, 'Unknown'), 
            ISNULL(cm.CategoryName, 'Unmapped'), 
            ISNULL(dg.DishGroupName, 'Unmapped')
        )
        SELECT dishName, categoryName, subCategoryName, SUM(totalQty) AS totalQty, SUM(voidQty) AS voidQty, SUM(discountAmount) AS discountAmount, SUM(totalAmount) AS totalAmount, SUM(takeawayCharge) AS takeawayCharge
        FROM (
          SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(subCategoryName AS NVARCHAR(255)) AS subCategoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount, CAST(takeawayCharge AS decimal(18,2)) AS takeawayCharge FROM AppReport
          UNION ALL
          SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(subCategoryName AS NVARCHAR(255)) AS subCategoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount, CAST(takeawayCharge AS decimal(18,2)) AS takeawayCharge FROM LegacyReport
          UNION ALL
          SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(subCategoryName AS NVARCHAR(255)) AS subCategoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount, CAST(takeawayCharge AS decimal(18,2)) AS takeawayCharge FROM ProfessionalReport
        ) ReportRows
        GROUP BY dishName, categoryName, subCategoryName
        HAVING SUM(totalQty) > 0 OR SUM(totalAmount) > 0 OR SUM(voidQty) > 0
        ORDER BY totalAmount DESC, totalQty DESC, dishName ASC
      `);

    console.log(`[REPORT API] type=dish filter=${filter} rows=${result.recordset.length}`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] dish error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/settlement", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const pool = await poolPromise;
    const filter = req.query.filter || "daily";
    const date = req.query.date;
    const { startDate, endDate } = req.query;

    const appDateWhereSql = await getReportDateWhereSql(filter, "sh.LastSettlementDate", date, startDate, endDate);
    
    const result = await pool.request().query(`
      WITH StandardSettlements AS (
        SELECT 
          UPPER(LTRIM(RTRIM(ISNULL(
            (SELECT TOP 1 LTRIM(RTRIM(pm.Description)) 
             FROM Paymode pm 
             WHERE LTRIM(RTRIM(pm.PayMode)) = LTRIM(RTRIM(sd.PayMode)) 
                OR LTRIM(RTRIM(pm.Description)) = LTRIM(RTRIM(sd.PayMode))
                OR CAST(pm.Position AS NVARCHAR(10)) = LTRIM(RTRIM(sd.PayMode))
            ), 
            CASE 
              WHEN LTRIM(RTRIM(sd.PayMode)) = '2' THEN 'NETS'
              WHEN LTRIM(RTRIM(sd.PayMode)) = '3' THEN 'PAYNOW'
              WHEN LTRIM(RTRIM(sd.PayMode)) = '4' THEN 'FOC'
              ELSE LTRIM(RTRIM(ISNULL(sd.PayMode, 'CASH')))
            END
          )))) as Paymode,
          SUM(ISNULL(sd.SysAmount, 0)) as SysAmount,
          SUM(ISNULL(sd.ManualAmount, 0)) as ManualAmount,
          SUM(ISNULL(sd.AmountDiff, 0)) as SortageOrExces,
          CAST(SUM(ISNULL(sd.ReceiptCount, 0)) AS INT) as ReceiptCount
        FROM SettlementHeader sh
        INNER JOIN SettlementTotalSales sd ON sh.SettlementID = sd.SettlementID
        WHERE ${appDateWhereSql}
        GROUP BY sd.PayMode
      ),
      LedgerPayments AS (
        SELECT 
          CASE WHEN mm.MemberId IS NOT NULL THEN 'MEMBER' ELSE 'CREDIT' END + ' PAYMENT (' + UPPER(ISNULL(pm.Description, 'CASH')) + ')' AS Paymode,
          SUM(ptd.Amount) AS SysAmount,
          SUM(ptd.Amount) AS ManualAmount,
          0 AS SortageOrExces,
          COUNT(*) AS ReceiptCount
        FROM PaymentTransactionDetails ptd
        INNER JOIN Paymode pm ON pm.Position = ptd.PayModeId
        LEFT JOIN MemberMaster mm ON ptd.ReferenceId = mm.MemberId
        WHERE ptd.ReferenceType = 'MEMBER'
          AND ${appDateWhereSql.replace(/sh\.LastSettlementDate/g, 'ptd.CreatedDate').replace(/sh\.start_date/g, 'ptd.CreatedDate')}
        GROUP BY mm.MemberId, pm.Description
      )
      SELECT Paymode, SUM(SysAmount) as SysAmount, SUM(ManualAmount) as ManualAmount, SUM(SortageOrExces) as SortageOrExces, SUM(ReceiptCount) as ReceiptCount
      FROM (
        SELECT Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount FROM StandardSettlements
        UNION ALL
        SELECT Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount FROM LedgerPayments
      ) Combined
      GROUP BY Paymode
      ORDER BY SysAmount DESC
    `);

    console.log(`[REPORT API] type=settlement filter=${filter} rows=${result.recordset.length}`);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] settlement error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/artist-target", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        a.Id,
        a.CustomerName,
        a.FromDate,
        a.ToDate,
        COALESCE(a.TargetAmount, a.Amount, 0) AS TargetAmount,
        COALESCE(a.TargetAmount, a.Amount, 0) AS Amount, -- Backward compatibility for frontend
        ISNULL(sales.Achieved, 0) AS Achieved,
        CASE 
          WHEN COALESCE(a.TargetAmount, a.Amount, 0) - ISNULL(sales.Achieved, 0) > 0 
          THEN COALESCE(a.TargetAmount, a.Amount, 0) - ISNULL(sales.Achieved, 0)
          ELSE 0 
        END AS [Left],
        CASE 
          WHEN ISNULL(sales.Achieved, 0) >= COALESCE(a.TargetAmount, a.Amount, 0) 
          THEN 'Achieved'
          ELSE 'Not Achieved'
        END AS [Status],
        a.CreatedDate
      FROM dishOrderItemShare a
      OUTER APPLY (
        SELECT SUM(CAST(ISNULL(b.Qty, 0) * ISNULL(b.Price, 0) AS decimal(18,2))) AS Achieved
        FROM settlementitemdetail b
        INNER JOIN SettlementHeader sh ON b.SettlementID = sh.SettlementID
        WHERE (b.DishId = a.DishId OR (a.DishId IS NULL AND b.DishName = a.CustomerName))
          AND sh.IsCancelled = 0
          AND ISNULL(b.Status, 'NORMAL') <> 'VOIDED'
          AND b.OrderDateTime >= CAST(a.FromDate AS DATETIME)
          AND b.OrderDateTime < DATEADD(DAY, 1, CAST(a.ToDate AS DATETIME))
      ) sales
      ORDER BY a.CreatedDate DESC, a.CustomerName ASC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[REPORT API] artist-target error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Day End Summary
router.get("/day-end-summary", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const today = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().split("T")[0];
    
    // Default to today if no dates provided
    const start = startDate || today;
    const end = endDate || today;
    
    const whereSql = getReportDateWhereSqlForRange(start, end, "sh.LastSettlementDate");
    const ptdWhereSql = getReportDateWhereSqlForRange(start, end, "ptd.CreatedDate");

    console.log(`[DAY-END DEBUG] Fetching summary from ${start} to ${end}. SQL filter: ${whereSql}`);
    
    const pool = await poolPromise;

    // 0. Organization Info (from CompanySettings)
    const companySettings = await getCompanySettings();
    const orgInfo = {
      Name: companySettings?.CompanyName || 'AL-HAZIMA RESTAURANT PTE LTD',
      Address1_Line1: companySettings?.Address || 'No 4, Cheong Chin Nam Road, SINGAPORE 599729',
      Address1_Telephone1: companySettings?.Phone || '65130000'
    };

    // A. Paymode Detail (Aggregate all settlements in range)
    const paymodeRes = await pool.request()
      .query(`
        SELECT 
          Paymode,
          SUM(Amount) as Amount,
          SUM(Count) as Count
        FROM (
          SELECT 
            UPPER(LTRIM(RTRIM(ISNULL(
              (SELECT TOP 1 LTRIM(RTRIM(pm.Description)) 
               FROM Paymode pm 
               WHERE LTRIM(RTRIM(pm.PayMode)) = LTRIM(RTRIM(sd.PayMode)) 
                  OR LTRIM(RTRIM(pm.Description)) = LTRIM(RTRIM(sd.PayMode))
                  OR CAST(pm.Position AS NVARCHAR(10)) = LTRIM(RTRIM(sd.PayMode))
              ), 
              CASE 
                WHEN LTRIM(RTRIM(sd.PayMode)) = '2' THEN 'NETS'
                WHEN LTRIM(RTRIM(sd.PayMode)) = '3' THEN 'PAYNOW'
                WHEN LTRIM(RTRIM(sd.PayMode)) = '4' THEN 'FOC'
                ELSE LTRIM(RTRIM(ISNULL(sd.PayMode, 'CASH')))
              END
            )))) as Paymode,
            ISNULL(sd.SysAmount, 0) as Amount,
            1 as Count
          FROM SettlementHeader sh
          INNER JOIN SettlementTotalSales sd ON sh.SettlementID = sd.SettlementID
          WHERE ${whereSql}
        ) RawData
        GROUP BY Paymode
      `);

    const paymodes = paymodeRes.recordset;
    console.log(`[DAY-END DEBUG] Found ${paymodes.length} paymode records`);
    console.log(`[DAY-END DEBUG] Paymodes:`, JSON.stringify(paymodes));

    // B. Detailed Sales Analysis & Void Detail
    const analysisRes = await pool.request()
      .query(`
        SELECT 
          SUM(ISNULL(sh.SubTotal, 0)) as BaseSales,
          SUM(ISNULL(sh.SysAmount, 0)) as TotalSales,
          SUM(ISNULL(sh.TotalTax, 0)) as TotalTax,
          SUM(ISNULL(sh.DiscountAmount, 0)) as TotalDiscount,
          SUM(ISNULL(sh.ServiceCharge, 0)) as TotalServiceCharge,
          SUM(ISNULL(sh.RoundedBy, 0)) as TotalRoundOff,
          SUM(ISNULL(sh.TakeawayCharge, 0)) as TotalTakeawayCharge,
          COUNT(sh.SettlementID) as TotalBills,
          SUM(ISNULL(sh.VoidItemQty, 0)) as VoidQty,
          SUM(ISNULL(sh.VoidItemAmount, 0)) as VoidAmount,
          SUM(CASE WHEN sh.IsCancelled = 1 THEN 1 ELSE 0 END) as CancelledCount,
          SUM(CASE WHEN sh.IsCancelled = 1 THEN ISNULL(sh.VoidItemAmount, 0) ELSE 0 END) as CancelledAmount,
          MAX(sh.TerminalCode) as TerminalCode,
          MAX(sh.RefNo) as RefNo
        FROM SettlementHeader sh
        WHERE ${whereSql}
      `);
 
    const analysis = analysisRes.recordset[0] || { 
      BaseSales: 0, TotalSales: 0, TotalTax: 0, TotalDiscount: 0, TotalServiceCharge: 0, 
      TotalRoundOff: 0, TotalTakeawayCharge: 0, TotalBills: 0, VoidQty: 0, VoidAmount: 0
    };

    const totalSales = analysis.TotalSales || 0;
    const detailTotal = paymodes.reduce((acc, curr) => acc + (Number(curr.Amount) || 0), 0);
    const diff = totalSales - detailTotal;
    console.log(`[DAY-END DEBUG] Analysis:`, JSON.stringify(analysis));
    console.log(`[DAY-END DEBUG] totalSales: ${totalSales}, detailTotal: ${detailTotal}, diff: ${diff}`);

    // If there's a real discrepancy, surface it explicitly as "Unknown / Unrecorded"
    // and log the offending SettlementHeader rows for deeper inspection.
    if (Math.abs(diff) > 0.05) {
      const unrecordedRes = await pool.request()
        .query(`
          SELECT TOP 50
            sh.SettlementID,
            sh.LastSettlementDate,
            sh.SysAmount,
            sh.TotalTax,
            sh.SubTotal,
            sh.DiscountAmount,
            sh.ServiceCharge,
            sh.RoundedBy
          FROM SettlementHeader sh 
          WHERE ${whereSql}
            AND NOT EXISTS (SELECT 1 FROM SettlementTotalSales sd WHERE sd.SettlementID = sh.SettlementID)
          ORDER BY sh.LastSettlementDate DESC
        `);

      const unrecordedCount = unrecordedRes.recordset.length;
      if (unrecordedCount > 0) {
        console.warn(
          "[DAY-END SUMMARY] Detected settlements without SettlementTotalSales rows.",
          {
            start,
            end,
            totalSales,
            detailTotal,
            diff,
            unrecordedCount,
            sampleSettlementIds: unrecordedRes.recordset
              .slice(0, 10)
              .map((r) => r.SettlementID),
          }
        );

        paymodes.push({
          Paymode: "Unknown / Unrecorded",
          Amount: diff,
          Count: unrecordedCount,
        });
      } else {
        console.warn(
          "[DAY-END SUMMARY] Total/Paymode mismatch with no header rows missing details.",
          { start, end, totalSales, detailTotal, diff }
        );
      }
    }

    // Fetch Credit Customer Payments (ReferenceType = 'MEMBER')
    const creditPaymentsRes = await pool.request()
      .query(`
        WITH RawCollections AS (
          SELECT 
            CASE 
              WHEN cct.CustomerType = 'CREDIT' THEN 'CREDIT'
              WHEN cct.CustomerType = 'MEMBER' THEN 'MEMBER'
              WHEN ccm.CustomerId IS NOT NULL THEN 'CREDIT'
              WHEN mm.MemberId IS NOT NULL THEN 'MEMBER'
              ELSE 'CREDIT'
            END AS CustomerType,
            UPPER(ISNULL(pm.Description, 'CASH')) AS PaymodeName,
            ptd.Amount
          FROM PaymentTransactionDetails ptd
          INNER JOIN Paymode pm ON pm.Position = ptd.PayModeId
          LEFT JOIN CustomerCreditTransactions cct ON ptd.ReferenceId = cct.TransactionId
          LEFT JOIN CreditCustomerMaster ccm ON (ptd.ReferenceId = ccm.CustomerId OR cct.MemberId = ccm.CustomerId)
          LEFT JOIN MemberMaster mm ON (ptd.ReferenceId = mm.MemberId OR cct.MemberId = mm.MemberId)
          WHERE ptd.ReferenceType = 'MEMBER'
            AND ${ptdWhereSql}
        )
        SELECT 
          CustomerType + ' PAYMENT (' + PaymodeName + ')' AS Paymode,
          SUM(Amount) AS Amount,
          COUNT(*) AS Count
        FROM RawCollections
        GROUP BY CustomerType, PaymodeName
      `);

    const creditPayments = creditPaymentsRes.recordset || [];
    creditPayments.forEach(p => {
      p.ReceiptCount = p.Count;
    });

    paymodes.push(...creditPayments);

    const cashTotal = paymodes.filter(p => {
      const mode = String(p.Paymode).toUpperCase();
      return mode === 'CASH' || mode === 'CREDIT PAYMENT (CASH)' || mode === 'MEMBER PAYMENT (CASH)';
    }).reduce((acc, curr) => acc + (Number(curr.Amount) || 0), 0);

    const focTotal = paymodes.filter(p => {
      const mode = String(p.Paymode).toUpperCase();
      return mode === 'FOC';
    }).reduce((acc, curr) => acc + (Number(curr.Amount) || 0), 0);

    const otherTotal = paymodes.filter(p => {
      const mode = String(p.Paymode).toUpperCase();
      return mode !== 'CASH' && mode !== 'CREDIT PAYMENT (CASH)' && mode !== 'MEMBER PAYMENT (CASH)' && mode !== 'FOC';
    }).reduce((acc, curr) => acc + (Number(curr.Amount) || 0), 0);

    const billCount = Number(analysis.TotalBills) || 0;
    console.log(`[DAY-END DEBUG] billCount: ${billCount}`);
    
    // C. Settlement Paymode Breakdown
    console.log(`[DAY-END DEBUG] Fetching settlement breakdown...`);
    const settlementRes = await pool.request()
      .query(`
        SELECT 
          ISNULL((SELECT TOP 1 LTRIM(RTRIM(Description)) FROM Paymode pm WHERE LTRIM(RTRIM(pm.PayMode)) = LTRIM(RTRIM(sd.Paymode))), sd.Paymode) as Paymode,
          SUM(ISNULL(sd.SysAmount, 0)) as SysAmount,
          SUM(ISNULL(sd.ManualAmount, 0)) as ManualAmount,
          SUM(ISNULL(sd.SortageOrExces, 0)) as SortageOrExces,
          CAST(SUM(ISNULL(sd.ReceiptCount, 0)) AS INT) as ReceiptCount
        FROM SettlementHeader sh
        INNER JOIN SettlementDetail sd ON sh.SettlementID = sd.SettlementId
        WHERE ${whereSql}
        GROUP BY sd.Paymode
        ORDER BY SysAmount DESC
      `);

    // D. Cancelled Orders List
    const cancelledOrdersRes = await pool.request()
      .query(`
        SELECT 
          sh.BillNo, 
          sh.CancellationReason, 
          sh.CancelledDate, 
          sh.CancelledByUserName,
          sh.SubTotal as OriginalAmount,
          sh.VoidItemQty
        FROM SettlementHeader sh
        WHERE ${whereSql}
          AND sh.IsCancelled = 1
        ORDER BY sh.LastSettlementDate DESC
      `);

    const settlementBreakdown = settlementRes.recordset || [];
    creditPayments.forEach(cp => {
      settlementBreakdown.push({
        Paymode: cp.Paymode,
        SysAmount: cp.Amount,
        ManualAmount: cp.Amount,
        SortageOrExces: 0,
        ReceiptCount: cp.Count
      });
    });

    res.json({
      success: true,
      orgInfo,
      terminalCode: analysis.TerminalCode,
      refNo: analysis.RefNo,
      paymodeDetail: paymodes,
      settlementBreakdown: settlementBreakdown,
      cancelledOrders: cancelledOrdersRes.recordset,
      settlementDetail: {
        cashTotal,
        otherTotal,
        focTotal
      },
      salesAnalysis: {
        baseSales: analysis.BaseSales || 0,
        totalSales,
        focSales: focTotal,
        totalTax: analysis.TotalTax || 0,
        totalDiscount: analysis.TotalDiscount || 0,
        totalServiceCharge: analysis.TotalServiceCharge || 0,
        takeawayCharge: analysis.TotalTakeawayCharge || 0,
        roundOff: analysis.TotalRoundOff || 0,
        netTotal: totalSales, 
        billCount,
        avgPerBill: billCount > 0 ? (totalSales / billCount) : 0
      },
      voidDetail: {
        voidQty: analysis.VoidQty || 0,
        voidAmount: analysis.VoidAmount || 0
      },
      cancelledDetail: {
        count: analysis.CancelledCount || 0,
        amount: analysis.CancelledAmount || 0
      }
    });
  } catch (err) {
    console.error("[DAY-END SUMMARY ERROR]", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

router.get("/daily/:date", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { date } = req.params;
    const startOfDay = `${date} 00:00:00`;
    const endOfDay = `${date} 23:59:59`;

    const result = await pool.request()
      .input("StartOfDay", sql.DateTime, startOfDay)
      .input("EndOfDay", sql.DateTime, endOfDay).query(`
        WITH NormalizedSales AS (
          SELECT sh.SettlementID, ISNULL(sts.SysAmount, sh.SysAmount) AS SysAmount, ISNULL(sts.ReceiptCount, 0) AS ReceiptCount,
          ${normalizeReportPayModeSql("sts.PayMode")} AS PayMode
          FROM SettlementHeader sh
          LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
          WHERE sh.LastSettlementDate BETWEEN @StartOfDay AND @EndOfDay
        )
        SELECT COUNT(DISTINCT SettlementID) as TotalTransactions, ISNULL(SUM(SysAmount), 0) as TotalSales,
        ISNULL(SUM(CASE WHEN PayMode = 'CASH' THEN SysAmount ELSE 0 END), 0) as CashSales,
        ISNULL(SUM(CASE WHEN PayMode = 'NETS' THEN SysAmount ELSE 0 END), 0) as NETS_Sales,
        ISNULL(SUM(CASE WHEN PayMode = 'PAYNOW' THEN SysAmount ELSE 0 END), 0) as PayNow_Sales,
        ISNULL(SUM(CASE WHEN PayMode = 'UPI' THEN SysAmount ELSE 0 END), 0) as UPI_Sales,
        ISNULL(SUM(CASE WHEN PayMode = 'CARD' THEN SysAmount ELSE 0 END), 0) as CardSales,
        ISNULL(SUM(CASE WHEN PayMode = 'CREDIT' OR PayMode = 'MEMBER' THEN SysAmount ELSE 0 END), 0) as MemberSales,
        ISNULL(SUM(ReceiptCount), 0) as TotalItems
        FROM NormalizedSales
      `);
    res.json(result.recordset[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/daily-order-count", async (req, res) => {
  try {
    const pool = await poolPromise;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const result = await pool.request()
      .input("Start", sql.DateTime, startOfDay)
      .input("End", sql.DateTime, endOfDay)
      .query(`
        SELECT COUNT(SettlementID) as currentCount 
        FROM SettlementHeader 
        WHERE LastSettlementDate BETWEEN @Start AND @End
      `);
    
    const count = result.recordset[0].currentCount || 0;
    res.json({ nextNumber: count + 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= SAVE SALE ================= */
router.post("/save", async (req, res) => {
  try {
    const pool = await poolPromise;

    // Day Start / Day End validation check
    const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    if (activeDayRes.recordset.length === 0) {
      return res.status(400).json({ error: "No active business date. Please Start Day first." });
    }
    const activeStartDate = activeDayRes.recordset[0].StartDate;
    const formattedStartDate = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : activeStartDate;

    // Frontend already calculates the discounted totalAmount and discountAmount, so no additional calculation is needed here.

    const {
      settlementId: clientSettlementId,
      totalAmount, paymentMethod, items, subTotal, taxAmount,
      discountAmount, discountType, roundOff, orderId, orderType, tableNo, section, memberId, cashierId, tableId,
      serverId, serverName, isSplit,
      discountId, discountPercentage, discountRemarks, orderDiscountAmount, itemDiscountAmount, payments,
      rewardMemberId
    } = req.body;

    const isSplitParsed = (isSplit === true || isSplit === "true" || isSplit === 1 || isSplit === "1");

    const validationError = validateSalePayload({ totalAmount, paymentMethod, items, payments });
    if (validationError) {
      console.warn(`[SAVE SALE] Validation failed: ${validationError}`);
      return res.status(400).json({ error: validationError });
    }

    // 1. Idempotency Check: Verify if this settlement already exists
    if (clientSettlementId) {
      const existingCheck = await pool.request()
        .input("Sid", sql.UniqueIdentifier, clientSettlementId)
        .query("SELECT SettlementID, BillNo FROM SettlementHeader WHERE SettlementID = @Sid");
      if (existingCheck.recordset.length > 0) {
        const existing = existingCheck.recordset[0];
        console.log(`[SAVE SALE] Duplicate request detected. Settlement ${clientSettlementId} already exists.`);
        return res.json({ success: true, settlementId: existing.SettlementID, billNo: existing.BillNo, orderId: existing.BillNo });
      }
    }

    // 2. Fast Fallback check for non-split payments using orderId
    if (orderId && !isSplitParsed) {
      const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
      const reqCheck = pool.request().input("OrderId", sql.NVarChar(100), orderId);
      let queryStr = "";
      if (isGuid) {
        reqCheck.input("OrderGuid", sql.UniqueIdentifier, orderId);
        queryStr = `
          SELECT TOP 1 sh.SettlementID, sh.BillNo 
          FROM SettlementHeader sh WITH (NOLOCK)
          LEFT JOIN RestaurantInvoice ri WITH (NOLOCK) ON sh.SettlementID = ri.RestaurantBillId
          WHERE (sh.BillNo = @OrderId OR ri.OrderId = @OrderGuid)
            AND NOT EXISTS (
              SELECT 1 FROM RestaurantOrderCur roc WITH (NOLOCK)
              WHERE roc.OrderId = @OrderGuid AND roc.isOrderClosed = 0
            )
        `;
      } else {
        queryStr = `
          SELECT TOP 1 sh.SettlementID, sh.BillNo 
          FROM SettlementHeader sh WITH (NOLOCK)
          WHERE sh.BillNo = @OrderId
            AND NOT EXISTS (
              SELECT 1 FROM RestaurantOrderCur roc WITH (NOLOCK)
              WHERE roc.OrderNumber = @OrderId AND roc.isOrderClosed = 0
            )
        `;
      }
      const existingCheck = await reqCheck.query(queryStr);
      if (existingCheck.recordset.length > 0) {
        const existing = existingCheck.recordset[0];
        console.log(`[SAVE SALE] Duplicate check matched by OrderId! Settlement already exists for order ${orderId}. BillNo: ${existing.BillNo}`);
        return res.json({ success: true, settlementId: existing.SettlementID, billNo: existing.BillNo, orderId: orderId });
      }
    }

    let isMemberPayment = false;
    let settlementId;
    let displayOrderId = null;
    let guidOrderId;
    let activePaymodes = [];
    let customerType = null;
    let customerRecord = null;
    let finalBillNo = null;
    let hasRemaining = false;

    await runInTransaction(async (transaction) => {
      const validCashierGuid = await resolveCashierUserId(transaction, cashierId);

      if (clientSettlementId) {
        settlementId = clientSettlementId;
      } else {
        const settlementIdResult = await transaction.request().query(`SELECT NEWID() AS id`);
        settlementId = settlementIdResult.recordset[0].id;
      }
      let billNo = ""; // Will be set to displayOrderId later

      const paymodesRes = await transaction.request().query("SELECT Position, PayMode, Description FROM [dbo].[Paymode] WHERE Active = 1");
      activePaymodes = paymodesRes.recordset || [];

      const activeOrg = await getActiveOrganization();
      const businessUnitId = activeOrg.businessUnitId;

      // 🆕 MEMBER / CREDIT LOOKUP & VALIDATION
      if (memberId) {
        const creditCheck = await transaction.request()
          .input("CustomerId", sql.UniqueIdentifier, memberId)
          .query("SELECT CreditLimit, CurrentBalance, IsActive FROM CreditCustomerMaster WITH (UPDLOCK) WHERE CustomerId = @CustomerId");
        const creditCustomer = creditCheck.recordset[0];

        const memberCheck = await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, memberId)
          .query("SELECT CreditLimit, CurrentBalance, IsActive FROM MemberMaster WITH (UPDLOCK) WHERE MemberId = @MemberId");
        const memberCustomer = memberCheck.recordset[0];

        if (creditCustomer && memberCustomer) {
          throw new Error(`Customer ${memberId} exists in both MemberMaster and CreditCustomerMaster`);
        } else if (creditCustomer) {
          customerType = "CREDIT";
          customerRecord = creditCustomer;
        } else if (memberCustomer) {
          customerType = "MEMBER";
          customerRecord = memberCustomer;
        } else {
          throw new Error(`Customer ${memberId} not found`);
        }

        console.log(`[SAVE SALE DIAGNOSTIC] Customer lookup: memberId=${memberId}, customerType=${customerType}`);
      }

      // Calculate creditAmount across single and split payments
      const unifiedPayments = (payments && Array.isArray(payments) && payments.length > 0)
        ? payments.map(p => {
            const pmInfo = activePaymodes.find(x => 
              x.Position === Number(p.payModeId) || 
              String(x.PayMode).trim().toUpperCase() === String(p.payModeId || p.payMode || p.PaymentMethod || "").trim().toUpperCase()
            );
            const pmName = pmInfo ? String(pmInfo.PayMode).trim() : String(p.payMode || p.PaymentMethod || "CASH").trim();
            return {
              PaymentMethod: pmName,
              Amount: p.amount || p.Amount || 0
            };
          })
        : [{
            PaymentMethod: String(paymentMethod || "CASH").trim(),
            Amount: totalAmount || 0
          }];

      const memberAmount = unifiedPayments
        .filter(p => String(p.PaymentMethod || "").trim().toUpperCase() === "MEMBER")
        .reduce((sum, p) => sum + Number(p.Amount || 0), 0);

      const creditAmount = unifiedPayments
        .filter(p => String(p.PaymentMethod || "").trim().toUpperCase() === "CREDIT")
        .reduce((sum, p) => sum + Number(p.Amount || 0), 0);

      const totalCreditAndMember = memberAmount + creditAmount;
      const finalMemberAmount = customerType === "CREDIT" ? 0 : memberAmount;
      const finalCreditAmount = customerType === "CREDIT" ? totalCreditAndMember : creditAmount;

      if (totalCreditAndMember > 0) {
        if (!memberId) {
          throw new Error("Customer/Member selection is required for credit transactions");
        }
        if (!customerRecord) {
          throw new Error(`Customer ${memberId} not found`);
        }
        if (!customerRecord.IsActive) {
          throw new Error(customerType === "CREDIT" ? "Credit Customer is inactive" : "Member is inactive");
        }

        const currentBalance = Number(customerRecord.CurrentBalance || 0);
        const creditLimit = Number(customerRecord.CreditLimit || 0);
        const projectedBalance = currentBalance + totalCreditAndMember;

        console.log(`[SAVE SALE DIAGNOSTIC] Validation: memberId=${memberId}, customerType=${customerType}, totalCreditAndMember=${totalCreditAndMember}, oldBalance=${currentBalance}, projectedBalance=${projectedBalance}`);

        if (projectedBalance > creditLimit) {
          throw new Error("Credit limit exceeded");
        }
      }

    // 2. Order ID Retrieval
    const now = new Date();
    displayOrderId = null;
    let dailySequence = 0;

    let tablePax = null;
    let tableCustomerName = null;
    let orderPax = null;
    let orderCustomerName = null;
    let orderMobileNo = null;

    const cleanTableId = toGuidOrNull(tableId);
    if (cleanTableId) {
        const tableCheck = await transaction.request()
            .input("tid", sql.UniqueIdentifier, cleanTableId)
            .query("SELECT CurrentOrderId, Pax, CustomerName FROM TableMaster WITH (UPDLOCK) WHERE TableId = @tid");
        displayOrderId = tableCheck.recordset[0]?.CurrentOrderId;
        tablePax = tableCheck.recordset[0]?.Pax;
        tableCustomerName = tableCheck.recordset[0]?.CustomerName;
        
        if (displayOrderId && displayOrderId.includes('-')) {
            dailySequence = parseInt(displayOrderId.split('-')[1]) || 0;
        }
    }

    if (!displayOrderId) {
        // Fallback: Generate a new one if none exists (e.g., takeaway or direct pay)
        const todayStr = new Date().toLocaleDateString('en-CA'); 
        
        let seqResult = await transaction.request()
            .input("RestId", sql.UniqueIdentifier, businessUnitId)
            .input("Today", sql.Date, todayStr)
            .query(`
              UPDATE OrderSequences 
              SET LastNumber = LastNumber + 1 
              OUTPUT INSERTED.LastNumber
              WHERE RestaurantId = @RestId AND SequenceDate = @Today
            `);

        if (seqResult.recordset.length > 0) {
            dailySequence = seqResult.recordset[0].LastNumber;
        } else {
            await transaction.request()
                .input("RestId", sql.UniqueIdentifier, businessUnitId)
                .input("Today", sql.Date, todayStr)
                .query(`
                  INSERT INTO OrderSequences (RestaurantId, SequenceDate, LastNumber)
                  VALUES (@RestId, @Today, 1)
                `);
            dailySequence = 1;
        }
        displayOrderId = `${todayStr.replace(/-/g, '')}-${String(dailySequence).padStart(4, '0')}`;
        console.log(`[SAVE SALE] Generated NEW ID: ${displayOrderId}`);
    } else {
        console.log(`[SAVE SALE] Using EXISTING ID: ${displayOrderId} (Seq: ${dailySequence})`);
    }

    // 2.5 Fetch Voided Items from Professional Detail Tables
    let voidQty = 0;
    let voidAmount = 0;
        const voidRes = await transaction.request()
            .input("orderNo", sql.NVarChar(100), displayOrderId)
            .query(`
                SELECT SUM(d.Quantity) as VQty, SUM(d.TotalDetailLineAmount) as VAmt 
                FROM RestaurantOrderDetailCur d
                JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
                WHERE h.OrderNumber = @orderNo AND d.StatusCode = 0
            `);
        voidQty = voidRes.recordset[0]?.VQty || 0;
        voidAmount = voidRes.recordset[0]?.VAmt || 0;
        console.log(`[SAVE SALE] Voids captured from DB: Qty=${voidQty}, Amt=${voidAmount}`);

        // 🚀 SYNC SYIELD: Fetch Master GUID OrderId, Pax, CustomerName and MobileNo for Relation Integrity
        const guidRes = await transaction.request()
            .input("orderNo", sql.NVarChar(100), displayOrderId)
            .query("SELECT TOP 1 OrderId, Pax, CustomerName, MobileNo, CustomerId FROM RestaurantOrderCur WITH (UPDLOCK) WHERE OrderNumber = @orderNo");
        const guidOrderId = guidRes.recordset[0]?.OrderId || settlementId;
        orderPax = guidRes.recordset[0]?.Pax;
        orderCustomerName = guidRes.recordset[0]?.CustomerName;
        orderMobileNo = guidRes.recordset[0]?.MobileNo;
        const orderCustomerId = guidRes.recordset[0]?.CustomerId;
        console.log(`[SAVE SALE] Master Sync -> GUID OrderId: ${guidOrderId}, orderPax: ${orderPax}, orderCustomerName: ${orderCustomerName}, orderMobileNo: ${orderMobileNo}, orderCustomerId: ${orderCustomerId}`);

     // Split Bill unique bill/invoice suffix generator
    finalBillNo = displayOrderId;
    let splitIndexValue = null;
    if (isSplitParsed) {
       const splitCountResult = await transaction.request()
         .input("OrderId", sql.UniqueIdentifier, guidOrderId)
         .query("SELECT COUNT(*) as count FROM RestaurantInvoice WHERE OrderId = @OrderId");
       const splitCount = splitCountResult.recordset[0].count + 1;
       finalBillNo = `${displayOrderId}-S${splitCount}`;
       splitIndexValue = splitCount;
     }
      console.log(`[SAVE SALE] Final Bill No: ${finalBillNo} (isSplit: ${isSplitParsed || false}, index: ${splitIndexValue || "none"})`);

    // Merge history count retriever
    const mergeCountResult = await transaction.request()
      .input("OrderId", sql.UniqueIdentifier, guidOrderId)
      .query("SELECT COUNT(*) as count FROM OrderMergeHistory WHERE ParentOrderId = @OrderId");
    const childCount = mergeCountResult.recordset[0].count;
    const mergeCount = childCount > 0 ? childCount + 1 : null;
    console.log(`[SAVE SALE] Merge Count: ${mergeCount || "none"} (child count: ${childCount})`);

    const normalizedPayMode = normalizePayMode(paymentMethod);
    const payModeCode = normalizedPayMode === "CASH" ? 1 : normalizedPayMode === "CARD" ? 2 : 3;

    let finalMemberGuid = toGuidOrNull(memberId) || toGuidOrNull(rewardMemberId) || toGuidOrNull(orderCustomerId);
    let effectiveMobile = req.body.mobileNo || req.body.MobileNo || orderMobileNo || null;
    let effectiveGuestName = req.body.customerName ? req.body.customerName.trim().substring(0, 100) : (orderCustomerName || tableCustomerName || null);

    if (!finalMemberGuid && effectiveMobile) {
      try {
        const cleanP = String(effectiveMobile).replace(/\D/g, "");
        const l8 = cleanP.length >= 8 ? cleanP.slice(-8) : cleanP;
        if (l8) {
          const mLookup = await transaction.request()
            .input("l8", sql.NVarChar(50), l8)
            .query("SELECT TOP 1 MemberId FROM MemberMaster WHERE RIGHT(REPLACE(REPLACE(REPLACE(Phone, ' ', ''), '+', ''), '-', ''), 8) = @l8");
          if (mLookup.recordset.length > 0) {
            finalMemberGuid = mLookup.recordset[0].MemberId;
          }
        }
      } catch (mErr) {
        console.warn("[SAVE SALE] Auto member resolution skipped:", mErr.message);
      }
    }

    if (finalMemberGuid && (!effectiveMobile || !effectiveGuestName || effectiveGuestName === "Guest")) {
      try {
        const mInfo = await transaction.request()
          .input("mId", sql.UniqueIdentifier, finalMemberGuid)
          .query("SELECT TOP 1 Name, Phone FROM MemberMaster WHERE MemberId = @mId");
        if (mInfo.recordset.length > 0) {
          if (!effectiveGuestName || effectiveGuestName === "Guest") {
            effectiveGuestName = mInfo.recordset[0].Name || effectiveGuestName;
          }
          if (!effectiveMobile) {
            effectiveMobile = mInfo.recordset[0].Phone || effectiveMobile;
          }
        }
      } catch (mInfoErr) {
        console.warn("[SAVE SALE] Member info auto-lookup error:", mInfoErr.message);
      }
    }

    const headerResult = await transaction.request()
      .input("SettlementID", sql.UniqueIdentifier, settlementId)
      .input("LastSettlementDate", sql.DateTime, now)
      .input("SubTotal", sql.Money, subTotal || 0)
      .input("TotalTax", sql.Money, taxAmount || 0)
      .input("DiscountAmount", sql.Money, (Number(orderDiscountAmount) || 0) + (Number(itemDiscountAmount) || 0))
      .input("DiscountType", sql.NVarChar(50), discountType || "fixed")
      .input("BillNo", sql.NVarChar(50), finalBillNo)
      .input("OrderType", sql.NVarChar(50), orderType || "DINE-IN")
      .input("TableNo", sql.NVarChar(50), tableNo || null)
      .input("Section", sql.NVarChar(100), section || null)
      .input("MemberId", sql.UniqueIdentifier, finalMemberGuid)
      .input("CashierID", sql.UniqueIdentifier, validCashierGuid)
      .input("BusinessUnitId", sql.UniqueIdentifier, sanitizeGuid(businessUnitId))
      .input("SysAmount", sql.Money, totalAmount || 0)
      .input("ManualAmount", sql.Money, totalAmount || 0)
      .input("CreatedBy", sql.UniqueIdentifier, validCashierGuid)
      .input("CreatedOn", sql.DateTime, now)
      .input("SER_NAME", sql.NVarChar(255), req.body.serverName || null)
      .input("MobileNo", sql.NVarChar(50), effectiveMobile)
      .input("VoidItemQty", sql.Int, voidQty)
      .input("VoidItemAmount", sql.Money, voidAmount)
      .input("RoundedBy", sql.Money, roundOff || 0)
      .input("ServiceCharge", sql.Money, req.body.serviceCharge || 0)
      .input("TakeawayCharge", sql.Decimal(18, 2), req.body.takeawayCharge || 0)
      .input("PayModeCode", sql.Int, payModeCode)
      .input("DailySeq", sql.Int, dailySequence || 0)
      .input("InvoiceOrderId", sql.UniqueIdentifier, guidOrderId)
      .input("DiscountId", sql.UniqueIdentifier, toGuidOrNull(discountId))
      .input("DiscountPercentage", sql.Decimal(18, 2), discountPercentage || null)
      .input("DiscountRemarks", sql.NVarChar(1000), discountRemarks || null)
      .input("TotalDiscountAmount", sql.Decimal(18, 2), discountAmount || 0)
      .input("TotalLineItemDiscountAmount", sql.Decimal(18, 2), itemDiscountAmount || 0)
      .input("MergeCount", sql.Numeric, mergeCount)
      .input("SplitCount", sql.Numeric, splitIndexValue)
      .input("GuestName", sql.NVarChar(100), effectiveGuestName)
      .input("Pax", sql.Int, req.body.pax ? parseInt(req.body.pax) : (orderPax || tablePax || null))
      .input("startDate", sql.Date, formattedStartDate)
      .query(`
        -- 1. Insert into SettlementHeader
        INSERT INTO SettlementHeader (
          SettlementID, LastSettlementDate, LastDayEndDate, SubTotal, TotalTax, DiscountAmount, DiscountType, 
          BillNo, OrderType, TableNo, Section, MemberId, CashierID, BusinessUnitId, 
          SysAmount, ManualAmount, CreatedBy, CreatedOn, SER_NAME, MobileNo, 
          VoidItemQty, VoidItemAmount, RoundedBy, ServiceCharge, GuestName, Pax, TotalPax, TakeawayCharge, start_date
        ) VALUES (
          @SettlementID, GETDATE(), GETDATE(), @SubTotal, @TotalTax, @DiscountAmount, @DiscountType, 
          @BillNo, @OrderType, @TableNo, @Section, @MemberId, @CashierID, @BusinessUnitId, 
          @SysAmount, @ManualAmount, @CreatedBy, GETDATE(), @SER_NAME, @MobileNo, 
          @VoidItemQty, @VoidItemAmount, @RoundedBy, @ServiceCharge, @GuestName, @Pax, @Pax, @TakeawayCharge, @startDate
        );

        -- 2. Insert into RestaurantInvoice (Perfect Sync)
        INSERT INTO RestaurantInvoice (
          BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled, 
          TotalLineItemAmount, TotalTax, DiscountAmount, TotalAmount, StatusCode, 
          CreatedBy, CreatedOn, InvoiceDate, ServiceCharge, RoundedBy, TotalAmountLessFreight,
          PaymentTermCode, DiscountId, DiscountPercentage, DiscountRemarks, TotalDiscountAmount,
          TotalLineItemDiscountAmount, MergeCount, SplitCount, Pax, start_date
        ) VALUES (
          @BusinessUnitId, @SettlementID, @InvoiceOrderId, @BillNo, GETDATE(), GETDATE(),
          @SubTotal, @TotalTax, @DiscountAmount, @SysAmount, 5,
          @CreatedBy, GETDATE(), CAST(GETDATE() AS DATE), @ServiceCharge, @RoundedBy, @SubTotal,
          @PayModeCode, @DiscountId, @DiscountPercentage, @DiscountRemarks, @TotalDiscountAmount,
          @TotalLineItemDiscountAmount, @MergeCount, @SplitCount, @Pax, @startDate
        );

        -- 2b. Insert into RestaurantInvoiceCur (Mirror for Backoffice Sync)
        INSERT INTO RestaurantInvoiceCur (
          BusinessUnitId, RestaurantBillId, OrderId, BillNumber, OrderDateTime, TimeBilled, 
          TotalLineItemAmount, TotalTax, DiscountAmount, TotalAmount, StatusCode, 
          CreatedBy, CreatedOn, InvoiceDate, ServiceCharge, RoundedBy, TotalAmountLessFreight,
          PaymentTermCode, DiscountId, DiscountPercentage, DiscountRemarks, TotalDiscountAmount,
          TotalLineItemDiscountAmount, MergeCount, SplitCount, Pax, start_date
        ) VALUES (
          @BusinessUnitId, @SettlementID, @InvoiceOrderId, @BillNo, GETDATE(), GETDATE(),
          @SubTotal, @TotalTax, @DiscountAmount, @SysAmount, 5,
          @CreatedBy, GETDATE(), CAST(GETDATE() AS DATE), @ServiceCharge, @RoundedBy, @SubTotal,
          @PayModeCode, @DiscountId, @DiscountPercentage, @DiscountRemarks, @TotalDiscountAmount,
          @TotalLineItemDiscountAmount, @MergeCount, @SplitCount, @Pax, @startDate
        );
      `);

    // 3. Insert SettlementTotalSales
    const receiptCount = Array.isArray(items) ? items.filter(i => i.status !== "VOIDED").reduce((sum, item) => sum + (Number(item.qty) || 0), 0) : 0;

      console.log(`[SAVE SALE] Step 3: Inserting Settlement Tables (ID: ${settlementId})...`);
      
      if (payments && Array.isArray(payments) && payments.length > 0) {
        if (Number(discountAmount) > 0) {
          const discReq = transaction.request()
            .input("SettlementID", sql.UniqueIdentifier, settlementId)
            .input("DiscountID", sql.UniqueIdentifier, DEFAULT_GUID)
            .input("DiscountDesc", sql.VarChar(255), String(discountType || "Fixed") + " Discount")
            .input("DiscAmount", sql.Money, discountAmount);
          await discReq.query(`
            INSERT INTO SettlementDiscountDetail (SettlementId, DiscountId, Description, SysAmount, ManualAmount, SortageOrExces)
            VALUES (@SettlementID, @DiscountID, @DiscountDesc, @DiscAmount, @DiscAmount, 0);
          `);
        }
      } else {
        let settlementSql = `
          INSERT INTO SettlementTotalSales (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff, ReceiptCount)
          VALUES (@SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff, @ReceiptCount);

          INSERT INTO [dbo].[SettlementDetail] (SettlementId, Paymode, SysAmount, ManualAmount, SortageOrExces, ReceiptCount, IsCollected)
          VALUES (@SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff, @ReceiptCount, 0);

          INSERT INTO SettlementTranDetail (SettlementID, PayMode, CashIn, CashOut)
          VALUES (@SettlementID, @PayMode, @SysAmount, 0);
        `;

        if (normalizedPayMode === 'CREDIT') {
          settlementSql += `
            INSERT INTO SettlementCreditSales (SettlementID, PayMode, SysAmount, ManualAmount, AmountDiff)
            VALUES (@SettlementID, @PayMode, @SysAmount, @ManualAmount, @AmountDiff);
          `;
        }

        if (Number(discountAmount) > 0) {
          settlementSql += `
            INSERT INTO SettlementDiscountDetail (SettlementId, DiscountId, Description, SysAmount, ManualAmount, SortageOrExces)
            VALUES (@SettlementID, @DiscountID, @DiscountDesc, @DiscAmount, @DiscAmount, 0);
          `;
        }

        const settlementReq = transaction.request()
          .input("SettlementID", sql.UniqueIdentifier, settlementId)
          .input("PayMode", sql.VarChar(50), normalizedPayMode)
          .input("SysAmount", sql.Money, totalAmount || 0)
          .input("ManualAmount", sql.Money, totalAmount || 0)
          .input("AmountDiff", sql.Money, 0)
          .input("ReceiptCount", sql.Numeric(18, 0), receiptCount);

        if (Number(discountAmount) > 0) {
          settlementReq.input("DiscountID", sql.UniqueIdentifier, DEFAULT_GUID)
            .input("DiscountDesc", sql.VarChar(255), String(discountType || "Fixed") + " Discount")
            .input("DiscAmount", sql.Money, discountAmount);
        }

        await settlementReq.query(settlementSql);
        console.log(`[SAVE SALE] Settlement tables updated successfully.`);
      }

      if (items && Array.isArray(items) && items.length > 0) {
        console.log(`[SAVE SALE] Batching ${items.length} items to reduce DB round-trips...`);
        const dishIds = items.map(item => toGuidOrNull(item.dishId || item.id)).filter(Boolean);
        const dishNames = items.map(item => item.dish_name || item.name || "").filter(name => name.trim() !== "");
        
        let metaMap = {};
        if (dishIds.length > 0 || dishNames.length > 0) {
          const req = transaction.request();
          let whereClauses = [];
          if (dishIds.length > 0) {
            dishIds.forEach((id, i) => {
              req.input(`id_${i}`, sql.UniqueIdentifier, id);
              whereClauses.push(`d.DishId = @id_${i}`);
            });
          }
          if (dishNames.length > 0) {
            dishNames.forEach((name, i) => {
              req.input(`name_${i}`, sql.NVarChar(255), name);
              whereClauses.push(`d.Name = @name_${i}`);
            });
          }
          const queryStr = `
            SELECT d.DishId, d.Name, d.DishGroupId, dg.CategoryId, cm.CategoryName, dg.DishGroupName, ISNULL(d.IsSplitDish, 0) as IsSplitDish
            FROM DishMaster d WITH (NOLOCK)
            LEFT JOIN DishGroupMaster dg WITH (NOLOCK) ON d.DishGroupId = dg.DishGroupId
            LEFT JOIN CategoryMaster cm WITH (NOLOCK) ON dg.CategoryId = cm.CategoryId
            WHERE ${whereClauses.join(" OR ")}
          `;
          const metaRes = await req.query(queryStr);
          metaRes.recordset.forEach(row => {
            if (row.DishId) {
              metaMap[String(row.DishId).toLowerCase()] = row;
            }
            if (row.Name) {
              metaMap[row.Name.trim().toLowerCase()] = row;
            }
          });
        }

        // Chunk items in batches of 100 to avoid the 2100 parameter limit of SQL Server
        const chunkSize = 100;
        for (let i = 0; i < items.length; i += chunkSize) {
          const chunk = items.slice(i, i + chunkSize);
          const insertReq = transaction.request();
          insertReq.input("SettlementID", sql.UniqueIdentifier, settlementId);
          insertReq.input("startDate", sql.Date, formattedStartDate);
          
          let insertQueries = [];
          chunk.forEach((item, idx) => {
            const dishId = toGuidOrNull(item.dishId || item.id);
            const nameKey = (item.dish_name || item.name || "").trim().toLowerCase();
            const meta = (dishId && metaMap[String(dishId).toLowerCase()]) || metaMap[nameKey] || {};
            
            insertReq.input(`DishId_${idx}`, sql.UniqueIdentifier, toGuidOrNull(meta.DishId || dishId));
            insertReq.input(`DishGroupId_${idx}`, sql.UniqueIdentifier, toGuidOrNull(meta.DishGroupId));
            insertReq.input(`CategoryId_${idx}`, sql.UniqueIdentifier, toGuidOrNull(meta.CategoryId));
            insertReq.input(`DishName_${idx}`, sql.NVarChar(255), item.dish_name || item.name || "Unknown");
            insertReq.input(`SongName_${idx}`, sql.NVarChar(255), item.songName || item.SongName || "");
            insertReq.input(`CategoryName_${idx}`, sql.NVarChar(255), meta.CategoryName || item.categoryName || "Unmapped");
            insertReq.input(`SubCategoryName_${idx}`, sql.NVarChar(255), meta.DishGroupName || "Unmapped");
            insertReq.input(`Qty_${idx}`, sql.Decimal(18, 3), item.qty || 1);
            insertReq.input(`Price_${idx}`, sql.Decimal(18, 2), item.price || 0);
            insertReq.input(`ItemDiscountAmount_${idx}`, sql.Decimal(18, 2), Number(item.discountAmount) || null);
            insertReq.input(`ItemDiscountType_${idx}`, sql.NVarChar(50), item.discountType || (Number(item.discountAmount) > 0 ? "percentage" : null));
            insertReq.input(`Status_${idx}`, sql.NVarChar(50), item.status || "NORMAL");
            insertReq.input(`Spicy_${idx}`, sql.NVarChar(50), item.spicy || "");
            insertReq.input(`Salt_${idx}`, sql.NVarChar(50), item.salt || "");
            insertReq.input(`Oil_${idx}`, sql.NVarChar(50), item.oil || "");
            insertReq.input(`Sugar_${idx}`, sql.NVarChar(50), item.sugar || "");
            insertReq.input(`OrderDetailId_${idx}`, sql.UniqueIdentifier, toGuidOrNull(item.lineItemId));
            
            const comboJSON = item.comboSelections ? JSON.stringify(item.comboSelections) : null;
            insertReq.input(`ComboDetailsJSON_${idx}`, sql.NVarChar(sql.MAX), comboJSON);
            
            insertQueries.push(`
              INSERT INTO SettlementItemDetail (SettlementID, DishId, DishGroupId, SubCategoryId, CategoryId, DishName, SongName, Qty, Price, OrderDateTime, CategoryName, SubCategoryName, DiscountAmount, DiscountType, Status, Spicy, Salt, Oil, Sugar, OrderDetailId, ComboDetailsJSON, start_date)
              VALUES (@SettlementID, @DishId_${idx}, @DishGroupId_${idx}, @DishGroupId_${idx}, @CategoryId_${idx}, @DishName_${idx}, @SongName_${idx}, @Qty_${idx}, @Price_${idx}, GETDATE(), @CategoryName_${idx}, @SubCategoryName_${idx}, @ItemDiscountAmount_${idx}, @ItemDiscountType_${idx}, @Status_${idx}, @Spicy_${idx}, @Salt_${idx}, @Oil_${idx}, @Sugar_${idx}, @OrderDetailId_${idx}, @ComboDetailsJSON_${idx}, @startDate);
            `);
          });
          
          await insertReq.query(insertQueries.join("\n"));
        }
        console.log(`[SAVE SALE] Batch insert complete for all ${items.length} items (chunked to avoid param limits).`);
      }
 
      // 4.5 Capture and Insert VOIDED items for reporting
      if (displayOrderId) {
        try {
          const dbVoids = await transaction.request()
            .input("orderNo", sql.NVarChar(100), displayOrderId)
            .query(`
              SELECT d.OrderDetailId, d.DishId, d.DishName, d.SongName, d.Quantity, d.PricePerUnit, dish.DishGroupId, dg.CategoryId, cm.CategoryName, dg.DishGroupName
              FROM RestaurantOrderDetailCur d WITH (NOLOCK)
              JOIN RestaurantOrderCur h WITH (NOLOCK) ON d.OrderId = h.OrderId
              LEFT JOIN DishMaster dish WITH (NOLOCK) ON d.DishId = dish.DishId
              LEFT JOIN DishGroupMaster dg WITH (NOLOCK) ON dish.DishGroupId = dg.DishGroupId
              LEFT JOIN CategoryMaster cm WITH (NOLOCK) ON dg.CategoryId = cm.CategoryId
              WHERE h.OrderNumber = @orderNo AND d.StatusCode = 0
            `);
          
          if (dbVoids.recordset.length > 0) {
            const voidReq = transaction.request();
            voidReq.input("sid", sql.UniqueIdentifier, settlementId);
            voidReq.input("startDate", sql.Date, formattedStartDate);
            
            const voidQueries = dbVoids.recordset.map((v, idx) => {
              voidReq.input(`dishId_${idx}`, sql.UniqueIdentifier, v.DishId);
              voidReq.input(`dishName_${idx}`, sql.NVarChar(255), v.DishName);
              voidReq.input(`songName_${idx}`, sql.NVarChar(255), v.SongName || "");
              voidReq.input(`qty_${idx}`, sql.Decimal(18, 3), v.Quantity);
              voidReq.input(`price_${idx}`, sql.Decimal(18, 2), v.PricePerUnit);
              voidReq.input(`catId_${idx}`, sql.UniqueIdentifier, v.CategoryId);
              voidReq.input(`catName_${idx}`, sql.NVarChar(255), v.CategoryName);
              voidReq.input(`groupName_${idx}`, sql.NVarChar(255), v.DishGroupName);
              voidReq.input(`OrderDetailId_${idx}`, sql.UniqueIdentifier, toGuidOrNull(v.OrderDetailId));
              return `
                INSERT INTO SettlementItemDetail (
                  SettlementID, DishId, DishName, SongName, Qty, Price, Status, OrderDateTime,
                  CategoryId, CategoryName, SubCategoryName, OrderDetailId, start_date
                ) VALUES (
                  @sid, @dishId_${idx}, @dishName_${idx}, @songName_${idx}, @qty_${idx}, @price_${idx}, 'VOIDED', GETDATE(),
                  @catId_${idx}, @catName_${idx}, @groupName_${idx}, @OrderDetailId_${idx}, @startDate
                );
              `;
            });
            await voidReq.query(voidQueries.join("\n"));
          }
          console.log(`[SAVE SALE] Captured ${dbVoids.recordset.length} voided items for reporting.`);
        } catch (voidErr) {
          console.error(`[SAVE SALE WARNING] Failed to capture voided items:`, voidErr.message);
        }
      }

      if (payments && Array.isArray(payments) && payments.length > 0) {
        console.log(`[SAVE SALE] Processing Split Payments for Bill ${settlementId}...`);
        try {
          await processSplitPayments({
            referenceType: "BILL",
            referenceId: settlementId,
            payments,
            transaction,
            businessUnitId: sanitizeGuid(businessUnitId),
            cashierId: validCashierGuid,
            orderId: guidOrderId,
            now,
            receiptCount
          });

          // Update member/customer balance if credit was used
          const totalCreditAndMember = finalMemberAmount + finalCreditAmount;
          if (memberId && totalCreditAndMember > 0) {
            const oldBalance = Number(customerRecord.CurrentBalance || 0);
            const newBalance = oldBalance + totalCreditAndMember;

            console.log({
              memberId,
              customerType,
              totalCreditAndMember,
              oldBalance,
              newBalance
            });

            if (customerType === "MEMBER") {
              isMemberPayment = true;
              await transaction.request()
                .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
                .input("SubAmt", sql.Decimal(18, 2), finalMemberAmount)
                .input("AddAmt", sql.Decimal(18, 2), finalCreditAmount)
                .query(`UPDATE MemberMaster SET CurrentBalance = CurrentBalance - @SubAmt + @AddAmt WHERE MemberId = @MemberId`);
              
              await transaction.request()
                .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
                .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(settlementId))
                .input("BillNo", sql.NVarChar(50), finalBillNo)
                .input("BillAmount", sql.Decimal(18, 2), totalCreditAndMember)
                .input("PaidAmount", sql.Decimal(18, 2), finalMemberAmount)
                .input("OutstandingAmount", sql.Decimal(18, 2), finalCreditAmount)
                .input("Status", sql.NVarChar(20), finalCreditAmount > 0 ? 'OPEN' : 'PAID')
                .input("CreatedBy", sql.UniqueIdentifier, validCashierGuid)
                .input("startDate", sql.Date, formattedStartDate)
                .query(`
                  INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType, start_date)
                  VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @BillAmount, @PaidAmount, @OutstandingAmount, @Status, 'Split member credit purchase', @CreatedBy, 'MEMBER', @startDate)
                `);
              console.log(`[SAVE SALE DIAGNOSTIC] Balance update success (MEMBER): memberId=${memberId}, oldBalance=${oldBalance}, newBalance=${newBalance}`);
            } else if (customerType === "CREDIT") {
              await transaction.request()
                .input("CustomerId", sql.UniqueIdentifier, toGuidOrNull(memberId))
                .input("Amount", sql.Decimal(18, 2), totalCreditAndMember)
                .query(`UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance + @Amount WHERE CustomerId = @CustomerId`);
              
              await transaction.request()
                .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
                .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(settlementId))
                .input("BillNo", sql.NVarChar(50), finalBillNo)
                .input("BillAmount", sql.Decimal(18, 2), totalCreditAndMember)
                .input("PaidAmount", sql.Decimal(18, 2), 0)
                .input("OutstandingAmount", sql.Decimal(18, 2), totalCreditAndMember)
                .input("Status", sql.NVarChar(20), 'OPEN')
                .input("CreatedBy", sql.UniqueIdentifier, validCashierGuid)
                .input("startDate", sql.Date, formattedStartDate)
                .query(`
                  INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType, start_date)
                  VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @BillAmount, @PaidAmount, @OutstandingAmount, @Status, 'Split credit purchase', @CreatedBy, 'CREDIT', @startDate)
                `);
              console.log(`[SAVE SALE DIAGNOSTIC] Balance update success (CREDIT): memberId=${memberId}, oldBalance=${oldBalance}, newBalance=${newBalance}`);
            }
          }
        } catch (payErr) {
          console.error(`[SAVE SALE ERROR] processSplitPayments Failed for Order ${guidOrderId}:`, payErr.message);
          throw payErr;
        }
      } else {
        console.log(`[SAVE SALE] Step 5: Inserting Payment Data (PayMode: ${normalizedPayMode})...`);
        console.log(`[TRACE] [${Date.now()}] [SETTLEMENT_SYNC] Order: ${displayOrderId} | Settlement: ${settlementId} | Amount: ${totalAmount} | Mode: ${normalizedPayMode}`);

        const normUpper = normalizedPayMode.toUpperCase().trim();
        const paymodePosition = activePaymodes.find(x => {
          const pm = String(x.PayMode || "").trim().toUpperCase();
          const desc = String(x.Description || "").trim().toUpperCase();
          return pm === normUpper || desc === normUpper || (normUpper.includes("YEAHPAY") && (pm.includes("YEAHPAY") || desc.includes("YEAHPAY")));
        })?.Position || 1;

        try {
          const payResult = await transaction.request()
            .input("PaymentId", sql.UniqueIdentifier, settlementId)
            .input("RestaurantBillId", sql.UniqueIdentifier, settlementId)
            .input("PaymentOrderId", sql.UniqueIdentifier, guidOrderId)
            .input("BilledFor", sql.Int, 1)
            .input("PaymentType", sql.Int, 1)
            .input("Paymode", sql.Int, paymodePosition)
            .input("Amount", sql.Decimal(18, 2), totalAmount || 0)
            .input("ReferenceNumber", sql.VarChar(100), null)
            .input("Remarks", sql.VarChar(500), paymentMethod || "")
            .input("BusinessUnitId", sql.UniqueIdentifier, sanitizeGuid(businessUnitId))
            .input("CreatedBy", sql.UniqueIdentifier, validCashierGuid)
            .input("ModifiedBy", sql.UniqueIdentifier, validCashierGuid)
            .input("startDate", sql.Date, formattedStartDate)
            .query(`
              -- 🛡️ ATOMIC SYNC: Populating both tables in one go for report integrity
              
              -- 1. Current Table (for POS views)
              INSERT INTO [dbo].[PaymentDetailCur] (PaymentId, RestaurantBillId, BilledFor, PaymentCollectedOn, PaymentType, Paymode, Amount, ReferenceNumber, Remarks, BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, start_date)
              VALUES (@PaymentId, @RestaurantBillId, @BilledFor, GETDATE(), @PaymentType, @Paymode, @Amount, @ReferenceNumber, @Remarks, @BusinessUnitId, @CreatedBy, GETDATE(), @ModifiedBy, GETDATE(), @startDate);

              -- 2. Master Table (CRITICAL for Backoffice Reports: vw_PaymentDetail)
              INSERT INTO [dbo].[PaymentDetail] (
                PaymentId, RestaurantBillId, SettlementId, InvoiceId, OrderId, BilledFor, PaymentCollectedOn, 
                PaymentType, Paymode, Amount, ReferenceNumber, Remarks, BusinessUnitId, 
                CreatedBy, CreatedOn, ModifiedBy, ModifiedOn, isSettlement, start_date
              ) VALUES (
                @PaymentId, @RestaurantBillId, @RestaurantBillId, @RestaurantBillId, @PaymentOrderId, @BilledFor, GETDATE(), 
                @PaymentType, @Paymode, @Amount, @ReferenceNumber, @Remarks, @BusinessUnitId, 
                @CreatedBy, GETDATE(), @ModifiedBy, GETDATE(), 1, @startDate
              );

              -- 3. PaymentTransactionDetails (for /detail/:id/payments breakdown)
              INSERT INTO [dbo].[PaymentTransactionDetails] (
                PaymentTransactionId, ReferenceType, ReferenceId, PayModeId, Amount, ReferenceNo, CreatedBy, CreatedDate, start_date
              ) VALUES (
                NEWID(), 'BILL', @RestaurantBillId, @Paymode, @Amount, @ReferenceNumber, @CreatedBy, GETDATE(), @startDate
              );
            `);
          console.log(`[SAVE SALE] PaymentDetail Sync Success. Rows affected: ${payResult.rowsAffected.join(', ')}`);
        } catch (payErr) {
          console.error(`[SAVE SALE ERROR] PaymentDetail Insert Failed for Order ${guidOrderId}:`, payErr.message);
          throw payErr; // Throw to trigger transaction rollback
        }

        // Update member/customer balance if credit was used
        if (memberId && creditAmount > 0) {
          const oldBalance = Number(customerRecord.CurrentBalance || 0);
          const newBalance = oldBalance + creditAmount;

          console.log({
            memberId,
            customerType,
            creditAmount,
            oldBalance,
            newBalance
          });

          if (customerType === "MEMBER") {
            isMemberPayment = true;
            await transaction.request()
              .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
              .input("Amount", sql.Decimal(18, 2), creditAmount)
              .query(`UPDATE MemberMaster SET CurrentBalance = CurrentBalance + @Amount WHERE MemberId = @MemberId`);

            await transaction.request()
              .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
              .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(settlementId))
              .input("BillNo", sql.NVarChar(50), finalBillNo)
              .input("Amount", sql.Decimal(18, 2), creditAmount)
              .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(cashierId))
              .input("startDate", sql.Date, formattedStartDate)
              .query(`
                INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType, start_date)
                VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @Amount, 0, @Amount, 'OPEN', 'Member credit purchase', @CreatedBy, 'MEMBER', @startDate)
              `);
            console.log(`[SAVE SALE DIAGNOSTIC] Balance update success (MEMBER): memberId=${memberId}, oldBalance=${oldBalance}, newBalance=${newBalance}`);
          } else if (customerType === "CREDIT") {
            await transaction.request()
              .input("CustomerId", sql.UniqueIdentifier, toGuidOrNull(memberId))
              .input("Amount", sql.Decimal(18, 2), creditAmount)
              .query(`UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance + @Amount WHERE CustomerId = @CustomerId`);

            await transaction.request()
              .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
              .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(settlementId))
              .input("BillNo", sql.NVarChar(50), finalBillNo)
              .input("Amount", sql.Decimal(18, 2), creditAmount)
              .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(cashierId))
              .input("startDate", sql.Date, formattedStartDate)
              .query(`
                INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType, start_date)
                VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @Amount, 0, @Amount, 'OPEN', 'Credit purchase', @CreatedBy, 'CREDIT', @startDate)
              `);
            console.log(`[SAVE SALE DIAGNOSTIC] Balance update success (CREDIT): memberId=${memberId}, oldBalance=${oldBalance}, newBalance=${newBalance}`);
          }
        }
      }

      // ================= SPLIT BILL QUANTITY SUBTRACTION =================
      hasRemaining = false;
      let remainingTotal = 0;

      if (isSplitParsed && Array.isArray(items)) {
        console.log(`[SAVE SALE] Processing Split Bill subtraction for order ${displayOrderId} in JavaScript loop...`);
        for (const item of items) {
          const detailId = toGuidOrNull(item.lineItemId);
          const qtyPaid = Number(item.qty) || 0;
          if (!detailId || qtyPaid <= 0) continue;

          // 1. Concurrency Check: Ensure sufficient quantity
          const qtyCheck = await transaction.request()
            .input("DetailId", sql.UniqueIdentifier, detailId)
            .query("SELECT Quantity FROM RestaurantOrderDetailCur WHERE OrderDetailId = @DetailId");
          
          if (qtyCheck.recordset.length === 0) {
            throw new Error(`Item ${detailId} not found in current order detail`);
          }
          const availableQty = Number(qtyCheck.recordset[0].Quantity) || 0;
          if (availableQty < qtyPaid) {
            throw new Error(`Insufficient quantity available for item ${item.dish_name || item.name || detailId}. (Available: ${availableQty}, Requested: ${qtyPaid})`);
          }

          // Generate new DetailId for the archived item
          const newDetailIdResult = await transaction.request().query("SELECT NEWID() AS id");
          const newDetailId = newDetailIdResult.recordset[0].id;

          // 2. Archive paid items to RestaurantOrderDetail
          await transaction.request()
            .input("OldDetailId", sql.UniqueIdentifier, detailId)
            .input("NewDetailId", sql.UniqueIdentifier, newDetailId)
            .input("QtyPaid", sql.Decimal(18, 4), qtyPaid)
            .query(`
              INSERT INTO RestaurantOrderDetail (
                OrderDetailId, OrderId, DishId, Description, DishName, Quantity, PricePerUnit, 
                ActualAmount, TotalDetailLineAmount, BaseAmount, StatusCode, CreatedBy, CreatedOn, 
                BusinessUnitId, OrderDateTime, Spicy, Salt, Oil, Sugar, Remarks, 
                OrderConfirmQty, VoidReason, DiscountAmount, DiscountType, isTakeAway, ManualDiscountAmount, ServiceCharge, ComboDetailsJSON, start_date
              )
              SELECT 
                @NewDetailId, cur.OrderId, cur.DishId, cur.Description, cur.DishName, @QtyPaid, cur.PricePerUnit, 
                @QtyPaid * cur.PricePerUnit, @QtyPaid * cur.PricePerUnit, @QtyPaid * cur.PricePerUnit, 
                cur.StatusCode, cur.CreatedBy, cur.CreatedOn, 
                cur.BusinessUnitId, cur.OrderDateTime, cur.Spicy, cur.Salt, cur.Oil, cur.Sugar, cur.Remarks, 
                @QtyPaid, cur.VoidReason, 
                ISNULL(cur.DiscountAmount, 0), ISNULL(cur.DiscountType, 'fixed'),
                cur.isTakeAway, ISNULL(cur.DiscountAmount, 0), cur.ServiceCharge, cur.ComboDetailsJSON, cur.start_date
              FROM RestaurantOrderDetailCur cur
              WHERE cur.OrderDetailId = @OldDetailId;
            `);

          // 3. Archive modifiers
          await transaction.request()
            .input("OldDetailId", sql.UniqueIdentifier, detailId)
            .input("NewDetailId", sql.UniqueIdentifier, newDetailId)
            .input("QtyPaid", sql.Decimal(18, 4), qtyPaid)
            .query(`
              INSERT INTO Restaurantmodifierdetail (OrderDetailId, OrderId, DishId, ModifierId, Quantity, Amount, ModifierName, Description, CreatedBy, CreatedOn, start_date)
              SELECT @NewDetailId, mod.OrderId, mod.DishId, mod.ModifierId, @QtyPaid, mod.Amount, mod.ModifierName, mod.ModifierName, mod.CreatedBy, mod.CreatedOn, mod.start_date
              FROM RestaurantmodifierdetailCur mod
              WHERE mod.OrderDetailId = @OldDetailId;
            `);

          // 4. Subtract quantities from current detail records
          await transaction.request()
            .input("OldDetailId", sql.UniqueIdentifier, detailId)
            .input("QtyPaid", sql.Decimal(18, 4), qtyPaid)
            .query(`
              UPDATE RestaurantOrderDetailCur
              SET Quantity = Quantity - @QtyPaid,
                  ActualAmount = (Quantity - @QtyPaid) * PricePerUnit,
                  TotalDetailLineAmount = (Quantity - @QtyPaid) * PricePerUnit,
                  BaseAmount = (Quantity - @QtyPaid) * PricePerUnit
              WHERE OrderDetailId = @OldDetailId;
            `);

          // 5. Delete modifiers for completed items (remaining quantity <= 0)
          await transaction.request()
            .input("OldDetailId", sql.UniqueIdentifier, detailId)
            .query(`
              DELETE mod
              FROM RestaurantmodifierdetailCur mod
              JOIN RestaurantOrderDetailCur cur ON mod.OrderDetailId = cur.OrderDetailId
              WHERE cur.OrderDetailId = @OldDetailId AND cur.Quantity <= 0;
            `);

          // 6. Delete completed items from current order detail
          await transaction.request()
            .input("OldDetailId", sql.UniqueIdentifier, detailId)
            .query(`
              DELETE FROM RestaurantOrderDetailCur 
              WHERE OrderDetailId = @OldDetailId AND Quantity <= 0;
            `);
        }

        // Check if there are any active items left in this order
        const remainingItems = await transaction.request()
          .input("guidOrderId", sql.UniqueIdentifier, guidOrderId)
          .query(`SELECT COUNT(*) as count FROM RestaurantOrderDetailCur WHERE OrderId = @guidOrderId AND StatusCode <> 0`);
        hasRemaining = remainingItems.recordset[0].count > 0;

        if (hasRemaining) {
          // Calculate remaining total
          const combinedTotalRes = await transaction.request()
            .input("guidOrderId", sql.UniqueIdentifier, guidOrderId)
            .query(`SELECT SUM(TotalDetailLineAmount) as Total FROM RestaurantOrderDetailCur WHERE OrderId = @guidOrderId AND StatusCode <> 0`);
          remainingTotal = combinedTotalRes.recordset[0].Total || 0;
        }
      }

      // 🆕 PROMO CODE AMOUNT DEDUCTION & USAGE COUNTER
      if (discountRemarks && (discountRemarks.startsWith("Promo:") || discountRemarks.startsWith("Applied Promo Code:")) && orderDiscountAmount > 0) {
        let promoCode = discountRemarks;
        if (discountRemarks.startsWith("Promo:")) {
          promoCode = discountRemarks.substring(6).trim();
        } else if (discountRemarks.startsWith("Applied Promo Code:")) {
          promoCode = discountRemarks.substring(19).trim();
        }

        console.log(`[SAVE SALE] Deducting/Recording Promo Code: ${promoCode}, Amount: ${orderDiscountAmount}`);
        
        // 1. Update MemberMaster balance
        await transaction.request()
          .input("PromoCode", sql.NVarChar(100), promoCode)
          .input("DeductAmount", sql.Decimal(18, 2), orderDiscountAmount)
          .query(`
            UPDATE MemberMaster 
            SET Promoamount = CASE WHEN Promoamount - @DeductAmount < 0 THEN 0 ELSE Promoamount - @DeductAmount END 
            WHERE Promocode = @PromoCode AND IsActive = 1
          `);

        // 2. Increment UsedCount in PromoCodeMaster
        await transaction.request()
          .input("PromoCode", sql.NVarChar(100), promoCode)
          .query(`
            UPDATE PromoCodeMaster 
            SET UsedCount = ISNULL(UsedCount, 0) + 1 
            WHERE PromoCode = @PromoCode AND IsActive = 1
          `);
      }

      // 🚀 PROFESSIONAL ARCHIVE: Move from Cur to History (Only run if not split, or if split has no remaining items)
      if (displayOrderId && (!isSplitParsed || !hasRemaining)) {
        try {
          await transaction.request()
            .input("orderNo", sql.NVarChar(50), displayOrderId)
            .input("totalAmt", sql.Decimal(18, 2), totalAmount)
            .input("subTotal", sql.Decimal(18, 2), subTotal || 0)
            .input("DiscountId", sql.UniqueIdentifier, toGuidOrNull(discountId))
            .input("DiscountPercentage", sql.Decimal(18, 2), discountPercentage || null)
            .input("DiscountRemarks", sql.NVarChar(1000), discountRemarks || null)
            .input("TotalDiscountAmount", sql.Decimal(18, 2), discountAmount || 0)
            .input("TotalLineItemDiscountAmount", sql.Decimal(18, 2), itemDiscountAmount || 0)
            .input("DiscountAmount", sql.Money, (Number(orderDiscountAmount) || 0) + (Number(itemDiscountAmount) || 0))
            .input("RoundedBy", sql.Money, roundOff || 0)
            .input("isTakeaway", sql.Bit, (orderType === "TAKEAWAY" || !tableId || tableId === "undefined" || tableId === "null" || String(tableId).startsWith("TAKEAWAY")) ? 1 : 0)
            .input("ServiceCharge", sql.Decimal(18, 2), req.body.serviceCharge || 0)
            .input("TakeawayCharge", sql.Decimal(18, 2), req.body.takeawayCharge || 0)
            .input("isSplit", sql.Bit, isSplitParsed ? 1 : 0)
            .query(`
              DECLARE @Section INT = 4;
              DECLARE @PriorityCode INT = NULL;
              
              SELECT TOP 1 @Section = ISNULL(t.DiningSection, 4)
              FROM RestaurantOrderCur r
              LEFT JOIN TableMaster t ON r.Tableno = t.TableNumber
              WHERE r.OrderNumber = @orderNo;
 
              IF @Section = 1 SET @PriorityCode = 1
              ELSE IF @Section = 2 SET @PriorityCode = 2
              ELSE IF @Section = 3 SET @PriorityCode = 3
              ELSE IF @Section = 4 SET @PriorityCode = 4
 
              -- Ensure parent order has the correct final TotalAmount, RoundedBy, and Discounts in Cur before moving
              UPDATE RestaurantOrderCur 
              SET TotalAmount = @totalAmt,
                  TotalLineItemAmount = @subTotal,
                  TotalLineItemDiscountAmount = @TotalLineItemDiscountAmount,
                  DiscountAmount = @DiscountAmount,
                  DiscountPercentage = @DiscountPercentage,
                  TotalDiscountAmount = @TotalDiscountAmount,
                  RoundedBy = @RoundedBy,
                  DiscountId = @DiscountId,
                  DiscountRemarks = @DiscountRemarks,
                  IsTakeAway = @isTakeaway,
                  ServiceCharge = @ServiceCharge,
                  TakeawayCharge = @TakeawayCharge,
                  isGuestMeal = ISNULL((SELECT TOP 1 isGuestMeal FROM [dbo].[Discount] WHERE DiscountId = @DiscountId), 0)
              WHERE OrderNumber = @orderNo;

              -- Move Header (History) - For Parent Order
              IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('RestaurantOrder') AND name = 'TotalAmount')
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge, TakeawayCharge, start_date
                 )
                 SELECT 
                   OrderId, OrderNumber, OrderDateTime, Tableno, 3, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, 1, ISNULL(PriorityCode, @PriorityCode),
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, GETDATE(), ServiceCharge, TakeawayCharge, start_date
                 FROM RestaurantOrderCur WHERE OrderNumber = @orderNo;
              END
              ELSE
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode, TotalAmount,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge, TakeawayCharge, start_date
                 )
                 SELECT 
                   OrderId, OrderNumber, OrderDateTime, Tableno, 3, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, 1, ISNULL(PriorityCode, @PriorityCode), TotalAmount,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, GETDATE(), ServiceCharge, TakeawayCharge, start_date
                 FROM RestaurantOrderCur WHERE OrderNumber = @orderNo;
              END
 
              -- Move Header (History) - For Child Merged Orders (so they aren't considered 'missing' bills)
              IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('RestaurantOrder') AND name = 'TotalAmount')
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge, TakeawayCharge, start_date
                 )
                 SELECT 
                   r.OrderId, r.OrderNumber, r.OrderDateTime, r.Tableno, 3, r.CreatedBy, r.CreatedOn, r.MobileNo, r.BusinessUnitId, 1, ISNULL(r.PriorityCode, @PriorityCode),
                   r.TotalLineItemAmount, r.TotalLineItemDiscountAmount, r.DiscountAmount, r.DiscountPercentage, r.TotalDiscountAmount, r.RoundedBy, r.isGuestMeal, r.DiscountId, r.DiscountRemarks, r.IsTakeAway, GETDATE(), r.ServiceCharge, r.TakeawayCharge, r.start_date
                 FROM RestaurantOrderCur r
                 INNER JOIN OrderMergeHistory omh ON r.OrderId = omh.ChildOrderId
                 WHERE omh.ParentOrderId = (SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                   AND NOT EXISTS (SELECT 1 FROM RestaurantOrder ro WHERE ro.OrderId = r.OrderId);
              END
              ELSE
              BEGIN
                 INSERT INTO RestaurantOrder (
                   OrderId, OrderNumber, OrderDateTime, Tableno, StatusCode, CreatedBy, CreatedOn, MobileNo, BusinessUnitId, isOrderClosed, PriorityCode, TotalAmount,
                   TotalLineItemAmount, TotalLineItemDiscountAmount, DiscountAmount, DiscountPercentage, TotalDiscountAmount, RoundedBy, isGuestMeal, DiscountId, DiscountRemarks, IsTakeAway, TimeBilled, ServiceCharge, TakeawayCharge, start_date
                 )
                 SELECT 
                   r.OrderId, r.OrderNumber, r.OrderDateTime, r.Tableno, 3, r.CreatedBy, r.CreatedOn, r.MobileNo, r.BusinessUnitId, 1, ISNULL(r.PriorityCode, @PriorityCode), 0,
                   r.TotalLineItemAmount, r.TotalLineItemDiscountAmount, r.DiscountAmount, r.DiscountPercentage, r.TotalDiscountAmount, r.RoundedBy, r.isGuestMeal, r.DiscountId, r.DiscountRemarks, r.IsTakeAway, GETDATE(), r.ServiceCharge, r.TakeawayCharge, r.start_date
                 FROM RestaurantOrderCur r
                 INNER JOIN OrderMergeHistory omh ON r.OrderId = omh.ChildOrderId
                 WHERE omh.ParentOrderId = (SELECT TOP 1 OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                   AND NOT EXISTS (SELECT 1 FROM RestaurantOrder ro WHERE ro.OrderId = r.OrderId);
              END
 
              -- Move Details (History) only if not split (split details are archived incrementally)
              IF @isSplit = 0
              BEGIN
                INSERT INTO RestaurantOrderDetail (
                  OrderDetailId, OrderId, DishId, Description, DishName, Quantity, PricePerUnit, 
                  ActualAmount, TotalDetailLineAmount, BaseAmount, StatusCode, CreatedBy, CreatedOn, 
                  BusinessUnitId, OrderDateTime, Spicy, Salt, Oil, Sugar, Remarks, 
                  OrderConfirmQty, VoidReason, DiscountAmount, DiscountType, isTakeAway, ManualDiscountAmount, ServiceCharge, ComboDetailsJSON, start_date
                )
                SELECT 
                  d.OrderDetailId, d.OrderId, d.DishId, d.Description, d.DishName, d.Quantity, d.PricePerUnit, 
                  d.ActualAmount, d.TotalDetailLineAmount,
                  ISNULL(d.BaseAmount, d.PricePerUnit * d.Quantity),
                  d.StatusCode, d.CreatedBy, d.CreatedOn, 
                  d.BusinessUnitId, d.OrderDateTime, d.Spicy, d.Salt, d.Oil, d.Sugar, d.Remarks, 
                  d.OrderConfirmQty, d.VoidReason, 
                  ISNULL(d.DiscountAmount, 0), ISNULL(d.DiscountType, 'fixed'),
                  ISNULL(h.IsTakeAway, ISNULL(d.isTakeAway, 0)),
                  ISNULL(d.DiscountAmount, 0), d.ServiceCharge, d.ComboDetailsJSON, d.start_date
                FROM RestaurantOrderDetailCur d
                INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
                WHERE h.OrderNumber = @orderNo;
 
                -- Move Modifiers (History)
                INSERT INTO Restaurantmodifierdetail (OrderDetailId, OrderId, DishId, ModifierId, Quantity, Amount, ModifierName, Description, CreatedBy, CreatedOn, start_date)
                SELECT OrderDetailId, OrderId, DishId, ModifierId, Quantity, Amount, ModifierName, ModifierName, CreatedBy, CreatedOn, start_date
                FROM RestaurantmodifierdetailCur WHERE OrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo);
              END
            `);
          console.log(`[SAVE SALE] Professional Archive complete for ${displayOrderId}`);
        } catch (archiveErr) {
          console.error("⚠️ [SAVE SALE] Professional Archive failed:", archiveErr.message);
        }
      }

      // 4. Cleanup Table & Cart on success
      if (tableId) {
        const cleanTableId = String(tableId).replace(/^\{|\}$/g, "").trim();
        const validTableGuid = toGuidOrNull(cleanTableId);
        
        if (isSplitParsed && hasRemaining) {
          console.log(`[SAVE SALE] Split bill partial payment. Remaining Total: ${remainingTotal}`);
          if (validTableGuid) {
            // Partially paid: DO NOT clear table status. Just update total.
            await transaction.request()
              .input("tid", sql.UniqueIdentifier, validTableGuid)
              .input("total", sql.Decimal(18, 2), remainingTotal)
              .query("UPDATE [dbo].[TableMaster] SET TotalAmount = @total WHERE TableId = @tid");
          }

          const io = req.app.get("io");
          if (io) {
            io.emit("table_status_updated", { tableId: cleanTableId.toLowerCase(), status: 1, totalAmount: remainingTotal });
            io.emit("cart_updated", { tableId: cleanTableId.toLowerCase(), orderId: displayOrderId });
          }
        } else {
          // Fully paid or normal sale: complete cleanup
          console.log(`[SAVE SALE] Cleaning up table: ${cleanTableId}`);
          await transaction.request()
            .input("cartId", sql.NVarChar(128), cleanTableId)
            .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @cartId");
            
          const targetTableNo = tableNo || cleanTableId;
          if (validTableGuid) {
            await transaction.request()
              .input("tid", sql.UniqueIdentifier, validTableGuid)
              .input("tno", sql.NVarChar(50), String(targetTableNo))
              .query("UPDATE [dbo].[TableMaster] SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL WHERE TableId = @tid OR TableNumber = @tno");
          } else {
            await transaction.request()
              .input("tno", sql.NVarChar(50), String(targetTableNo))
              .query("UPDATE [dbo].[TableMaster] SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL WHERE TableNumber = @tno OR TableId = @tno");
          }

          const io = req.app.get("io");
          if (io) {
            io.emit("table_status_updated", { tableId: cleanTableId.toLowerCase(), tableNo: targetTableNo, status: 0, totalAmount: 0, customerName: null, pax: null });
            io.emit("cart_updated", { tableId: cleanTableId.toLowerCase(), tableNo: targetTableNo });
            io.emit("order_closed", { tableId: cleanTableId.toLowerCase(), tableNo: targetTableNo, orderId: displayOrderId });
          }

          // 🚀 CLEANUP MERGED SOURCE TABLES AS WELL (Bullet 5)
          try {
            const targetTableNoVal = targetTableNo || cleanTableId;
            const childTablesRes = await transaction.request()
              .input("orderNo", sql.NVarChar(50), displayOrderId)
              .input("guidOid", sql.UniqueIdentifier, guidOrderId || DEFAULT_GUID)
              .input("targetTno", sql.NVarChar(50), String(targetTableNoVal))
              .query(`
                SELECT tm.TableId, tm.TableNumber, tm.DiningSection
                FROM OrderMergeHistory omh
                JOIN TableMaster tm ON (
                  omh.ChildTableNo = tm.TableNumber 
                  OR TRY_CAST(omh.ChildOrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100))
                  OR TRY_CAST(omh.ChildOrderId AS NVARCHAR(100)) = TRY_CAST(tm.TableId AS NVARCHAR(100))
                )
                WHERE omh.ParentOrderId = @guidOid 
                   OR omh.ParentTableNo = @targetTno
                   OR omh.ParentOrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                   OR omh.ParentOrderId IN (SELECT OrderId FROM RestaurantOrder WHERE OrderNumber = @orderNo)
              `);

            if (childTablesRes.recordset && childTablesRes.recordset.length > 0) {
              const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
              for (const childTable of childTablesRes.recordset) {
                const childTableId = String(childTable.TableId).replace(/^\{|\}$/g, "").trim();
                const childTableNo = childTable.TableNumber;
                const childSection = sectionMap[String(childTable.DiningSection)] || "SECTION_1";

                console.log(`[SAVE SALE] Cleaning up merged source table: ${childTableNo} (${childTableId})`);
                
                await transaction.request()
                  .input("cartId", sql.NVarChar(128), childTableId)
                  .query("DELETE FROM [dbo].[CartItems] WHERE [CartId] = @cartId");

                const validChildGuid = toGuidOrNull(childTableId);
                if (validChildGuid) {
                  await transaction.request()
                    .input("tid", sql.UniqueIdentifier, validChildGuid)
                    .input("tno", sql.NVarChar(50), String(childTableNo))
                    .query("UPDATE [dbo].[TableMaster] SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL WHERE TableId = @tid OR TableNumber = @tno");
                } else {
                  await transaction.request()
                    .input("tno", sql.NVarChar(50), String(childTableNo))
                    .query("UPDATE [dbo].[TableMaster] SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL WHERE TableNumber = @tno OR TableId = @tno");
                }

                if (io) {
                  io.emit("table_status_updated", { 
                    tableId: childTableId.toLowerCase(), 
                    status: 0, 
                    totalAmount: 0,
                    startTime: null,
                    tableNo: childTableNo,
                    section: childSection,
                    customerName: null,
                    pax: null
                  });
                  io.emit("cart_updated", { tableId: childTableId.toLowerCase(), tableNo: childTableNo });
                  io.emit("order_closed", { tableId: childTableId.toLowerCase(), tableNo: childTableNo, orderId: displayOrderId });
                }
              }
            }
          } catch (childErr) {
            console.error("⚠️ [SAVE SALE] Merged tables cleanup failed:", childErr.message);
          }

          // 🚀 GLOBAL KDS SYNC: Mark parent order and all child merged orders as closed in professional tables
          await transaction.request()
            .input("orderNo", sql.NVarChar(50), displayOrderId)
            .input("guidOid", sql.UniqueIdentifier, guidOrderId || DEFAULT_GUID)
            .input("targetTno", sql.NVarChar(50), String(tableNo || cleanTableId))
            .query(`
              UPDATE RestaurantOrderCur 
              SET isOrderClosed = 1, ModifiedOn = GETDATE() 
              WHERE OrderNumber = @orderNo 
                 OR OrderId IN (
                   SELECT omh.ChildOrderId 
                   FROM OrderMergeHistory omh
                   WHERE omh.ParentOrderId = @guidOid 
                      OR omh.ParentTableNo = @targetTno
                      OR omh.ParentOrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                      OR omh.ParentOrderId IN (SELECT OrderId FROM RestaurantOrder WHERE OrderNumber = @orderNo)
                 )
            `);
        }
      }

      // 5. Track in servermaster (Waiter History)
      if (serverId) {
        try {
          await transaction.request()
            .input("SER_ID", sql.Int, serverId)
            .input("SER_NAME", sql.NVarChar(255), serverName)
            .input("TableNo", sql.NVarChar(50), tableNo || null)
            .input("OrderId", sql.NVarChar(50), displayOrderId)
            .input("Section", sql.NVarChar(100), section || null)
            .input("CreatedBy", sql.UniqueIdentifier, sanitizeGuid(cashierId))
            .query(`
              INSERT INTO servermaster (SER_ID, SER_NAME, TableNo, OrderId, Section, CreatedBy, CreatedDate)
              VALUES (@SER_ID, @SER_NAME, @TableNo, @OrderId, @Section, @CreatedBy, GETDATE())
            `);
        } catch (serverErr) {
          console.error("⚠️ [SAVE SALE] servermaster insert failed:", serverErr.message);
        }
      }

    }, { name: "SaveSale", timeoutMs: 60000 });

    // 🚀 POST-SAVE VALIDATION: Deep integrity check for Backoffice compatibility
    if (guidOrderId) {
      setImmediate(async () => {
        try {
          const checkPool = await poolPromise;
          const check = await checkPool.request()
            .input("oid", sql.UniqueIdentifier, guidOrderId)
            .input("sid", sql.UniqueIdentifier, settlementId)
            .query(`
              SELECT 
                (SELECT COUNT(*) FROM PaymentDetail WHERE RestaurantBillId = @sid) as PaymentMasterCount,
                (SELECT COUNT(*) FROM RestaurantInvoice WHERE RestaurantBillId = @sid AND OrderId = @oid) as InvoiceMasterMatch,
                (SELECT COUNT(*) FROM RestaurantOrder WHERE OrderId = @oid) as OrderMasterCount,
                (SELECT BillNumber FROM RestaurantInvoice WHERE RestaurantBillId = @sid) as FinalBillNo
            `);
          const stats = check.recordset[0];
          const isHealthy = stats.PaymentMasterCount > 0 && stats.InvoiceMasterMatch > 0 && stats.OrderMasterCount > 0;
          console.log(`[INTEGRITY ${isHealthy ? 'OK' : 'FAIL'}] Order: ${displayOrderId} | MasterOrder: ${stats.OrderMasterCount} | Invoice: ${stats.InvoiceMasterMatch} | Payments: ${stats.PaymentMasterCount} | Bill: ${stats.FinalBillNo}`);
        } catch (vErr) {
          console.error("[INTEGRITY ERROR] Verification failed:", vErr.message);
        }
      });
    }
    
    if (isMemberPayment && memberId) {
      setImmediate(async () => {
        try {
          const checkPool = await poolPromise;
          await sendBalanceNotification(memberId, checkPool);
        } catch (err) {
          console.error("[WhatsApp] sendBalanceNotification error in sales save setImmediate:", err.message);
        }
      });
    }

    // 🚀 POST-SAVE LOYALTY TRIGGER
    const loyaltyPhone = req.body.mobileNo || req.body.MobileNo;
    const loyaltyName = req.body.customerName || req.body.CustomerName;
    console.log(`[Loyalty Debug] Incoming req.body loyalty details: Phone="${loyaltyPhone}", Name="${loyaltyName}"`);
    if (loyaltyPhone && String(loyaltyPhone).trim() !== "") {
      console.log(`[Loyalty Debug] Triggering logLoyaltyVisitAsync for phone: ${loyaltyPhone}`);
      setImmediate(async () => {
        const checkPool = await poolPromise;
        await logLoyaltyVisitAsync(checkPool, settlementId, finalBillNo, loyaltyPhone, loyaltyName, items);
      });
    } else {
      console.log(`[Loyalty Debug] Loyalty phone was empty or missing. Skipping trigger.`);
    }

     // 🏆 POST-SAVE REWARD POINTS TRIGGER
     // Award/Deduct reward credit when a reward member is linked and payment is NOT by member credit
     let rewardPointsEarned = 0;
     let memberRewardBalance = 0;
 
     if (rewardMemberId && totalAmount > 0) {
       try {
         const rewardPool = await poolPromise;
 
         // 1. Determine if a reward discount was redeemed in this sale
         const discountRemarksVal = req.body.discountRemarks || "";
         const isRewardRedemption = discountRemarksVal.startsWith("Reward:");
         const redeemedAmount = isRewardRedemption ? parseFloat(req.body.orderDiscountAmount) || 0 : 0;
 
         // 2. Fetch current RewardCredit for the member before modifications
         const memberRes = await rewardPool.request()
           .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(rewardMemberId))
           .query(`SELECT ISNULL(RewardCredit, 0) AS RewardCredit FROM MemberMaster WHERE MemberId = @MemberId`);
 
         let currentCredit = 0;
         if (memberRes.recordset.length > 0) {
           currentCredit = parseFloat(memberRes.recordset[0].RewardCredit) || 0;
         }
 
         // 3. Calculate new balance: subtract redeemed, add earned
         // Fetch active reward rule to calculate earning
         const ruleRes = await rewardPool.request().query(
           `SELECT TOP 1 SpendAmount, CreditAmount FROM RewardMaster WHERE IsActive = 1 ORDER BY Id DESC`
         );
         if (ruleRes.recordset.length > 0) {
           const rule = ruleRes.recordset[0];
           const earned = (totalAmount / rule.SpendAmount) * rule.CreditAmount;
           rewardPointsEarned = Math.round(earned * 10000) / 10000; // 4dp precision
         }
 
         const deductAmount = Math.min(redeemedAmount, currentCredit);
         const newCredit = Math.max(0, currentCredit - deductAmount + rewardPointsEarned);
 
         // 4. Update RewardCredit in MemberMaster
         await rewardPool.request()
           .input("NewCredit", sql.Decimal(18, 4), newCredit)
           .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(rewardMemberId))
           .query(`UPDATE MemberMaster SET RewardCredit = @NewCredit WHERE MemberId = @MemberId`);
 
         // 5. Log the redemption to RewardPointDetails (if applicable)
         if (deductAmount > 0) {
           await rewardPool.request()
             .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(rewardMemberId))
             .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(settlementId))
             .input("BillNo", sql.NVarChar(50), finalBillNo || displayOrderId)
             .input("BillAmount", sql.Decimal(18, 2), totalAmount)
             .input("PointsUsed", sql.Decimal(18, 4), deductAmount)
             .input("PayMode", sql.NVarChar(50), paymentMethod || "CASH")
             .input("Remarks", sql.NVarChar(255), `Redeemed as discount on bill ${finalBillNo || displayOrderId}`)
             .query(`
               INSERT INTO RewardPointDetails (Id, MemberId, SettlementId, BillNo, BillAmount, PointsEarned, PointsUsed, TransType, PayMode, Remarks, CreatedOn)
               VALUES (NEWID(), @MemberId, @SettlementId, @BillNo, @BillAmount, 0, @PointsUsed, 'REDEEM', @PayMode, @Remarks, GETDATE())
             `);
         }
 
         // 6. Log the earning to RewardPointDetails (if applicable)
         if (rewardPointsEarned > 0) {
           await rewardPool.request()
             .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(rewardMemberId))
             .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(settlementId))
             .input("BillNo", sql.NVarChar(50), finalBillNo || displayOrderId)
             .input("BillAmount", sql.Decimal(18, 2), totalAmount)
             .input("PointsEarned", sql.Decimal(18, 4), rewardPointsEarned)
             .input("PayMode", sql.NVarChar(50), paymentMethod || "CASH")
             .input("Remarks", sql.NVarChar(255), `Earned on bill ${finalBillNo || displayOrderId}`)
             .query(`
               INSERT INTO RewardPointDetails (Id, MemberId, SettlementId, BillNo, BillAmount, PointsEarned, PointsUsed, TransType, PayMode, Remarks, CreatedOn)
               VALUES (NEWID(), @MemberId, @SettlementId, @BillNo, @BillAmount, @PointsEarned, 0, 'EARN', @PayMode, @Remarks, GETDATE())
             `);
         }
 
         memberRewardBalance = newCredit;
         console.log(`[Rewards] ✅ Processed member ${rewardMemberId}. Redeemed: ${deductAmount}, Earned: ${rewardPointsEarned}. New balance: ${memberRewardBalance}`);
       } catch (rewardErr) {
         // Non-blocking — don't fail the sale
         console.error(`[Rewards] ❌ Atomic process failed (non-blocking):`, rewardErr.message);
       }
     }

    res.json({
      success: true,
      settlementId,
      billNo: finalBillNo || displayOrderId,
      orderId: displayOrderId,
      rewardPointsEarned,
      memberRewardBalance,
      isOrderClosed: !hasRemaining
    });
  } catch (err) {
    console.error("SAVE SALE ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ================= VALIDATION ================= */
router.get("/orders/check/:orderId", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("OrderId", req.params.orderId)
      .query("SELECT SettlementID FROM SettlementHeader WHERE OrderId = @OrderId AND IsCancelled = 0");
    res.json({ exists: result.recordset.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/orders/validate-cancel", async (req, res) => {
    try {
      const { settlementId } = req.body;
      const pool = await poolPromise;
      
      const result = await pool.request()
        .input("Id", settlementId)
        .query("SELECT IsCancelled FROM SettlementHeader WHERE SettlementID = @Id");
      
      if (result.recordset.length === 0) return res.status(404).json({ valid: false, message: "Order not found" });
      if (result.recordset[0].IsCancelled) return res.status(400).json({ valid: false, message: "Order is already cancelled" });
      
      res.json({ valid: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

router.get("/payment-history", async (req, res) => {
    try {
      const pool = await poolPromise;
      const limit = parseInt(req.query.limit) || 50;
      const result = await pool.request().input("Limit", sql.Int, limit).query(`
        SELECT TOP (@Limit) CAST(pdc.PaymentId AS VARCHAR(50)) as paymentId,
        CONVERT(VARCHAR(23), pdc.PaymentCollectedOn, 126) as paymentCollectedOn,
        ISNULL(pdc.Amount, 0) as amount, ISNULL(pm.Description, '') as payModeDescription
        FROM [dbo].[PaymentDetailCur] pdc
        LEFT JOIN [dbo].[Paymode] pm ON pm.Position = pdc.Paymode
        ORDER BY pdc.PaymentCollectedOn DESC
      `);
      res.json(result.recordset || []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

// routes/sales.js


// Kept for backward compatibility — all fields now also returned by /payment-methods above.
router.get("/payment-detail/:payMode", async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request()
        .input("PayMode", req.params.payMode)
        .query("SELECT * FROM [dbo].[Paymode] WHERE LTRIM(RTRIM(PayMode)) = @PayMode AND Active = 1");
      res.json(result.recordset[0] || null);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

/**
 * Generate comprehensive consolidated sales report PDF
 * Supports daily, weekly, monthly, yearly filters
 */
router.get("/consolidated-report/pdf", async (req, res) => {
  try {
    const pool = await poolPromise;
    if (!pool) {
      return res.status(503).json({ error: 'Database connection unavailable' });
    }

    const filter = normalizeReportFilter(req.query.filter || 'daily');
    
    // Resolve start and end dates relative to target date (or today in SGT)
    const targetDateStr = req.query.date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
    const targetDate = new Date(targetDateStr);
    let startDateStr = targetDateStr;
    let endDateStr = targetDateStr;

    if (filter === 'weekly') {
      const start = new Date(targetDate);
      start.setDate(start.getDate() - 6);
      startDateStr = start.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
    } else if (filter === 'monthly') {
      const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      startDateStr = start.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
    } else if (filter === 'yearly') {
      const start = new Date(targetDate.getFullYear(), 0, 1);
      startDateStr = start.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
    }

    const { fetchFullReportData } = require('../utils/reportDataFetcher');
    const reportData = await fetchFullReportData(startDateStr, endDateStr, pool);

    const { generateSalesReportPdf, createPdfBinary } = require('../utils/pdfReportGenerator');
    const docDef = await generateSalesReportPdf(reportData);
    const pdfBuffer = await createPdfBinary(docDef);

    const filename = `Consolidated_Sales_Report_${filter}_${startDateStr}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[SALES/consolidated-report] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate report PDF', details: err.message });
  }
});

/* ================= REPORTING ENDPOINTS ================= */

// 1. Member Payment Collection By Payment Mode
router.get("/reports/member-collection-by-mode", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT pm.Description as PayMode, SUM(ptd.Amount) as TotalCollected, COUNT(*) as TransactionCount
      FROM PaymentTransactionDetails ptd
      JOIN Paymode pm ON pm.Position = ptd.PayModeId
      WHERE ptd.ReferenceType = 'MEMBER'
      GROUP BY pm.Description
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Daily Member Collection
router.get("/reports/daily-member-collection", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT CAST(ptd.CreatedDate AS DATE) as CollectionDate, pm.Description as PayMode, SUM(ptd.Amount) as TotalAmount
      FROM PaymentTransactionDetails ptd
      JOIN Paymode pm ON pm.Position = ptd.PayModeId
      WHERE ptd.ReferenceType = 'MEMBER'
      GROUP BY CAST(ptd.CreatedDate AS DATE), pm.Description
      ORDER BY CollectionDate DESC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Member Collection Summary
router.get("/reports/member-collection-summary", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT m.Name as MemberName, m.Phone, SUM(ptd.Amount) as TotalPaid, MAX(ptd.CreatedDate) as LastPaymentDate
      FROM PaymentTransactionDetails ptd
      JOIN MemberMaster m ON m.MemberId = ptd.ReferenceId
      WHERE ptd.ReferenceType = 'MEMBER'
      GROUP BY m.Name, m.Phone
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Combined Collection Summary (Bills + Members)
router.get("/reports/combined-collection-summary", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT ptd.ReferenceType, pm.Description as PayMode, SUM(ptd.Amount) as TotalAmount, COUNT(*) as TransactionCount
      FROM PaymentTransactionDetails ptd
      JOIN Paymode pm ON pm.Position = ptd.PayModeId
      GROUP BY ptd.ReferenceType, pm.Description
    `);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function logLoyaltyVisitAsync(pool, settlementId, billNo, phone, name, items) {
  try {
    const cleanPhone = String(phone).trim();
    if (!cleanPhone) return;

    // 1. Idempotency Check
    const dupCheck = await pool.request()
      .input("SettlementId", sql.UniqueIdentifier, settlementId)
      .query("SELECT LoyaltyVisitId FROM LoyaltyVisit WHERE SettlementId = @SettlementId");

    if (dupCheck.recordset.length > 0) {
      console.log(`[Loyalty Trigger] Duplicate check: SettlementId ${settlementId} already logged.`);
      return;
    }

    // 2. Split Bill Check
    const baseBillNo = String(billNo || "").trim().split("-S")[0];
    const splitCheck = await pool.request()
      .input("BaseBillNo", sql.NVarChar(50), baseBillNo)
      .query("SELECT LoyaltyVisitId FROM LoyaltyVisit WHERE BillNo LIKE @BaseBillNo + '%'");

    const isSplitDuplicate = splitCheck.recordset.length > 0;

    // 3. Determine if reward was claimed on this invoice
    const itemsList = items || [];
    const hasRewardClaimed = itemsList.some(item => {
      const discAmt = Number(item.discountAmount ?? item.discount ?? item.DiscountAmount ?? 0);
      const discType = item.discountType || item.DiscountType || "percentage";
      const isPriceZero = Number(item.price || item.Price || 0) === 0;
      const isDiscount100Percent = discType === "percentage" && discAmt === 100;
      const isDiscountFullPrice = (discType === "fixed" || discType === "amount") && discAmt === Number(item.price || item.Price || 0);
      return isPriceZero || isDiscount100Percent || isDiscountFullPrice;
    });

    const rewardDish = itemsList.find(item => {
      const discAmt = Number(item.discountAmount ?? item.discount ?? item.DiscountAmount ?? 0);
      const discType = item.discountType || item.DiscountType || "percentage";
      const isPriceZero = Number(item.price || item.Price || 0) === 0;
      const isDiscount100Percent = discType === "percentage" && discAmt === 100;
      const isDiscountFullPrice = (discType === "fixed" || discType === "amount") && discAmt === Number(item.price || item.Price || 0);
      return isPriceZero || isDiscount100Percent || isDiscountFullPrice;
    });
    const rewardDishId = rewardDish ? toGuidOrNull(rewardDish.dishId || rewardDish.DishId || rewardDish.id) : null;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 4. Fetch all active loyalty rules
      const activeRulesRes = await transaction.request().query(`
        SELECT r.RuleId, r.LoyaltyType, r.PurchaseDishId, r.PurchaseDishGroupId, r.RewardDishId, r.RequiredBills
        FROM LoyaltyRule r
        INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
        WHERE r.IsActive = 1 AND c.IsActive = 1
          AND GETDATE() BETWEEN c.StartDate AND c.EndDate
      `);
      const activeRules = activeRulesRes.recordset || [];

      // Resolve DishGroupIds for all items in the cart (Performance Optimized)
      const itemGroupIdMap = {}; // dishId (lowercase string) -> DishGroupId (lowercase string or null)
      const missingDishIds = [];
      for (const item of itemsList) {
        const dishId = String(item.DishId || item.dishId || item.id || "");
        if (!dishId) continue;
        const key = dishId.toLowerCase();
        
        const providedGroupId = item.DishGroupId || item.dishGroupId || item.groupId;
        if (providedGroupId) {
          itemGroupIdMap[key] = String(providedGroupId).toLowerCase();
        } else {
          missingDishIds.push(dishId);
        }
      }

      if (missingDishIds.length > 0) {
        const uniqueMissingIds = [...new Set(missingDishIds)];
        const dishDetailsQuery = transaction.request();
        const paramNames = uniqueMissingIds.map((id, index) => {
          const paramName = `dishId_${index}`;
          dishDetailsQuery.input(paramName, sql.UniqueIdentifier, id);
          return `@${paramName}`;
        });

        if (paramNames.length > 0) {
          const dishDetailsRes = await dishDetailsQuery.query(`
            SELECT DishId, DishGroupId FROM DishMaster 
            WHERE DishId IN (${paramNames.join(",")})
          `);
          
          (dishDetailsRes.recordset || []).forEach(row => {
            if (row.DishId && row.DishGroupId) {
              itemGroupIdMap[String(row.DishId).toLowerCase()] = String(row.DishGroupId).toLowerCase();
            }
          });
        }
      }

      const hasLoyaltyDishOrdered = Array.isArray(itemsList) && activeRules.length > 0 && itemsList.some(item => {
        const isReward = item.isDishReward === true || item.isDishReward === 1 || String(item.isDishReward).toLowerCase() === 'true';
        if (isReward) return false;
        const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
        return activeRules.some(rule => {
          const loyaltyType = rule.LoyaltyType || "Dish";
          if (loyaltyType === "DishGroup" && rule.PurchaseDishGroupId) {
            return itemGroupIdMap[itemDishIdLower] === String(rule.PurchaseDishGroupId).toLowerCase();
          } else if (loyaltyType === "Dish" && rule.PurchaseDishId) {
            return String(rule.PurchaseDishId).toLowerCase() === itemDishIdLower;
          }
          return false;
        });
      });

      let customerId;
      const custRes = await transaction.request()
        .input("Phone", sql.NVarChar(50), cleanPhone)
        .query("SELECT LoyaltyCustomerId, VisitCount, TotalVisits, RewardPending FROM LoyaltyCustomer WITH (UPDLOCK) WHERE Phone = @Phone");

      if (custRes.recordset.length === 0) {
        let initialVisitCount = 0;
        const primaryRule = activeRules[0];
        if (!isSplitDuplicate && primaryRule) {
          const primaryLoyaltyType = primaryRule.LoyaltyType || "Dish";
          const primaryPurchaseDishIdLower = primaryRule.PurchaseDishId ? String(primaryRule.PurchaseDishId).toLowerCase() : null;
          const primaryPurchaseGroupIdLower = primaryRule.PurchaseDishGroupId ? String(primaryRule.PurchaseDishGroupId).toLowerCase() : null;

          let transactionQty = 0;
          for (const item of itemsList) {
            const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
            if (item.isDishReward) continue;

            if (primaryLoyaltyType === "DishGroup" && primaryPurchaseGroupIdLower) {
              if (itemGroupIdMap[itemDishIdLower] === primaryPurchaseGroupIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            } else if (primaryLoyaltyType === "Dish" && primaryPurchaseDishIdLower) {
              if (itemDishIdLower === primaryPurchaseDishIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            }
          }
          const blockSize = (primaryRule.RequiredBills || 9) + 1;
          initialVisitCount = transactionQty % blockSize;
        } else if (!isSplitDuplicate && hasLoyaltyDishOrdered) {
          initialVisitCount = 1;
        }

        const initialTotalVisits = isSplitDuplicate ? 0 : 1;
        const insertCustRes = await transaction.request()
          .input("Phone", sql.NVarChar(50), cleanPhone)
          .input("Name", sql.NVarChar(255), name ? String(name).trim() : null)
          .input("VisitCount", sql.Int, initialVisitCount)
          .input("TotalVisits", sql.Int, initialTotalVisits)
          .query(`
            DECLARE @newCustId UNIQUEIDENTIFIER = NEWID();
            INSERT INTO LoyaltyCustomer (LoyaltyCustomerId, Phone, Name, VisitCount, TotalVisits, LastVisitDate)
            VALUES (@newCustId, @Phone, @Name, @VisitCount, @TotalVisits, GETDATE());
            SELECT @newCustId AS LoyaltyCustomerId;
          `);
        customerId = insertCustRes.recordset[0].LoyaltyCustomerId;
      } else {
        const cust = custRes.recordset[0];
        customerId = cust.LoyaltyCustomerId;

        // Fetch current states to calculate global visit count (carried forward balance of the main rule)
        const primaryRule = activeRules[0];
        let newVisitCount = cust.VisitCount;

        if (!isSplitDuplicate && primaryRule) {
          const stateRes = await transaction.request()
            .input("CustomerId", sql.UniqueIdentifier, customerId)
            .input("RuleId", sql.UniqueIdentifier, primaryRule.RuleId)
            .query(`
              SELECT CurrentCount FROM CustomerDishLoyaltyState WITH (UPDLOCK)
              WHERE CustomerId = @CustomerId AND RuleId = @RuleId
            `);
          
          let currentBalance = 0;
          if (stateRes.recordset.length > 0) {
            currentBalance = stateRes.recordset[0].CurrentCount || 0;
          }

          const primaryLoyaltyType = primaryRule.LoyaltyType || "Dish";
          const primaryPurchaseDishIdLower = primaryRule.PurchaseDishId ? String(primaryRule.PurchaseDishId).toLowerCase() : null;
          const primaryPurchaseGroupIdLower = primaryRule.PurchaseDishGroupId ? String(primaryRule.PurchaseDishGroupId).toLowerCase() : null;

          let transactionQty = 0;
          for (const item of itemsList) {
            const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
            if (item.isDishReward) continue;

            if (primaryLoyaltyType === "DishGroup" && primaryPurchaseGroupIdLower) {
              if (itemGroupIdMap[itemDishIdLower] === primaryPurchaseGroupIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            } else if (primaryLoyaltyType === "Dish" && primaryPurchaseDishIdLower) {
              if (itemDishIdLower === primaryPurchaseDishIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            }
          }

          // Compute new balance
          const blockSize = (primaryRule.RequiredBills || 9) + 1;
          newVisitCount = (currentBalance + transactionQty) % blockSize;
        }

        if (!isSplitDuplicate) {
          let newTotalVisits = cust.TotalVisits + 1;
          let newRewardsEarned = 0;
          let newRewardsRedeemed = 0;
          let newRewardPending = 0; // We resolve rewards on the fly during payment, no need to hold pending flag

          await transaction.request()
            .input("LoyaltyCustomerId", sql.UniqueIdentifier, customerId)
            .input("Name", sql.NVarChar(255), name ? String(name).trim() : null)
            .input("VisitCount", sql.Int, newVisitCount)
            .input("TotalVisits", sql.Int, newTotalVisits)
            .input("RewardsRedeemed", sql.Int, newRewardsRedeemed)
            .input("RewardsEarned", sql.Int, newRewardsEarned)
            .input("RewardPending", sql.Bit, newRewardPending)
            .query(`
              UPDATE LoyaltyCustomer 
              SET VisitCount = @VisitCount,
                  TotalVisits = @TotalVisits,
                  RewardsRedeemed = RewardsRedeemed + @RewardsRedeemed,
                  RewardsEarned = RewardsEarned + @RewardsEarned,
                  RewardPending = @RewardPending,
                  LastVisitDate = GETDATE(),
                  Name = CASE WHEN Name IS NULL OR Name = '' THEN ISNULL(@Name, Name) ELSE Name END
              WHERE LoyaltyCustomerId = @LoyaltyCustomerId
            `);
        }
      }

      // 5. Process Dish-Specific Loyalty Progress & Redemptions
      if (Array.isArray(itemsList) && activeRules.length > 0) {
        const redeemedRewards = itemsList.filter(i => {
          const isReward = i.isDishReward === true || i.isDishReward === 1 || String(i.isDishReward).toLowerCase() === 'true';
          return isReward;
        });

        // A. Process Paid Items (Increments)
        for (const rule of activeRules) {
          const loyaltyType = rule.LoyaltyType || "Dish";
          const rulePurchaseIdLower = rule.PurchaseDishId ? String(rule.PurchaseDishId).toLowerCase() : null;
          const ruleGroupIdLower = rule.PurchaseDishGroupId ? String(rule.PurchaseDishGroupId).toLowerCase() : null;
          
          let purchaseQty = 0;
          for (const item of itemsList) {
            const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
            if (item.isDishReward) continue;

            if (loyaltyType === "DishGroup" && ruleGroupIdLower) {
              if (itemGroupIdMap[itemDishIdLower] === ruleGroupIdLower) {
                purchaseQty += (item.Qty || item.qty || 1);
              }
            } else if (loyaltyType === "Dish" && rulePurchaseIdLower) {
              if (itemDishIdLower === rulePurchaseIdLower) {
                purchaseQty += (item.Qty || item.qty || 1);
              }
            }
          }

          if (purchaseQty > 0 && !isSplitDuplicate) {
            // Get current state
            const stateRes = await transaction.request()
              .input("CustomerId", sql.UniqueIdentifier, customerId)
              .input("RuleId", sql.UniqueIdentifier, rule.RuleId)
              .query(`
                SELECT CurrentCount, RewardsAvailable FROM CustomerDishLoyaltyState WITH (UPDLOCK)
                WHERE CustomerId = @CustomerId AND RuleId = @RuleId
              `);

            const blockSize = (rule.RequiredBills || 9) + 1;

            if (stateRes.recordset.length === 0) {
              const totalAccumulated = purchaseQty;
              const newRewards = Math.floor(totalAccumulated / blockSize);
              const finalCount = totalAccumulated % blockSize;

              await transaction.request()
                .input("CustomerId", sql.UniqueIdentifier, customerId)
                .input("RuleId", sql.UniqueIdentifier, rule.RuleId)
                .input("Count", sql.Int, finalCount)
                .input("NewRewards", sql.Int, newRewards)
                .query(`
                  INSERT INTO CustomerDishLoyaltyState (CustomerId, RuleId, CurrentCount, RewardsAvailable, RewardCyclesCompleted)
                  VALUES (@CustomerId, @RuleId, @Count, @NewRewards, 0)
                `);
            } else {
              const state = stateRes.recordset[0];
              const totalAccumulated = (state.CurrentCount || 0) + purchaseQty;
              const newRewards = Math.floor(totalAccumulated / blockSize);
              const finalCount = totalAccumulated % blockSize;

              await transaction.request()
                .input("CustomerId", sql.UniqueIdentifier, customerId)
                .input("RuleId", sql.UniqueIdentifier, rule.RuleId)
                .input("Count", sql.Int, finalCount)
                .input("NewRewards", sql.Int, newRewards)
                .query(`
                  UPDATE CustomerDishLoyaltyState
                  SET CurrentCount = @Count,
                      RewardsAvailable = RewardsAvailable + @NewRewards,
                      ModifiedOn = GETDATE()
                  WHERE CustomerId = @CustomerId AND RuleId = @RuleId
                `);
            }
          }
        }

        // B. Process Redemptions (Decrements)
        for (const redeemed of redeemedRewards) {
          const ruleId = redeemed.rewardRuleId || redeemed.RewardRuleId;
          const qty = redeemed.Qty || redeemed.qty || 1;

          if (ruleId) {
            await transaction.request()
              .input("CustomerId", sql.UniqueIdentifier, customerId)
              .input("RuleId", sql.UniqueIdentifier, ruleId)
              .input("Qty", sql.Int, qty)
              .query(`
                UPDATE CustomerDishLoyaltyState
                SET RewardCyclesCompleted = RewardCyclesCompleted + @Qty,
                    RewardsAvailable = CASE WHEN RewardsAvailable >= @Qty THEN RewardsAvailable - @Qty ELSE 0 END,
                    ModifiedOn = GETDATE()
                WHERE CustomerId = @CustomerId AND RuleId = @RuleId
              `);
          }
        }
      }

      await transaction.request()
        .input("LoyaltyCustomerId", sql.UniqueIdentifier, customerId)
        .input("SettlementId", sql.UniqueIdentifier, settlementId)
        .input("BillNo", sql.NVarChar(50), billNo)
        .input("IsRewardVisit", sql.Bit, hasRewardClaimed ? 1 : 0)
        .input("RewardDishId", sql.UniqueIdentifier, rewardDishId)
        .query(`
          INSERT INTO LoyaltyVisit (LoyaltyVisitId, LoyaltyCustomerId, SettlementId, BillNo, IsRewardVisit, RewardDishId)
          VALUES (NEWID(), @LoyaltyCustomerId, @SettlementId, @BillNo, @IsRewardVisit, @RewardDishId)
        `);

      await transaction.commit();
      console.log(`[Loyalty Post-Save Sync] Success: Phone=${cleanPhone}, BillNo=${billNo}`);
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("⚠️ [Loyalty Post-Save Sync Error] Failed:", err);
  }
}


router.post("/settlement/:id/change-payment", async (req, res) => {
  try {
    const { payMode, splits, memberId, creditCustomerId } = req.body;
    const settlementId = req.params.id;
    if (!payMode && (!splits || splits.length === 0)) {
      return res.status(400).json({ error: "payMode or splits is required" });
    }

    const pool = await poolPromise;
    
    const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(settlementId);
    let queryStr = `
      SELECT sh.SettlementID, sh.SysAmount, sh.SubTotal, sh.CreatedBy, sh.BusinessUnitId, sh.MemberId, sh.BillNo, ri.OrderId 
      FROM SettlementHeader sh
      LEFT JOIN RestaurantInvoice ri ON sh.SettlementID = ri.RestaurantBillId
    `;

    const request = pool.request();
    if (isGuid) {
      request.input("Sid", sql.UniqueIdentifier, settlementId);
      queryStr += " WHERE sh.SettlementID = @Sid";
    } else {
      request.input("OrderId", sql.Int, parseInt(settlementId, 10) || 0);
      queryStr += " WHERE sh.OrderId = @OrderId";
    }

    const shRes = await request.query(queryStr);
    
    let realSettlementId = settlementId;
    let totalBillAmount = 0;
    let CreatedBy = null;
    let BusinessUnitId = null;
    let oldMemberId = null;
    let BillNo = 'LEDGER_PAY';
    let OrderId = null;
    let isLedger = false;

    if (shRes.recordset.length === 0) {
      // Check CustomerCreditTransactions for LEDGER
      const ledgerResult = await pool.request()
        .input("TxId", sql.UniqueIdentifier, settlementId)
        .query("SELECT * FROM CustomerCreditTransactions WHERE TransactionId = @TxId");
      
      if (ledgerResult.recordset.length === 0) {
        return res.status(404).json({ error: "Order/Settlement/Ledger not found" });
      }
      isLedger = true;
      const ledger = ledgerResult.recordset[0];
      realSettlementId = ledger.TransactionId;
      totalBillAmount = Number(ledger.PaidAmount || 0);
      CreatedBy = ledger.CreatedBy;
      oldMemberId = ledger.MemberId;
      BillNo = ledger.Remarks || 'LEDGER_PAY';
    } else {
      const row = shRes.recordset[0];
      realSettlementId = row.SettlementID;
      totalBillAmount = Number(row.SysAmount || row.SubTotal || 0);
      CreatedBy = row.CreatedBy;
      BusinessUnitId = row.BusinessUnitId;
      oldMemberId = row.MemberId;
      BillNo = row.BillNo;
      OrderId = row.OrderId;
    }

    let finalSplits = splits;
    if (!finalSplits && payMode) {
      finalSplits = [{ payMode, amount: totalBillAmount }];
    }

    // Resolve paymodes from Paymode table
    const pmResult = await pool.request().query(`SELECT Position, PayMode, Description FROM [dbo].[Paymode]`);
    const activePaymodes = pmResult.recordset;

    const validatedSplits = [];
    const payModeNames = [];
    
    for (const split of finalSplits) {
      const pm = activePaymodes.find(x => 
        String(x.PayMode).trim().toUpperCase() === String(split.payMode).trim().toUpperCase() ||
        String(x.Description).trim().toUpperCase() === String(split.payMode).trim().toUpperCase() ||
        String(x.Position).trim() === String(split.payMode).trim()
      );
      if (!pm) {
        return res.status(400).json({ error: `Invalid payment mode: ${split.payMode}` });
      }
      
      const amt = split.amount === null || split.amount === undefined 
        ? (finalSplits.length === 1 ? totalBillAmount : 0)
        : Number(split.amount || 0);

      validatedSplits.push({
        payModeId: pm.Position,
        payMode: pm.PayMode,
        amount: amt
      });
      payModeNames.push(pm.PayMode);
    }

    // Verify sum of splits matches total bill amount
    const totalSplitsAmount = validatedSplits.reduce((sum, s) => sum + s.amount, 0);
    if (Math.abs(totalSplitsAmount - totalBillAmount) > 0.02) {
      return res.status(400).json({ 
        error: `Total split amount ($${totalSplitsAmount.toFixed(2)}) must equal total bill amount ($${totalBillAmount.toFixed(2)})` 
      });
    }

    if (isLedger) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        // Delete existing payment details for ledger collection
        await transaction.request()
          .input("Sid", sql.UniqueIdentifier, realSettlementId)
          .query(`
            DELETE FROM [dbo].[PaymentDetailCur] WHERE RestaurantBillId = @Sid;
            DELETE FROM [dbo].[PaymentDetail] WHERE RestaurantBillId = @Sid OR SettlementId = @Sid;
            DELETE FROM [dbo].[PaymentTransactionDetails] WHERE ReferenceId = @Sid AND ReferenceType = 'MEMBER';
          `);

        // Insert new payment details
        await processSplitPayments({
          referenceType: "MEMBER",
          referenceId: oldMemberId,
          payments: validatedSplits,
          transaction,
          cashierId: toGuidOrNull(CreatedBy)
        });

        // Update main ledger payment method
        const joinedPayMode = payModeNames.map(p => String(p).trim()).join(" + ");
        await transaction.request()
          .input("TxId", sql.UniqueIdentifier, realSettlementId)
          .input("PayMode", sql.NVarChar(50), joinedPayMode)
          .query("UPDATE CustomerCreditTransactions SET PaymentMethod = @PayMode WHERE TransactionId = @TxId");

        await transaction.commit();
        return res.json({ success: true, message: "Payment mode updated successfully" });
      } catch (txErr) {
        await transaction.rollback();
        throw txErr;
      }
    }

    // Fetch old payment records to revert previous credit balances if any
    const oldPaymentsRes = await pool.request()
      .input("Sid", sql.UniqueIdentifier, realSettlementId)
      .query(`
        SELECT ptd.PayModeId, ptd.Amount 
        FROM [dbo].[PaymentTransactionDetails] ptd
        WHERE ptd.ReferenceId = @Sid AND ptd.ReferenceType = 'BILL'
      `);

    const memberPmId = activePaymodes.find(x => String(x.PayMode).trim().toUpperCase() === 'MEMBER')?.Position;
    const creditPmId = activePaymodes.find(x => String(x.PayMode).trim().toUpperCase() === 'CREDIT')?.Position;

    let oldMemberAmount = 0;
    let oldCreditAmount = 0;
    oldPaymentsRes.recordset.forEach(p => {
      if (p.PayModeId === memberPmId) {
        oldMemberAmount += Number(p.Amount || 0);
      } else if (p.PayModeId === creditPmId) {
        oldCreditAmount += Number(p.Amount || 0);
      }
    });

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Revert old member/credit customer balances
      const totalOldAmt = oldMemberAmount + oldCreditAmount;
      if (totalOldAmt > 0 && oldMemberId) {
        const isMem = await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(oldMemberId))
          .query("SELECT MemberId FROM MemberMaster WHERE MemberId = @MemberId");
        
        if (isMem.recordset.length > 0) {
          await transaction.request()
            .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(oldMemberId))
            .input("AddAmt", sql.Decimal(18, 2), oldMemberAmount)
            .input("SubAmt", sql.Decimal(18, 2), oldCreditAmount)
            .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance + @AddAmt - @SubAmt WHERE MemberId = @MemberId");
        } else {
          await transaction.request()
            .input("CustomerId", sql.UniqueIdentifier, toGuidOrNull(oldMemberId))
            .input("Amount", sql.Decimal(18, 2), totalOldAmt)
            .query("UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance - @Amount WHERE CustomerId = @CustomerId");
        }

        // Delete old credit transaction logs
        await transaction.request()
          .input("Sid", sql.UniqueIdentifier, realSettlementId)
          .query("DELETE FROM CustomerCreditTransactions WHERE SettlementId = @Sid");
      }

      // 1. Read original start_date from PaymentDetailCur BEFORE deleting
      //    This is critical: Settlement screen filters by start_date, so new
      //    records must carry the same date as the original payment records.
      //    (DateEntry may be empty after Day End, causing start_date = NULL)
      const origStartDateRes = await transaction.request()
        .input("Sid", sql.UniqueIdentifier, realSettlementId)
        .query(`SELECT TOP 1 start_date FROM [dbo].[PaymentDetailCur] WHERE RestaurantBillId = @Sid`);
      const originalStartDate = origStartDateRes.recordset[0]?.start_date ?? null;

      // 2. Delete old auto-generated CashInEntry records for this settlement
      //    (processSplitPayments will re-insert them; avoid duplicates)
      await transaction.request()
        .input("Sid", sql.VarChar(100), String(realSettlementId))
        .query(`
          DELETE FROM CashInEntry
          WHERE (ReferenceNo = @Sid OR Remarks LIKE '%' + @Sid + '%')
            AND (Reason = 'Cash In' OR Reason = 'Ledger Payment')
        `);

      // 3. Delete existing payment records
      const deleteReq = new sql.Request(transaction);
      deleteReq.input("Sid", sql.UniqueIdentifier, realSettlementId);
      await deleteReq.query(`
        DELETE FROM [dbo].[PaymentDetailCur] WHERE RestaurantBillId = @Sid;
        DELETE FROM [dbo].[PaymentDetail] WHERE RestaurantBillId = @Sid OR SettlementId = @Sid;
        DELETE FROM [dbo].[PaymentTransactionDetails] WHERE ReferenceId = @Sid AND ReferenceType = 'BILL';
        DELETE FROM SettlementTotalSales WHERE SettlementID = @Sid;
        DELETE FROM [dbo].[SettlementDetail] WHERE SettlementId = @Sid;
        DELETE FROM SettlementTranDetail WHERE SettlementID = @Sid;
        DELETE FROM SettlementCreditSales WHERE SettlementID = @Sid;
      `);

      // 4. Insert new split payments — pass original start_date so
      //    PaymentDetailCur records are correctly dated for the Settlement screen
      await processSplitPayments({
        referenceType: "BILL",
        referenceId: realSettlementId,
        payments: validatedSplits,
        transaction,
        businessUnitId: toGuidOrNull(BusinessUnitId),
        cashierId: toGuidOrNull(CreatedBy),
        orderId: toGuidOrNull(OrderId),
        receiptCount: 1,
        startDate: originalStartDate   // ← preserve original business date
      });

      // 3. Update RestaurantInvoice & RestaurantInvoiceCur (PaymentTermCode)
      const firstSplitMode = validatedSplits[0].payMode.toUpperCase();
      const payModeCode = validatedSplits.length > 1 ? 3 : (firstSplitMode === "CASH" ? 1 : firstSplitMode === "CARD" ? 2 : 3);

      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, realSettlementId)
        .input("PayModeCode", sql.Int, payModeCode)
        .query("UPDATE RestaurantInvoice SET PaymentTermCode = @PayModeCode WHERE RestaurantBillId = @Sid");

      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, realSettlementId)
        .input("PayModeCode", sql.Int, payModeCode)
        .query("UPDATE RestaurantInvoiceCur SET PaymentTermCode = @PayModeCode WHERE RestaurantBillId = @Sid");

       // 4. Update SettlementHeader PayMode & MemberId
      const joinedPayMode = payModeNames.map(p => String(p).trim()).join(" + ");
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, realSettlementId)
        .input("PayMode", sql.NVarChar(100), joinedPayMode)
        .input("MemberId", sql.UniqueIdentifier, (memberId || creditCustomerId) ? toGuidOrNull(memberId || creditCustomerId) : null)
        .query(`
          IF COL_LENGTH('SettlementHeader', 'PayMode') IS NOT NULL
          BEGIN
            EXEC sp_executesql N'UPDATE SettlementHeader SET PayMode = @pPayMode, MemberId = @pMemberId WHERE SettlementID = @pSid', N'@pPayMode NVARCHAR(100), @pMemberId UNIQUEIDENTIFIER, @pSid UNIQUEIDENTIFIER', @pPayMode = @PayMode, @pMemberId = @MemberId, @pSid = @Sid
          END
          ELSE
          BEGIN
            UPDATE SettlementHeader SET MemberId = @MemberId WHERE SettlementID = @Sid
          END
        `);

      // 5. Update new member/customer credit balance
      let newMemberAmount = 0;
      let newCreditAmount = 0;
      validatedSplits.forEach(p => {
        if (String(p.payMode).trim().toUpperCase() === 'MEMBER') {
          newMemberAmount += Number(p.amount || 0);
        } else if (String(p.payMode).trim().toUpperCase() === 'CREDIT') {
          newCreditAmount += Number(p.amount || 0);
        }
      });

      // Member balance update (prepaid portion - subtract from CurrentBalance)
      if (newMemberAmount > 0 && memberId) {
        await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
          .input("Amount", sql.Decimal(18, 2), newMemberAmount)
          .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance - @Amount WHERE MemberId = @MemberId");
        
        await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(memberId))
          .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(realSettlementId))
          .input("BillNo", sql.NVarChar(50), BillNo || 'CHANGE_PAY')
          .input("BillAmount", sql.Decimal(18, 2), newMemberAmount)
          .input("PaidAmount", sql.Decimal(18, 2), newMemberAmount)
          .input("OutstandingAmount", sql.Decimal(18, 2), 0)
          .input("Status", sql.NVarChar(20), 'PAID')
          .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(CreatedBy))
          .query(`
            INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType)
            VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @BillAmount, @PaidAmount, @OutstandingAmount, @Status, 'Payment mode change member prepaid', @CreatedBy, 'MEMBER')
          `);
      }

      // Credit Customer balance update (outstanding credit portion)
      const targetCreditId = creditCustomerId || memberId;
      if (newCreditAmount > 0 && targetCreditId) {
        const isMem = await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(targetCreditId))
          .query("SELECT MemberId FROM MemberMaster WHERE MemberId = @MemberId");
        
        const isMemberCust = isMem.recordset.length > 0;

        if (isMemberCust) {
          await transaction.request()
            .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(targetCreditId))
            .input("Amount", sql.Decimal(18, 2), newCreditAmount)
            .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance + @Amount WHERE MemberId = @MemberId");
          
          await transaction.request()
            .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(targetCreditId))
            .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(realSettlementId))
            .input("BillNo", sql.NVarChar(50), BillNo || 'CHANGE_PAY')
            .input("BillAmount", sql.Decimal(18, 2), newCreditAmount)
            .input("PaidAmount", sql.Decimal(18, 2), 0)
            .input("OutstandingAmount", sql.Decimal(18, 2), newCreditAmount)
            .input("Status", sql.NVarChar(20), 'OPEN')
            .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(CreatedBy))
            .query(`
              INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType)
              VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @BillAmount, @PaidAmount, @OutstandingAmount, @Status, 'Payment mode change member credit', @CreatedBy, 'MEMBER')
            `);
        } else {
          await transaction.request()
            .input("CustomerId", sql.UniqueIdentifier, toGuidOrNull(targetCreditId))
            .input("Amount", sql.Decimal(18, 2), newCreditAmount)
            .query("UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance + @Amount WHERE CustomerId = @CustomerId");
          
          await transaction.request()
            .input("MemberId", sql.UniqueIdentifier, toGuidOrNull(targetCreditId))
            .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(realSettlementId))
            .input("BillNo", sql.NVarChar(50), BillNo || 'CHANGE_PAY')
            .input("BillAmount", sql.Decimal(18, 2), newCreditAmount)
            .input("PaidAmount", sql.Decimal(18, 2), 0)
            .input("OutstandingAmount", sql.Decimal(18, 2), newCreditAmount)
            .input("Status", sql.NVarChar(20), 'OPEN')
            .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(CreatedBy))
            .query(`
              INSERT INTO CustomerCreditTransactions (MemberId, SettlementId, BillNo, TransactionType, BillAmount, PaidAmount, OutstandingAmount, Status, Remarks, CreatedBy, CustomerType)
              VALUES (@MemberId, @SettlementId, @BillNo, 'CREDIT_SALE', @BillAmount, @PaidAmount, @OutstandingAmount, @Status, 'Payment mode change credit purchase', @CreatedBy, 'CREDIT')
            `);
        }
      }

      await transaction.commit();
      res.json({ success: true, message: "Payment mode updated successfully" });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/settlement/:id/void-item", async (req, res) => {
  try {
    const settlementId = req.params.id;
    const { orderDetailId, orderDetailIds } = req.body;
    const idsToVoid = orderDetailIds || (orderDetailId ? [orderDetailId] : []);
    if (idsToVoid.length === 0) {
      return res.status(400).json({ error: "orderDetailId or orderDetailIds is required" });
    }

    const pool = await poolPromise;

    // Check item details
    const itemQuery = await pool.request()
      .input("Sid", sql.UniqueIdentifier, settlementId)
      .query(`
        SELECT OrderDetailId, DishId, Qty, Price, Status FROM SettlementItemDetail 
        WHERE SettlementID = @Sid AND Status <> 'VOIDED'
      `);

    const matchingItems = itemQuery.recordset.filter(item => 
      idsToVoid.includes(item.OrderDetailId) || idsToVoid.includes(item.DishId)
    );

    if (matchingItems.length === 0) {
      return res.status(404).json({ error: "No matching active items found in order" });
    }

    let totalQty = 0;
    let totalVoidAmount = 0;
    for (const item of matchingItems) {
      totalQty += Number(item.Qty || 0);
      totalVoidAmount += Number(item.Qty || 0) * Number(item.Price || 0);
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1. Update SettlementItemDetail Status for matching items
      for (const item of matchingItems) {
        const itemId = item.OrderDetailId || item.DishId;
        await transaction.request()
          .input("Sid", sql.UniqueIdentifier, settlementId)
          .input("Odid", sql.NVarChar(100), itemId)
          .query(`
            UPDATE SettlementItemDetail SET Status = 'VOIDED' 
            WHERE SettlementID = @Sid AND (OrderDetailId = @Odid OR DishId = @Odid)
          `);
      }

      // 2. Update SettlementHeader VoidItemQty, VoidItemAmount, SubTotal, SysAmount, ManualAmount
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .input("Qty", sql.Int, totalQty)
        .input("Amount", sql.Decimal(18, 2), totalVoidAmount)
        .query(`
          UPDATE SettlementHeader 
          SET VoidItemQty = ISNULL(VoidItemQty, 0) + @Qty,
              VoidItemAmount = ISNULL(VoidItemAmount, 0) + @Amount,
              SubTotal = CASE WHEN ISNULL(SubTotal, 0) > @Amount THEN SubTotal - @Amount ELSE 0 END,
              SysAmount = CASE WHEN ISNULL(SysAmount, 0) > @Amount THEN SysAmount - @Amount ELSE 0 END,
              ManualAmount = CASE WHEN ISNULL(ManualAmount, 0) > @Amount THEN ManualAmount - @Amount ELSE 0 END
          WHERE SettlementID = @Sid
        `);

      // 3. Update SettlementTotalSales
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .input("Amount", sql.Decimal(18, 2), totalVoidAmount)
        .query(`
          UPDATE SettlementTotalSales 
          SET SysAmount = CASE WHEN ISNULL(SysAmount, 0) > @Amount THEN SysAmount - @Amount ELSE 0 END,
              ManualAmount = CASE WHEN ISNULL(ManualAmount, 0) > @Amount THEN ManualAmount - @Amount ELSE 0 END
          WHERE SettlementID = @Sid
        `);

      // 4. Update SettlementDetail
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .input("Amount", sql.Decimal(18, 2), totalVoidAmount)
        .query(`
          UPDATE SettlementDetail 
          SET SysAmount = CASE WHEN ISNULL(SysAmount, 0) > @Amount THEN SysAmount - @Amount ELSE 0 END,
              ManualAmount = CASE WHEN ISNULL(ManualAmount, 0) > @Amount THEN ManualAmount - @Amount ELSE 0 END
          WHERE SettlementId = @Sid
        `);

      // 5. Update PaymentDetailCur, PaymentDetail, and PaymentTransactionDetails
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .input("Amount", sql.Decimal(18, 2), totalVoidAmount)
        .query(`
          UPDATE PaymentDetailCur 
          SET Amount = CASE WHEN ISNULL(Amount, 0) > @Amount THEN Amount - @Amount ELSE 0 END
          WHERE RestaurantBillId = @Sid;

          UPDATE PaymentDetail 
          SET Amount = CASE WHEN ISNULL(Amount, 0) > @Amount THEN Amount - @Amount ELSE 0 END
          WHERE RestaurantBillId = @Sid;

          UPDATE PaymentTransactionDetails 
          SET Amount = CASE WHEN ISNULL(Amount, 0) > @Amount THEN Amount - @Amount ELSE 0 END
          WHERE ReferenceId = @Sid AND ReferenceType = 'BILL';
        `);

      await transaction.commit();
      res.json({ success: true, message: "Items voided successfully" });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/settlement/:id/cancel", async (req, res) => {
  try {
    const settlementId = req.params.id;
    const { reason } = req.body;
    const pool = await poolPromise;

    // Get order info
    const shQuery = await pool.request()
      .input("Sid", sql.UniqueIdentifier, settlementId)
      .query("SELECT SysAmount, IsCancelled FROM SettlementHeader WHERE SettlementID = @Sid");

    if (shQuery.recordset.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const sh = shQuery.recordset[0];
    if (sh.IsCancelled) {
      return res.status(400).json({ error: "Order is already cancelled" });
    }

    // Get sum of qty
    const itemsQuery = await pool.request()
      .input("Sid", sql.UniqueIdentifier, settlementId)
      .query("SELECT SUM(Qty) as TotalQty FROM SettlementItemDetail WHERE SettlementID = @Sid");
    const totalQty = itemsQuery.recordset[0]?.TotalQty || 0;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1. Update SettlementHeader
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .input("Reason", sql.NVarChar(255), reason || "Manual Cancellation")
        .input("Qty", sql.Int, totalQty)
        .input("Amount", sql.Decimal(18, 2), sh.SysAmount)
        .query(`
          UPDATE SettlementHeader 
          SET IsCancelled = 1,
              CancellationReason = @Reason,
              VoidItemQty = @Qty,
              VoidItemAmount = @Amount
          WHERE SettlementID = @Sid
        `);

      // 2. Update RestaurantInvoice & RestaurantInvoiceCur (StatusCode = 4)
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .query("UPDATE RestaurantInvoice SET StatusCode = 4 WHERE RestaurantBillId = @Sid");

      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .query("UPDATE RestaurantInvoiceCur SET StatusCode = 4 WHERE RestaurantBillId = @Sid");

      // 3. Update SettlementItemDetail items to VOIDED
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .query("UPDATE SettlementItemDetail SET Status = 'VOIDED' WHERE SettlementID = @Sid");

      // 4. Delete from LoyaltyVisit if exists
      await transaction.request()
        .input("Sid", sql.UniqueIdentifier, settlementId)
        .query("DELETE FROM LoyaltyVisit WHERE SettlementId = @Sid");

      await transaction.commit();
      res.json({ success: true, message: "Order cancelled successfully" });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
