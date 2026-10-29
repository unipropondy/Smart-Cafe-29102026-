const fs = require("fs");
const path = "c:/Users/User/Desktop/POS-v-2.0/backend/routes/sales.js";

let content = fs.readFileSync(path, "utf8");

const oldSnippet = `    const result = await pool.request().query(\`
      SELECT
        CAST(sh.CashierId AS NVARCHAR(50)) AS CashierId,
        ISNULL(um.FullName, ISNULL(um.UserName, 'Unknown / QR')) AS CashierName,
        ISNULL(um.UserName, '-') AS UserLogin,
        ISNULL(um.UserCode, '-') AS UserCode,
        ISNULL(g.UserGroupCode, 'UNKNOWN') AS RoleCode,
        ISNULL(g.UserGroupName, 'Unknown') AS RoleName,
        COUNT(DISTINCT sh.SettlementID) AS TotalBills,
        SUM(ISNULL(sh.SubTotal, 0)) AS TotalSubTotal,
        SUM(ISNULL(sh.DiscountAmount, 0)) AS TotalDiscount,
        SUM(ISNULL(sh.ServiceCharge, 0)) AS TotalServiceCharge,
        SUM(ISNULL(sh.TotalTax, 0)) AS TotalTax,
        SUM(ISNULL(sh.TakeawayCharge, 0)) AS TotalTakeaway,
        SUM(ISNULL(sh.VoidItemAmount, 0)) AS TotalVoidAmount,
        SUM(ISNULL(sh.VoidItemQty, 0)) AS TotalVoidQty,
        SUM(ISNULL(sh.RoundedBy, 0)) AS TotalRounded,
        SUM(ISNULL(sts.SysAmount, sh.SysAmount)) AS TotalSales,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CASH','CAS','1') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS CashAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CARD','VISA','MASTER','MASTERCARD','AMEX') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS CardAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('PAYNOW','3') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS PayNowAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('NETS','2') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS NetsAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('MEMBER','5') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS MemberAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CREDIT','6') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS CreditAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('GRAB','10') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS GrabAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('FOODPANDA','9') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS FoodPandaAmount,
        SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('UPI','4','GPAY') THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS UpiAmount,
        SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) LIKE 'YEAHPAY%' THEN ISNULL(sts.SysAmount,0) ELSE 0 END) AS YeahPayAmount,
        SUM(CASE WHEN sh.IsCancelled = 1 THEN 1 ELSE 0 END) AS CancelledBills
      FROM SettlementHeader sh
      LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
      LEFT JOIN UserMaster um ON TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = um.UserId
      LEFT JOIN UserGroupMaster g ON um.UserGroupid = g.UserGroupId
      WHERE \${dateWhere}
      GROUP BY
        CAST(sh.CashierId AS NVARCHAR(50)),
        um.FullName, um.UserName, um.UserCode,
        g.UserGroupCode, g.UserGroupName
      ORDER BY TotalSales DESC
    \`);`;

