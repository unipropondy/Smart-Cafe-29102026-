const { poolPromise } = require("./config/db");

async function testQuery() {
  try {
    const pool = await poolPromise;
    const dateWhere = "sh.LastSettlementDate >= '2026-09-01'";
    
    const result = await pool.request().query(`
      SELECT
        u.UserId AS CashierId,
        ISNULL(NULLIF(LTRIM(RTRIM(u.FullName)), ''), u.UserName) AS CashierName,
        ISNULL(u.UserName, '-') AS UserLogin,
        ISNULL(u.UserCode, '-') AS UserCode,
        ISNULL(g.UserGroupCode, 'CASHIER') AS RoleCode,
        ISNULL(g.UserGroupName, 'Cashier') AS RoleName,
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
      FROM (
        SELECT CAST(UserId AS NVARCHAR(50)) AS UserId, UserName, FullName, UserCode, UserGroupid FROM UserMaster
      ) u
      LEFT JOIN UserGroupMaster g ON u.UserGroupid = g.UserGroupId
      LEFT JOIN SettlementHeader sh ON (TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = u.UserId OR CAST(sh.CashierId AS NVARCHAR(50)) = u.UserId) AND (${dateWhere})
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
      WHERE (${dateWhere}) 
        AND (sh.CashierId IS NULL OR TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) NOT IN (SELECT UserId FROM UserMaster))
      GROUP BY CAST(sh.CashierId AS NVARCHAR(50))
      ORDER BY TotalSales DESC, CashierName ASC
    `);

    console.log(`Returned ${result.recordset.length} users/cashiers:`);
    result.recordset.forEach(r => {
      console.log(`- CashierId: ${r.CashierId} | Name: ${r.CashierName} (${r.UserLogin}) | Bills: ${r.TotalBills} | Sales: ${r.TotalSales}`);
    });

    process.exit(0);
  } catch (err) {
    console.error("Test Error:", err);
    process.exit(1);
  }
}

testQuery();
