/**
 * clearTodaySales.js
 * Wipes all sales/settlements recorded today (SGT/UTC+8) and restores credit balances.
 * Run with: node scripts/clearTodaySales.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { poolPromise } = require("../config/db");
const sql = require("mssql");

async function clearTodaySales() {
  console.log("🔄 Connecting to database...");
  const pool = await poolPromise;
  console.log("✅ Connected.");

  // Dynamically compute today's date in SGT (UTC+8)
  const now = new Date();
  const sgtOffset = 8 * 60 * 60 * 1000; // UTC+8
  const sgtNow = new Date(now.getTime() + sgtOffset);
  const yyyy = sgtNow.getUTCFullYear();
  const mm = String(sgtNow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(sgtNow.getUTCDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const todayStart = `${todayStr} 00:00:00`;
  const todayEnd   = `${todayStr} 23:59:59.999`;

  console.log(`📅 Targeting sales between: ${todayStart} and ${todayEnd} (SGT)`);

  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // 1. Get all SettlementIDs from today
    const settlementsRes = await transaction.request()
      .input("start", sql.DateTime, todayStart)
      .input("end", sql.DateTime, todayEnd)
      .query(`
        SELECT SettlementID, MemberId, SysAmount 
        FROM SettlementHeader 
        WHERE LastSettlementDate >= @start AND LastSettlementDate <= @end
      `);

    const settlements = settlementsRes.recordset;
    console.log(`Found ${settlements.length} settlement(s) recorded today.`);

    if (settlements.length === 0) {
      console.log("No sales found for today. Nothing to clear!");
      await transaction.rollback();
      return;
    }

    const settlementIds = settlements.map(s => s.SettlementID);
    console.log("Settlement IDs to delete:", settlementIds);

    // 2. Adjust MemberMaster and CreditCustomerMaster CurrentBalance before deleting credit transactions
    const creditTxRes = await transaction.request()
      .input("start", sql.DateTime, todayStart)
      .input("end", sql.DateTime, todayEnd)
      .query(`
        SELECT MemberId, TransactionType, BillAmount, PaidAmount 
        FROM CustomerCreditTransactions 
        WHERE CreatedDate >= @start AND CreatedDate <= @end
      `);

    const creditTxs = creditTxRes.recordset;
    console.log(`Found ${creditTxs.length} credit ledger transaction(s) recorded today.`);

    // Group by MemberId to calculate balance adjustments
    const adjustments = {};
    creditTxs.forEach(tx => {
      const memberId = tx.MemberId;
      if (!adjustments[memberId]) {
        adjustments[memberId] = 0;
      }
      // CREDIT_SALE / ADJUSTMENT increases CurrentBalance (amount due)
      // PAYMENT decreases CurrentBalance (amount due)
      if (tx.TransactionType === 'CREDIT_SALE' || tx.TransactionType === 'ADJUSTMENT') {
        adjustments[memberId] += parseFloat(tx.BillAmount || 0);
      } else if (tx.TransactionType === 'PAYMENT') {
        adjustments[memberId] -= parseFloat(tx.PaidAmount || 0);
      }
    });

    for (const [memberId, netChange] of Object.entries(adjustments)) {
      if (Math.abs(netChange) > 0.005) {
        console.log(`Adjusting balance for Customer/Member ${memberId}: Subtracting net change of ${netChange.toFixed(2)}`);

        // Check if member exists in MemberMaster
        const isMemberRes = await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, memberId)
          .query("SELECT 1 FROM MemberMaster WHERE MemberId = @MemberId");

        if (isMemberRes.recordset.length > 0) {
          await transaction.request()
            .input("MemberId", sql.UniqueIdentifier, memberId)
            .input("Change", sql.Decimal(18, 2), netChange)
            .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance - @Change WHERE MemberId = @MemberId");
          console.log(`✅ MemberMaster balance updated for ${memberId}`);
        } else {
          // Check in CreditCustomerMaster
          const isCustRes = await transaction.request()
            .input("CustomerId", sql.UniqueIdentifier, memberId)
            .query("SELECT 1 FROM CreditCustomerMaster WHERE CustomerId = @CustomerId");

          if (isCustRes.recordset.length > 0) {
            await transaction.request()
              .input("CustomerId", sql.UniqueIdentifier, memberId)
              .input("Change", sql.Decimal(18, 2), netChange)
              .query("UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance - @Change WHERE CustomerId = @CustomerId");
            console.log(`✅ CreditCustomerMaster balance updated for ${memberId}`);
          }
        }
      }
    }

    // 3. Delete from dependent tables
    for (const id of settlementIds) {
      const req = transaction.request().input("SettlementID", sql.UniqueIdentifier, id);

      // Delete allocations linked to transactions of this settlement
      await req.query(`
        DELETE FROM CustomerCreditAllocations 
        WHERE InvoiceTransactionId IN (SELECT TransactionId FROM CustomerCreditTransactions WHERE SettlementId = @SettlementID)
           OR PaymentTransactionId IN (SELECT TransactionId FROM CustomerCreditTransactions WHERE SettlementId = @SettlementID)
      `);

      await req.query("DELETE FROM CustomerCreditTransactions WHERE SettlementId = @SettlementID");
      await req.query("DELETE FROM SettlementItemDetail WHERE SettlementID = @SettlementID");
      await req.query("DELETE FROM SettlementTotalSales WHERE SettlementID = @SettlementID");
      await req.query("DELETE FROM SettlementDetail WHERE SettlementId = @SettlementID");
      await req.query("DELETE FROM SettlementTranDetail WHERE SettlementID = @SettlementID");
      await req.query("DELETE FROM SettlementCreditSales WHERE SettlementID = @SettlementID");
      await req.query("DELETE FROM SettlementDiscountDetail WHERE SettlementID = @SettlementID");
      await req.query("DELETE FROM PaymentTransactionDetails WHERE ReferenceId = @SettlementID");
      await req.query("DELETE FROM RestaurantInvoice WHERE RestaurantBillId = @SettlementID");
      await req.query("DELETE FROM SettlementHeader WHERE SettlementID = @SettlementID");
    }

    // Also delete any standalone payment/allocation credit transactions created today (without settlement link)
    await transaction.request()
      .input("start", sql.DateTime, todayStart)
      .input("end", sql.DateTime, todayEnd)
      .query(`
        DELETE FROM CustomerCreditAllocations 
        WHERE PaymentTransactionId IN (SELECT TransactionId FROM CustomerCreditTransactions WHERE CreatedDate >= @start AND CreatedDate <= @end)
           OR InvoiceTransactionId IN (SELECT TransactionId FROM CustomerCreditTransactions WHERE CreatedDate >= @start AND CreatedDate <= @end)
      `);

    await transaction.request()
      .input("start", sql.DateTime, todayStart)
      .input("end", sql.DateTime, todayEnd)
      .query("DELETE FROM CustomerCreditTransactions WHERE CreatedDate >= @start AND CreatedDate <= @end");

    await transaction.commit();
    console.log("🎉 SUCCESS: Today's sales and associated credit entries have been fully cleared!");

  } catch (error) {
    console.error("❌ ERROR occurred during transaction, rolling back...", error);
    await transaction.rollback();
  }
}

clearTodaySales().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
