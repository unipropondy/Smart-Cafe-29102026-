/**
 * clearTodaySettlement.js
 * Wipes all settlement / cash-drawer data recorded today (SGT/UTC+8).
 * Clears: CashInEntry, CashOutEntry, CashDrawerLog, settlement,
 *         OpeningCashDenomination, PaymentTransactionDetails
 * Run with: node scripts/clearTodaySettlement.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { poolPromise } = require("../config/db");
const sql = require("mssql");

async function clearTodaySettlement() {
  console.log("🔄 Connecting to database...");
  const pool = await poolPromise;
  console.log("✅ Connected.");

  // Dynamically compute today's date in SGT (UTC+8)
  const now = new Date();
  const sgtOffset = 8 * 60 * 60 * 1000;
  const sgtNow = new Date(now.getTime() + sgtOffset);
  const yyyy = sgtNow.getUTCFullYear();
  const mm = String(sgtNow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(sgtNow.getUTCDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const todayStart = `${todayStr} 00:00:00`;
  const todayEnd   = `${todayStr} 23:59:59.999`;

  console.log(`📅 Targeting settlement data between: ${todayStart} and ${todayEnd} (SGT)`);

  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const req = () => transaction.request()
      .input("start", sql.DateTime, todayStart)
      .input("end",   sql.DateTime, todayEnd)
      .input("today", sql.Date,     todayStr);

    // 1. CashInEntry — linked to start_date or CashInDate
    const ciRes = await req().query(`
      SELECT COUNT(*) as cnt FROM CashInEntry
      WHERE COALESCE(start_date, CAST(CashInDate AS DATE)) = @today
    `);
    console.log(`🔍 CashInEntry rows today: ${ciRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM CashInEntry
      WHERE COALESCE(start_date, CAST(CashInDate AS DATE)) = @today
    `);
    console.log("✅ CashInEntry cleared");

    // 2. CashOutEntry — linked to start_date or CashOutDate
    const coRes = await req().query(`
      SELECT COUNT(*) as cnt FROM CashOutEntry
      WHERE COALESCE(start_date, CAST(CashOutDate AS DATE)) = @today
    `);
    console.log(`🔍 CashOutEntry rows today: ${coRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM CashOutEntry
      WHERE COALESCE(start_date, CAST(CashOutDate AS DATE)) = @today
    `);
    console.log("✅ CashOutEntry cleared");

    // 3. CashDrawerLog — all entries today
    const cdRes = await req().query(`
      SELECT COUNT(*) as cnt FROM CashDrawerLog
      WHERE CreatedOn >= @start AND CreatedOn <= @end
    `);
    console.log(`🔍 CashDrawerLog rows today: ${cdRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM CashDrawerLog
      WHERE CreatedOn >= @start AND CreatedOn <= @end
    `);
    console.log("✅ CashDrawerLog cleared");

    // 4. settlement — the session record for today
    const sRes = await req().query(`
      SELECT COUNT(*) as cnt FROM settlement
      WHERE SettlementDate = @today
    `);
    console.log(`🔍 settlement rows today: ${sRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM settlement
      WHERE SettlementDate = @today
    `);
    console.log("✅ settlement cleared");

    // 5. OpeningCashDenomination — entries today
    const ocdRes = await req().query(`
      SELECT COUNT(*) as cnt FROM OpeningCashDenomination
      WHERE CAST(CreatedOn AS DATE) = @today
    `);
    console.log(`🔍 OpeningCashDenomination rows today: ${ocdRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM OpeningCashDenomination
      WHERE CAST(CreatedOn AS DATE) = @today
    `);
    console.log("✅ OpeningCashDenomination cleared");

    // 6. PaymentTransactionDetails — entries today
    const ptRes = await req().query(`
      SELECT COUNT(*) as cnt FROM PaymentTransactionDetails
      WHERE CreatedDate >= @start AND CreatedDate <= @end
    `);
    console.log(`🔍 PaymentTransactionDetails rows today: ${ptRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM PaymentTransactionDetails
      WHERE CreatedDate >= @start AND CreatedDate <= @end
    `);
    console.log("✅ PaymentTransactionDetails cleared");

    // 7. PaymentDetailCur — powers the SALES paymode breakdown on settlement screen
    const pdcRes = await req().query(`
      SELECT COUNT(*) as cnt FROM PaymentDetailCur
      WHERE start_date = @today
    `);
    console.log(`🔍 PaymentDetailCur rows today: ${pdcRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM PaymentDetailCur
      WHERE start_date = @today
    `);
    console.log("✅ PaymentDetailCur cleared");

    // 8. PaymentDetail — mirror of PaymentDetailCur
    const pdRes = await req().query(`
      SELECT COUNT(*) as cnt FROM PaymentDetail
      WHERE start_date = @today
    `);
    console.log(`🔍 PaymentDetail rows today: ${pdRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM PaymentDetail
      WHERE start_date = @today
    `);
    console.log("✅ PaymentDetail cleared");

    // 9. RestaurantInvoiceCur — invoice records for today
    const ricRes = await req().query(`
      SELECT COUNT(*) as cnt FROM RestaurantInvoiceCur
      WHERE start_date = @today
    `);
    console.log(`🔍 RestaurantInvoiceCur rows today: ${ricRes.recordset[0].cnt}`);
    await req().query(`
      DELETE FROM RestaurantInvoiceCur
      WHERE start_date = @today
    `);
    console.log("✅ RestaurantInvoiceCur cleared");

    await transaction.commit();
    console.log("\n🎉 SUCCESS: Today's settlement and cash drawer data have been fully cleared!");

  } catch (error) {
    console.error("❌ ERROR during transaction, rolling back...", error);
    await transaction.rollback();
  }
}

clearTodaySettlement().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
