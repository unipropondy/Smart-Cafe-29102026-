const { poolPromise } = require("./config/db");

async function checkUsers() {
  try {
    const pool = await poolPromise;
    const users = await pool.request().query(`
      SELECT 
        CAST(u.UserId AS NVARCHAR(50)) AS UserId,
        u.UserName,
        u.FullName,
        u.UserCode,
        ISNULL(g.UserGroupName, 'Cashier') AS RoleName
      FROM UserMaster u
      LEFT JOIN UserGroupMaster g ON u.UserGroupid = g.UserGroupId
    `);
    console.log("Users in UserMaster:", users.recordset);
    
    const cashiers = await pool.request().query(`
      SELECT DISTINCT 
        CAST(sh.CashierId AS NVARCHAR(50)) AS CashierId,
        ISNULL(um.FullName, ISNULL(um.UserName, sh.CashierId)) AS CashierName,
        um.UserName
      FROM SettlementHeader sh
      LEFT JOIN UserMaster um ON TRY_CAST(sh.CashierId AS UNIQUEIDENTIFIER) = um.UserId
    `);
    console.log("Cashiers in SettlementHeader:", cashiers.recordset);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

checkUsers();
