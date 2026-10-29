/**
 * clearReceivables.js
 * One-time script: wipes ALL credit/receivables data so the screen starts fresh.
 * Run with: node scripts/clearReceivables.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { poolPromise } = require("../config/db");

async function clearAll() {
  try {
    const pool = await poolPromise;
    console.log("🗑️  Clearing all receivables data...\n");

    // 1. Delete allocations first (child of transactions)
    const r1 = await pool.request().query("DELETE FROM CustomerCreditAllocations");
    console.log(`✅ CustomerCreditAllocations deleted: ${r1.rowsAffected[0]} rows`);

    // 2. Delete all credit transactions
    const r2 = await pool.request().query("DELETE FROM CustomerCreditTransactions");
    console.log(`✅ CustomerCreditTransactions deleted: ${r2.rowsAffected[0]} rows`);

    // 3. Delete all credit-type customers (dedicated credit accounts)
    const r3 = await pool.request().query("DELETE FROM CreditCustomerMaster");
    console.log(`✅ CreditCustomerMaster deleted: ${r3.rowsAffected[0]} rows`);

    // 4. Reset MemberMaster credit balances to 0
    const r4 = await pool.request().query("UPDATE MemberMaster SET CurrentBalance = 0");
    console.log(`✅ MemberMaster CurrentBalance reset: ${r4.rowsAffected[0]} rows`);

    console.log("\n🎉 Receivables data cleared. Screen will now show empty state.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error clearing receivables:", err.message);
    process.exit(1);
  }
}

clearAll();