const newSnippet = `    const result = await pool.request().query(\`
      SELECT
        u.UserId AS CashierId,
        ISNULL(NULLIF(LTRIM(RTRIM(u.FullName)), ''), u.UserName) AS CashierName,
        ISNULL(u.UserName, '-') AS UserLogin,
        ISNULL(u.UserCode, '-') AS UserCode,
        ISNULL(g.UserGroupCode, 'CASHIER') AS RoleCode,
        ISNULL(g.UserGroupName, 'Cashier') AS RoleName,
        COUNT(DISTINCT sh.SettlementID) AS TotalBills,
        ISNULL(SUM(sh.SubTotal), 0) AS TotalSubTotal,
        ISNULL(SUM(sh.DiscountAmount), 0) AS TotalDiscount,
        ISNULL(SUM(sh.ServiceCharge), 0) AS TotalServiceCharge,
        ISNULL(SUM(sh.TotalTax), 0) AS TotalTax,
        ISNULL(SUM(sh.TakeawayCharge), 0) AS TotalTakeaway,
        ISNULL(SUM(sh.VoidItemAmount), 0) AS TotalVoidAmount,
        ISNULL(SUM(sh.VoidItemQty), 0) AS TotalVoidQty,
        ISNULL(SUM(sh.RoundedBy), 0) AS TotalRounded,
        ISNULL(SUM(ISNULL(sts.SysAmount, sh.SysAmount)), 0) AS TotalSales,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CASH','CAS','1') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CashAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CARD','VISA','MASTER','MASTERCARD','AMEX') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CardAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('PAYNOW','3') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS PayNowAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('NETS','2') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS NetsAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('MEMBER','5') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS MemberAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CREDIT','6') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CreditAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('GRAB','10') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS GrabAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('FOODPANDA','9') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS FoodPandaAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('UPI','4','GPAY') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS UpiAmount,
        ISNULL(SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) LIKE 'YEAHPAY%' THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS YeahPayAmount,
        ISNULL(SUM(CASE WHEN sh.IsCancelled = 1 THEN 1 ELSE 0 END), 0) AS CancelledBills
      FROM (
        SELECT CAST(UserId AS NVARCHAR(50)) AS UserId, UserName, FullName, UserCode, UserGroupid FROM UserMaster
      ) u
      LEFT JOIN UserGroupMaster g ON u.UserGroupid = g.UserGroupId
      LEFT JOIN SettlementHeader sh ON (TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = u.UserId OR CAST(sh.CashierId AS NVARCHAR(50)) = u.UserId) AND (\${dateWhere})
      LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
      GROUP BY
        u.UserId, u.UserName, u.FullName, u.UserCode,
        g.UserGroupCode, g.UserGroupName

      UNION ALL

      SELECT
        CAST(sh.CashierId AS NVARCHAR(50)) AS CashierId,
        'Unknown / Unassigned' AS CashierName,
        '-' AS UserLogin,
        '-' AS UserCode,
        'UNKNOWN' AS RoleCode,
        'Unknown' AS RoleName,
        COUNT(DISTINCT sh.SettlementID) AS TotalBills,
        ISNULL(SUM(sh.SubTotal), 0) AS TotalSubTotal,
        ISNULL(SUM(sh.DiscountAmount), 0) AS TotalDiscount,
        ISNULL(SUM(sh.ServiceCharge), 0) AS TotalServiceCharge,
        ISNULL(SUM(sh.TotalTax), 0) AS TotalTax,
        ISNULL(SUM(sh.TakeawayCharge), 0) AS TotalTakeaway,
        ISNULL(SUM(sh.VoidItemAmount), 0) AS TotalVoidAmount,
        ISNULL(SUM(sh.VoidItemQty), 0) AS TotalVoidQty,
        ISNULL(SUM(sh.RoundedBy), 0) AS TotalRounded,
        ISNULL(SUM(ISNULL(sts.SysAmount, sh.SysAmount)), 0) AS TotalSales,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CASH','CAS','1') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CashAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CARD','VISA','MASTER','MASTERCARD','AMEX') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CardAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('PAYNOW','3') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS PayNowAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('NETS','2') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS NetsAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('MEMBER','5') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS MemberAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('CREDIT','6') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS CreditAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('GRAB','10') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS GrabAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('FOODPANDA','9') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS FoodPandaAmount,
        ISNULL(SUM(CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(sts.PayMode,'')))) IN ('UPI','4','GPAY') THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS UpiAmount,
        ISNULL(SUM(CASE WHEN UPPER(ISNULL(sts.PayMode,'')) LIKE 'YEAHPAY%' THEN ISNULL(sts.SysAmount,0) ELSE 0 END), 0) AS YeahPayAmount,
        ISNULL(SUM(CASE WHEN sh.IsCancelled = 1 THEN 1 ELSE 0 END), 0) AS CancelledBills
      FROM SettlementHeader sh
      LEFT JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
      WHERE (\${dateWhere}) 
        AND (sh.CashierId IS NULL OR TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) NOT IN (SELECT UserId FROM UserMaster))
      GROUP BY CAST(sh.CashierId AS NVARCHAR(50))
      ORDER BY TotalSales DESC, CashierName ASC
    \`);`;

// Normalize line endings
content = content.replace(/\r\n/g, "\n");
const normOld = oldSnippet.replace(/\r\n/g, "\n");

if (content.includes(normOld)) {
  content = content.replace(normOld, newSnippet);
  fs.writeFileSync(path, content, "utf8");
  console.log("SUCCESSFULLY PATCHED sales.js!");
} else {
  console.error("FAILED to find target snippet in sales.js");
}
