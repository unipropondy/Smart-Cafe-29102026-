const sql = require('mssql');
const { getCompanySettings } = require('./settingsCache');

/**
 * Normalizes payment modes to match frontend categories
 */
const normalizePayMode = (paymentMethod = "CASH") => {
  const raw = String(paymentMethod || "CASH").toUpperCase().trim();
  if (raw.includes("CASH") || raw === "CAS") return "CASH";
  if (raw.includes("CARD") || raw.includes("VISA") || raw.includes("MASTER") || raw.includes("AMEX") || raw.includes("DINERS")) return "CARD";
  if (raw.includes("GRAB") || raw === "10") return "GRAB";
  if (raw.includes("FOODPANDA") || raw === "9") return "FOODPANDA";
  if (raw.includes("PAYNOW") || raw === "3" || raw.includes("PAY NOW")) return "PAYNOW";
  if (raw.includes("FOC") || raw === "4" || raw.includes("FREE")) return "FOC";
  if (raw.includes("UPI") || raw.includes("GPAY") || raw.includes("PHONE") || raw.includes("PAYTM")) return "UPI";
  if (raw.includes("NETS") || raw === "2") return "NETS";
  if (raw.includes("MEMBER") || raw === "5") return "MEMBER";
  if (raw.includes("CREDIT") || raw === "6") return "CREDIT";
  return raw;
};

/**
 * Fetch and compute full sales report data for a given date range
 */
async function fetchFullReportData(startDateStr, endDateStr, pool, cashierFilter = null) {
  const companySettings = await getCompanySettings();
  
  const sgtStart = `CAST('${startDateStr}' AS DATE)`;
  const sgtEnd = `DATEADD(DAY, 1, CAST('${endDateStr}' AS DATE))`;

  // 1. Fetch combined sales list (same logic as /all endpoint)
  const shWhere = `CAST(COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE), CAST(sh.CreatedOn AS DATE)) AS DATE) >= CAST('${startDateStr}' AS DATE) AND CAST(COALESCE(sh.start_date, CAST(sh.LastSettlementDate AS DATE), CAST(sh.CreatedOn AS DATE)) AS DATE) <= CAST('${endDateStr}' AS DATE)`;
  const cctWhere = `CAST(COALESCE(cct.start_date, CAST(cct.CreatedDate AS DATE)) AS DATE) >= CAST('${startDateStr}' AS DATE) AND CAST(COALESCE(cct.start_date, CAST(cct.CreatedDate AS DATE)) AS DATE) <= CAST('${endDateStr}' AS DATE)`;

  const salesQuery = `
    SELECT 
      sh.SettlementID, 
      sh.LastSettlementDate AS SettlementDate, 
      sh.BillNo AS OrderId, 
      sh.OrderType,
      sh.TableNo, 
      sh.Section, 
      sh.CashierId, 
      sh.BillNo, 
      sh.SER_NAME,
      COALESCE(sh.entry_status, ro_cur.entry_status) AS entryStatus,
      sts.PayMode as RawPayMode,
      ISNULL(sts.SysAmount, sh.SysAmount) as SysAmount,
      sh.SubTotal as SubTotal,
      ISNULL(sh.DiscountAmount, 0) as DiscountAmount,
      sh.DiscountType as DiscountType,
      ISNULL(sh.ServiceCharge, 0) as ServiceCharge,
      ISNULL(sh.TotalTax, 0) as TotalTax,
      ISNULL(sts.ReceiptCount, 0) as ReceiptCount,
      ISNULL(sh.VoidItemQty, 0) as VoidQty,
      ISNULL(sh.VoidItemAmount, 0) as VoidAmount,
      sh.IsCancelled,
      sh.CancellationReason,
      sh.RoundedBy as RoundedBy,
      ISNULL(cct_sale.OutstandingAmount, 0) AS OutstandingAmount
    FROM SettlementHeader sh
    LEFT JOIN RestaurantOrderCur ro_cur ON sh.BillNo = ro_cur.OrderNumber
    LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
    LEFT JOIN CustomerCreditTransactions cct_sale ON sh.SettlementID = cct_sale.SettlementId AND cct_sale.TransactionType = 'CREDIT_SALE'
    WHERE ${shWhere}

    UNION ALL

    SELECT 
      cct.TransactionId AS SettlementID,
      cct.CreatedDate AS SettlementDate,
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
      NULL AS entryStatus,
      cct.PaymentMethod AS RawPayMode,
      cct.PaidAmount AS SysAmount,
      cct.PaidAmount AS SubTotal,
      0 AS DiscountAmount,
      NULL AS DiscountType,
      0 AS ServiceCharge,
      0 AS TotalTax,
      1 AS ReceiptCount,
      0 AS VoidQty,
      0 AS VoidAmount,
      0 AS IsCancelled,
      NULL AS CancellationReason,
      0 AS RoundedBy,
      0 AS OutstandingAmount
    FROM CustomerCreditTransactions cct
    LEFT JOIN CreditCustomerMaster m ON cct.MemberId = m.CustomerId AND (cct.CustomerType = 'CREDIT' OR cct.CustomerType IS NULL)
    LEFT JOIN MemberMaster mm ON cct.MemberId = mm.MemberId AND (cct.CustomerType = 'MEMBER' OR (cct.CustomerType IS NULL AND m.CustomerId IS NULL))
    WHERE cct.TransactionType = 'PAYMENT' AND ${cctWhere}
  `;

  const salesResult = await pool.request().query(salesQuery);
  let salesList = salesResult.recordset || [];

  if (cashierFilter && cashierFilter !== 'ALL') {
    const filterStr = String(cashierFilter).toLowerCase().trim();
    salesList = salesList.filter(s => {
      const cid = String(s.CashierId || '').toLowerCase().trim();
      const cname = String(s.SER_NAME || '').toLowerCase().trim();
      return cid === filterStr || cname.includes(filterStr) || filterStr.includes(cid);
    });
  }

  // 2. Compute Metrics matching frontend sales-report.tsx
  const paymodesRes = await pool.request().query("SELECT Position, PayMode, Description, Active FROM [dbo].[Paymode] ORDER BY Position ASC");
  const allPaymodes = paymodesRes.recordset || [];
  const activePaymodes = allPaymodes.filter(pm => pm.Active);

  let totalSales = 0;
  let totalTransactions = 0;
  let totalItems = 0;
  let totalVoids = 0;
  let totalVoidAmount = 0;
  let cancelledCount = 0;
  let cancelledAmount = 0;
  let memberPaymentsCollected = 0;
  let creditPaymentsCollected = 0;

  const breakdown = {};
  const breakdownCounts = {};
  allPaymodes.forEach(pm => {
    const key = ((pm.Description && pm.Description.trim()) || pm.PayMode).toUpperCase().trim();
    breakdown[key] = 0;
    breakdownCounts[key] = 0;
  });
  let creditOutstanding = 0;

  let dineInCount = 0;
  let takeawayCount = 0;

  // Deduplicate sales by SettlementID + PayMode (or combined) to count transactions properly
  const uniqueTransactions = new Map();
  salesList.forEach(s => {
    if (s.OrderType !== 'LEDGER' && !s.IsCancelled) {
      const isSubsequentSplit = s.SettlementID && String(s.SettlementID).includes("-") && String(s.SettlementID).split("-").pop().match(/^\d+$/);
      if (!isSubsequentSplit) {
        uniqueTransactions.set(s.SettlementID, s);
      }
    }
  });

  salesList.forEach(s => {
    const isSubsequentSplit = s.SettlementID && String(s.SettlementID).includes("-") && String(s.SettlementID).split("-").pop().match(/^\d+$/);

    if (s.IsCancelled) {
      if (!isSubsequentSplit) {
        cancelledCount += 1;
        cancelledAmount += s.VoidAmount || 0;
      }
      return;
    }

    if (s.OrderType === 'LEDGER') {
      const isCredit = s.OrderId === 'Credit Payment Collected';
      if (isCredit) {
        creditPaymentsCollected += s.SysAmount || 0;
      } else {
        memberPaymentsCollected += s.SysAmount || 0;
      }
      return;
    }

    totalSales += s.SysAmount || 0;
    if (!isSubsequentSplit) {
      totalItems += (s.ReceiptCount || 0);
      totalVoids += s.VoidQty || 0;
      totalVoidAmount += s.VoidAmount || 0;
    }

     const rawMode = String(s.RawPayMode || "").toUpperCase().trim();
     // First pass: try exact match against all database payment modes
     let matchedMode = allPaymodes.find(pm => {
       const name = pm.PayMode.toUpperCase().trim();
       const desc = ((pm.Description && pm.Description.trim()) || pm.PayMode).toUpperCase().trim();
       const pos = String(pm.Position || "").trim();
       return rawMode === name || rawMode === desc || rawMode === pos;
     });

    // Second pass: if no exact match, try greedy/wildcard match against all database payment modes
    if (!matchedMode) {
      matchedMode = allPaymodes.find(pm => {
        const name = pm.PayMode.toUpperCase().trim();
        const desc = ((pm.Description && pm.Description.trim()) || pm.PayMode).toUpperCase().trim();
        if ((name === "FOC" || desc === "FOC" || name.includes("FREE") || desc.includes("FREE")) &&
            (rawMode.includes("FOC") || rawMode === "4" || rawMode.includes("FREE"))) {
          return true;
        }
        if ((name === "PAYNOW" || desc === "PAYNOW" || name === "PAY NOW" || desc === "PAY NOW" || name === "UPI" || name === "GPAY") &&
            (rawMode.includes("PAYNOW") || rawMode.includes("PAY NOW") || rawMode.includes("UPI") || rawMode.includes("GPAY") || rawMode.includes("PHONE") || rawMode.includes("PAYTM"))) {
          return true;
        }
        if ((name === "CASH" || desc === "CASH" || name === "CAS") && (rawMode === "CASH" || rawMode === "CAS")) {
          return true;
        }
        return false;
      });
    }

    if (matchedMode) {
      const name = ((matchedMode.Description && matchedMode.Description.trim()) || matchedMode.PayMode).toUpperCase().trim();
      breakdown[name] = (breakdown[name] || 0) + (s.SysAmount || 0);
      breakdownCounts[name] = (breakdownCounts[name] || 0) + 1;
      if (name === "CREDIT") {
        creditOutstanding += Number(s.OutstandingAmount) || 0;
      }
    } else {
      const fallbackMode = normalizePayMode(s.RawPayMode);
      breakdown[fallbackMode] = (breakdown[fallbackMode] || 0) + (s.SysAmount || 0);
      breakdownCounts[fallbackMode] = (breakdownCounts[fallbackMode] || 0) + 1;
      if (fallbackMode === "CREDIT") {
        creditOutstanding += Number(s.OutstandingAmount) || 0;
      }
    }

    const isTakeaway = s.OrderType === "TAKEAWAY" || s.Section === "TAKEAWAY" || (!s.OrderType && s.TableNo && String(s.TableNo).startsWith("TW-"));
    if (isTakeaway) {
      takeawayCount += 1;
    } else {
      dineInCount += 1;
    }
  });

  totalTransactions = uniqueTransactions.size;
  const totalOrders = totalTransactions;

  const paymentBreakdownTotal = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
  const totalCollections = (paymentBreakdownTotal - (breakdown["CREDIT"] || 0) - (breakdown["FOC"] || 0)) + memberPaymentsCollected + creditPaymentsCollected;

  const avgCheck = totalTransactions > 0 ? totalSales / totalTransactions : 0;
  let avgItems = totalTransactions > 0 ? totalItems / totalTransactions : 0;
  let perItem = totalItems > 0 ? totalSales / totalItems : 0;

  const orderTypesTotal = dineInCount + takeawayCount;
  const dineInPct = orderTypesTotal > 0 ? (dineInCount / orderTypesTotal) * 100 : 0;
  const takeawayPct = orderTypesTotal > 0 ? (takeawayCount / orderTypesTotal) * 100 : 0;
  const qrOrderCount = 0;
  const qrPct = totalTransactions > 0 ? (qrOrderCount / totalTransactions) * 100 : 0;

  // 3. Fetch category report (AppReport + ProfessionalReport union)
  const categoryQuery = `
    WITH AppReport AS (
      SELECT
        ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')) AS categoryName,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') = 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.DiscountAmount, 0) + (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0) * (ISNULL(sh.DiscountAmount, 0) / NULLIF(sh.SubTotal, 0))) AS decimal(18, 2)) ELSE 0 END) AS discountAmount,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST((ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) - (ISNULL(sid.DiscountAmount, 0) + (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0) * (ISNULL(sh.DiscountAmount, 0) / NULLIF(sh.SubTotal, 0)))) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
      FROM SettlementHeader sh
      INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
      LEFT JOIN DishMaster d ON sid.DishId = d.DishId
      LEFT JOIN DishGroupMaster dg ON COALESCE(sid.DishGroupId, d.DishGroupId) = dg.DishGroupId
      LEFT JOIN CategoryMaster cm ON COALESCE(sid.CategoryId, dg.CategoryId) = cm.CategoryId
      WHERE ${shWhere} AND ISNULL(sid.Qty, 0) > 0 AND ISNULL(sh.IsCancelled, 0) = 0
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
      WHERE ri.start_date >= CAST('${startDateStr}' AS DATE) AND ri.start_date <= CAST('${endDateStr}' AS DATE)
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
      WHERE ro.start_date >= CAST('${startDateStr}' AS DATE) AND ro.start_date <= CAST('${endDateStr}' AS DATE)
        AND ISNULL(ro.StatusCode, 0) = 3
        AND NOT EXISTS (
          SELECT 1 FROM SettlementHeader sh_dup 
          WHERE sh_dup.BillNo = ro.OrderNumber
        )
      GROUP BY ISNULL(cm.CategoryName, 'Unmapped')
    )
    SELECT 
      categoryName AS Category, 
      SUM(totalQty) AS Qty, 
      SUM(voidQty) AS Voided, 
      SUM(discountAmount) AS Discount, 
      SUM(totalAmount) AS Sales
    FROM (
      SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM AppReport
      UNION ALL
      SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM LegacyReport
      UNION ALL
      SELECT CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM ProfessionalReport
    ) ReportRows
    GROUP BY categoryName
    HAVING SUM(totalQty) > 0 OR SUM(totalAmount) > 0
    ORDER BY Sales DESC, Qty DESC, categoryName ASC
  `;

  const categoryResult = await pool.request().query(categoryQuery);
  const categoriesList = categoryResult.recordset || [];

  // 4. Fetch dish/item wise report
  const dishQuery = `
    WITH AppReport AS (
      SELECT
        ISNULL(NULLIF(LTRIM(RTRIM(sid.DishName)), ''), ISNULL(d.Name, 'Unknown')) AS dishName,
        ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped')) AS categoryName,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS totalQty,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') = 'VOIDED' THEN CAST(ISNULL(sid.Qty, 0) AS decimal(18, 3)) ELSE 0 END) AS voidQty,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST(ISNULL(sid.DiscountAmount, 0) + (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0) * (ISNULL(sh.DiscountAmount, 0) / NULLIF(sh.SubTotal, 0))) AS decimal(18, 2)) ELSE 0 END) AS discountAmount,
        SUM(CASE WHEN ISNULL(sid.Status, 'NORMAL') <> 'VOIDED' THEN CAST((ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0)) - (ISNULL(sid.DiscountAmount, 0) + (ISNULL(sid.Qty, 0) * ISNULL(sid.Price, 0) * (ISNULL(sh.DiscountAmount, 0) / NULLIF(sh.SubTotal, 0)))) AS decimal(18, 2)) ELSE 0 END) AS totalAmount
      FROM SettlementHeader sh
      INNER JOIN SettlementItemDetail sid ON sh.SettlementID = sid.SettlementID
      LEFT JOIN DishMaster d ON sid.DishId = d.DishId
      LEFT JOIN DishGroupMaster dg ON COALESCE(sid.DishGroupId, d.DishGroupId) = dg.DishGroupId
      LEFT JOIN CategoryMaster cm ON COALESCE(sid.CategoryId, dg.CategoryId) = cm.CategoryId
      WHERE ${shWhere} AND ISNULL(sh.IsCancelled, 0) = 0
        AND EXISTS (SELECT 1 FROM SettlementTotalSales WHERE SettlementID = sh.SettlementID)
      GROUP BY 
        ISNULL(NULLIF(LTRIM(RTRIM(sid.DishName)), ''), ISNULL(d.Name, 'Unknown')), 
        ISNULL(NULLIF(LTRIM(RTRIM(sid.CategoryName)), ''), ISNULL(cm.CategoryName, 'Unmapped'))
    ),
    LegacyReport AS (
      SELECT
        ISNULL(d.Name, 'Unknown') AS dishName,
        ISNULL(cm.CategoryName, 'Unmapped') AS categoryName,
        ISNULL(dg.DishGroupName, 'Unmapped') AS subCategoryName,
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
      WHERE ri.start_date >= CAST('${startDateStr}' AS DATE) AND ri.start_date <= CAST('${endDateStr}' AS DATE)
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
        ISNULL(d.Name, 'Unknown') AS dishName,
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
      WHERE ro.start_date >= CAST('${startDateStr}' AS DATE) AND ro.start_date <= CAST('${endDateStr}' AS DATE)
        AND ISNULL(ro.StatusCode, 0) = 3
        AND NOT EXISTS (
          SELECT 1 FROM SettlementHeader sh_dup 
          WHERE sh_dup.BillNo = ro.OrderNumber
        )
      GROUP BY ISNULL(d.Name, 'Unknown'), ISNULL(cm.CategoryName, 'Unmapped')
    )
    SELECT 
      dishName AS Item, 
      categoryName AS Category, 
      SUM(totalQty) AS Qty, 
      SUM(voidQty) AS Voided, 
      SUM(discountAmount) AS Discount, 
      SUM(totalAmount) AS Sales
    FROM (
      SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM AppReport
      UNION ALL
      SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM LegacyReport
      UNION ALL
      SELECT CAST(dishName AS NVARCHAR(255)) AS dishName, CAST(categoryName AS NVARCHAR(255)) AS categoryName, CAST(totalQty AS decimal(18,3)) AS totalQty, CAST(voidQty AS decimal(18,3)) AS voidQty, CAST(discountAmount AS decimal(18,2)) AS discountAmount, CAST(totalAmount AS decimal(18,2)) AS totalAmount FROM ProfessionalReport
    ) ReportRows
    GROUP BY dishName, categoryName
    HAVING SUM(totalQty) > 0 OR SUM(totalAmount) > 0
    ORDER BY Sales DESC, Qty DESC, dishName ASC
  `;

  const dishResult = await pool.request().query(dishQuery);
  const itemsList = dishResult.recordset || [];

  // Recalculate totalItems based on the actual sum of category quantities to ensure 100% consistency across cards and reports
  totalItems = categoriesList.reduce((sum, c) => sum + (Number(c.Qty) || 0), 0);
  avgItems = totalTransactions > 0 ? totalItems / totalTransactions : 0;
  perItem = totalItems > 0 ? totalSales / totalItems : 0;

  const artistQuery = `
    SELECT 
      a.CustomerName AS Name,
      COALESCE(a.TargetAmount, a.Amount, 0) AS TargetAmount,
      ISNULL(sales.Achieved, 0) AS ActualSales
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
    ORDER BY a.CustomerName ASC;
  `;

  const artistResult = await pool.request().query(artistQuery);
  const artistSalesList = artistResult.recordset || [];

  // 5b. Login-wise cashier breakdown (for PDF cashier section)
  const loginWiseQuery = `
    SELECT
      ISNULL(um.FullName, ISNULL(um.UserName, sh.CashierId)) AS CashierName,
      sh.CashierId,
      COUNT(DISTINCT sh.SettlementID) AS TotalBills,
      SUM(ISNULL(sh.SysAmount, 0)) AS TotalSales,
      SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) = 'CASH' THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS CashAmount,
      SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) = 'CARD' THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS CardAmount,
      SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) = 'NETS' THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS NetsAmount,
      SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) = 'PAYNOW' THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS PayNowAmount,
      SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) = 'CREDIT' THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS CreditAmount
    FROM SettlementHeader sh
    LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
    LEFT JOIN UserMaster um ON LOWER(CAST(sh.CashierId AS VARCHAR(100))) = LOWER(CAST(um.UserId AS VARCHAR(100)))
      OR LOWER(CAST(sh.CashierId AS VARCHAR(100))) = LOWER(CAST(um.UserName AS VARCHAR(100)))
    WHERE sh.IsCancelled = 0
      AND ${shWhere.replace(/sh\./g, 'sh.')}
    GROUP BY sh.CashierId, ISNULL(um.FullName, ISNULL(um.UserName, sh.CashierId))
    ORDER BY TotalSales DESC;
  `;
  let loginWiseSales = [];
  try {
    const loginWiseResult = await pool.request().query(loginWiseQuery);
    loginWiseSales = (loginWiseResult.recordset || []).map(r => ({
      CashierId: r.CashierId,
      CashierName: r.CashierName || String(r.CashierId || 'UNKNOWN'),
      TotalBills: Number(r.TotalBills) || 0,
      TotalSales: Number(r.TotalSales) || 0,
      CashAmount: Number(r.CashAmount) || 0,
      CardAmount: Number(r.CardAmount) || 0,
      NetsAmount: Number(r.NetsAmount) || 0,
      PayNowAmount: Number(r.PayNowAmount) || 0,
      CreditAmount: Number(r.CreditAmount) || 0,
    }));
  } catch (lwErr) {
    console.warn('[reportDataFetcher] login-wise query failed (non-fatal):', lwErr.message);
  }

  // 6. Format SGT time period string
  const formatSgtDate = (dateStr) => {
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };

  const periodStr = (startDateStr === endDateStr) ? startDateStr : `${startDateStr} to ${endDateStr}`;

  // Compute trendData dynamically
  const trendData = [];
  if (startDateStr === endDateStr) {
    // Group by hour
    const hourlyMap = {};
    salesList.forEach(s => {
      if (s.IsCancelled || s.OrderType === 'LEDGER') return;
      const d = new Date(s.SettlementDate);
      const hour = d.getHours();
      const hourKey = `${String(hour).padStart(2, '0')}:00`;
      hourlyMap[hourKey] = (hourlyMap[hourKey] || 0) + (s.SysAmount || 0);
    });
    const hours = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00'];
    hours.forEach(h => {
      trendData.push({ label: h, value: hourlyMap[h] || 0 });
    });
  } else {
    // Group by day
    const dailyMap = {};
    salesList.forEach(s => {
      if (s.IsCancelled || s.OrderType === 'LEDGER') return;
      const d = new Date(s.SettlementDate);
      const dayKey = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + (s.SysAmount || 0);
    });
    // Generate dates in sequence
    const startD = new Date(startDateStr);
    const endD = new Date(endDateStr);
    // Limit to max 15 points to fit chart nicely
    let step = 1;
    const diffTime = Math.abs(endD - startD);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > 15) {
      step = Math.ceil(diffDays / 15);
    }
    
    for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + step)) {
      const dayKey = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Singapore' });
      trendData.push({ label, value: dailyMap[dayKey] || 0 });
    }
  }

  return {
    companyName: companySettings?.CompanyName || 'JALSA',
    companyAddress: companySettings?.Address || '1 ROCHOR CANAL ROAD, #B1-29 SIM LIM SQUARE, SINGAPORE 188504',
    companyPhone: companySettings?.Phone || '',
    period: periodStr,
    printedOn: new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false }),

    // Summary Metrics
    totalSales,
    focSales: breakdown["FOC"] || 0,
    totalCollections,
    creditPaymentsCollected,
    memberPaymentsCollected,
    totalOrders,
    totalItems,
    voidQty: totalVoids,
    voidAmount: totalVoidAmount,
    cancelledCount,
    cancelledAmount,

    // Payment Breakdown
    paymentBreakdown: breakdown,
    paymentCounts: breakdownCounts,
    creditOutstanding,
    activePaymodes: (() => {
      const displayPaymodes = [...allPaymodes.filter(pm => pm.Active)];
      Object.entries(breakdown).forEach(([key, val]) => {
        if (val > 0) {
          const alreadyExists = displayPaymodes.some(pm => pm.PayMode.toUpperCase().trim() === key);
          if (!alreadyExists) {
            const dbMode = allPaymodes.find(pm => pm.PayMode.toUpperCase().trim() === key);
            if (dbMode) {
              displayPaymodes.push(dbMode);
            } else {
              displayPaymodes.push({
                PayMode: key,
                Description: key,
                Position: 99
              });
            }
          }
        }
      });
      return displayPaymodes.map(pm => ({
        payMode: pm.PayMode,
        description: pm.Description || pm.PayMode
      }));
    })(),

    // Reconciliation Summary
    reconciliation: {
      totalSalesVolume: paymentBreakdownTotal,
      memberSales: breakdown["MEMBER"] || 0,
      creditCollected: creditPaymentsCollected,
      creditOutstanding: creditOutstanding,
      totalCollectionsVolume: totalCollections
    },

    // Key Metrics
    keyMetrics: {
      avgCheck,
      conversion: totalTransactions,
      avgItems,
      perItem
    },

    // Order Types
    orderTypes: {
      dineInCount,
      takeawayCount,
      qrOrderCount,
      dineInPct,
      takeawayPct,
      qrPct
    },

    // Trend
    trendData,

    // Reports lists
    loginWiseSales,
    categories: categoriesList,
    items: itemsList,
    artistSales: artistSalesList
  };
}

module.exports = {
  fetchFullReportData
};
