const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { runInTransaction } = require("../utils/transactionHelper");
const { processSplitPayments } = require("../services/payment.service");

const toGuidOrNull = (value) => {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
};

router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT CustomerId AS MemberId, Name, Phone, Email, Address, IsActive, Balance, CreditLimit, CurrentBalance, CreatedOn FROM CreditCustomerMaster ORDER BY Name");
    res.json(result.recordset);
  } catch (err) {
    console.error("[CREDIT CUSTOMERS GET ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/add", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { name, phone, email, creditLimit, currentBalance, balance, address, isActive, userId } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and Phone are required" });
    }

    const cleanPhone = String(phone).trim();

    // Check for duplicate phone number
    const dupCheck = await pool.request()
      .input("Phone", sql.NVarChar, cleanPhone)
      .query("SELECT CustomerId FROM CreditCustomerMaster WHERE Phone = @Phone");

    if (dupCheck.recordset.length > 0) {
      return res.status(400).json({ error: "A credit customer with this phone number already exists." });
    }

    const crypto = require("crypto");
    const newId = crypto.randomUUID();
    const safeUserId = toGuidOrNull(userId);

    await pool.request()
      .input("CustomerId", sql.UniqueIdentifier, newId)
      .input("Name", sql.NVarChar, name)
      .input("Phone", sql.NVarChar, cleanPhone)
      .input("Email", sql.NVarChar, email || null)
      .input("Address", sql.NVarChar, address || null)
      .input("IsActive", sql.Bit, isActive !== undefined ? isActive : 1)
      .input("CreditLimit", sql.Decimal(18, 2), parseFloat(creditLimit) || 0)
      .input("CurrentBalance", sql.Decimal(18, 2), parseFloat(currentBalance) || 0)
      .input("Balance", sql.Decimal(18, 2), parseFloat(balance) || 0)
      .query(`
        INSERT INTO CreditCustomerMaster (CustomerId, Name, Phone, Email, Address, IsActive, CreditLimit, CurrentBalance, Balance)
        VALUES (@CustomerId, @Name, @Phone, @Email, @Address, @IsActive, @CreditLimit, @CurrentBalance, @Balance);
      `);
    
    res.json({
      success: true,
      member: {
        MemberId: newId,
        Name: name,
        Phone: cleanPhone,
        CreditLimit: parseFloat(creditLimit) || 0,
        CurrentBalance: parseFloat(currentBalance) || 0,
        IsActive: isActive !== undefined ? isActive : 1
      }
    });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS ADD ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/update", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, name, phone, email, creditLimit, currentBalance, balance, address, isActive, userId } = req.body;
    await pool.request()
      .input("Id", sql.UniqueIdentifier, memberId)
      .input("Name", sql.NVarChar, name)
      .input("Phone", sql.NVarChar, phone)
      .input("Email", sql.NVarChar, email)
      .input("Address", sql.NVarChar, address || null)
      .input("IsActive", sql.Bit, isActive !== undefined ? isActive : 1)
      .input("CreditLimit", sql.Decimal(18, 2), parseFloat(creditLimit) || 0)
      .input("CurrentBalance", sql.Decimal(18, 2), parseFloat(currentBalance) || 0)
      .input("Balance", sql.Decimal(18, 2), parseFloat(balance) || 0)
      .query(`
        UPDATE CreditCustomerMaster SET 
          Name = @Name, Phone = @Phone, Email = @Email, Address = @Address, IsActive = @IsActive,
          CreditLimit = @CreditLimit, CurrentBalance = @CurrentBalance, Balance = @Balance
        WHERE CustomerId = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS UPDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/delete", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, customerType } = req.body;
    if (!memberId) return res.status(400).json({ error: "Missing customer ID (memberId)" });

    // Step 1: Delete allocations linked to this member's transactions (FK chain)
    await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        DELETE FROM CustomerCreditAllocations
        WHERE PaymentTransactionId IN (
          SELECT TransactionId FROM CustomerCreditTransactions WHERE MemberId = @MemberId
        )
        OR InvoiceTransactionId IN (
          SELECT TransactionId FROM CustomerCreditTransactions WHERE MemberId = @MemberId
        )
      `);

    // Step 2: Delete all credit transactions for this member
    await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query("DELETE FROM CustomerCreditTransactions WHERE MemberId = @MemberId");

    // Step 3: Delete the customer record based on type
    if (customerType === "MEMBER") {
      // Regular members live in MemberMaster — just zero out their credit balance
      await pool.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .query("UPDATE MemberMaster SET CurrentBalance = 0 WHERE MemberId = @MemberId");
    } else {
      // CREDIT customers are stored in CreditCustomerMaster — fully delete
      await pool.request()
        .input("Id", sql.UniqueIdentifier, memberId)
        .query("DELETE FROM CreditCustomerMaster WHERE CustomerId = @Id");
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS DELETE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("query", sql.NVarChar, `%${query || ""}%`)
      .query(`
        SELECT CustomerId AS MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive 
        FROM CreditCustomerMaster 
        WHERE (Name LIKE @query OR Phone LIKE @query)
        ORDER BY Name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[CREDIT CUSTOMERS SEARCH ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/validate/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const { amount } = req.query;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("CustomerId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT CustomerId AS MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive 
        FROM CreditCustomerMaster 
        WHERE CustomerId = @CustomerId
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Credit customer not found" });
    }
    
    const customer = result.recordset[0];
    if (!customer.IsActive) {
      return res.status(400).json({ success: false, error: "Credit account is inactive" });
    }
    
    const billAmount = parseFloat(amount) || 0;
    const currentBalance = parseFloat(customer.CurrentBalance) || 0;
    const creditLimit = parseFloat(customer.CreditLimit) || 0;
    const remainingCredit = creditLimit - currentBalance;
    
    if (currentBalance + billAmount > creditLimit) {
      return res.status(400).json({ 
        success: false, 
        error: "Credit Limit Exceeded",
        member: {
          ...customer,
          RemainingCredit: remainingCredit
        }
      });
    }
    
    res.json({
      success: true,
      member: {
        ...customer,
        RemainingCredit: remainingCredit
      }
    });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS VALIDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/pay", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, amount, payments, userId, paymentSessionId } = req.body;

    if (paymentSessionId) {
      const checkTx = await pool.request()
        .input("SessionId", sql.NVarChar(100), paymentSessionId)
        .query("SELECT TransactionId FROM CustomerCreditTransactions WHERE Remarks LIKE '%' + @SessionId + '%' OR ReferenceNo = @SessionId");
      if (checkTx.recordset.length > 0) {
        console.log(`[CREDIT PAY] Duplicate request detected. Session ${paymentSessionId} already exists.`);
        return res.json({ success: true, message: "Duplicate payment skipped", duplicate: true });
      }
    }

  if (!memberId) {
    return res.status(400).json({ error: "memberId (CustomerId) is required" });
  }

  const numericAmt = parseFloat(amount);
  if (isNaN(numericAmt) || numericAmt <= 0) {
    return res.status(400).json({ error: "Amount must be a positive number" });
  }

  if (!payments || !Array.isArray(payments) || payments.length === 0) {
    return res.status(400).json({ error: "payments array is required and cannot be empty" });
  }

  // Validation
  let sum = 0;
  for (let i = 0; i < payments.length; i++) {
    const p = payments[i];
    const amt = parseFloat(p.amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: `Payment row ${i + 1} has an invalid or negative amount.` });
    }
    if (!p.payModeId && !p.payMode) {
      return res.status(400).json({ error: `Payment row ${i + 1} is missing payment mode.` });
    }
    sum += amt;
  }

  const diff = Math.abs(sum - numericAmt);
  if (diff > 0.01) {
    return res.status(400).json({ error: `Sum of payments (${sum.toFixed(2)}) must equal total amount (${numericAmt.toFixed(2)})` });
  }

  let paymentTransactionId;

  await runInTransaction(async (transaction) => {
    // 1. Verify customer exists and is active
    const customerCheck = await transaction.request()
      .input("CustomerId", sql.UniqueIdentifier, memberId)
      .query("SELECT CreditLimit, CurrentBalance, IsActive FROM CreditCustomerMaster WITH (UPDLOCK) WHERE CustomerId = @CustomerId");
    
    if (customerCheck.recordset.length === 0) {
      throw new Error("Credit customer not found");
    }
    
    const customer = customerCheck.recordset[0];
    if (!customer.IsActive) {
      throw new Error("Credit customer is inactive");
    }

    // 2. Process split payments using unified service
    await processSplitPayments({
      referenceType: "MEMBER", // Generic referenceType
      referenceId: memberId,
      payments,
      transaction,
      cashierId: userId ? String(userId).trim() : null
    });

    // 3. Write allocation credit rows to CustomerCreditTransactions
    let remainingPayment = numericAmt;
    const payModeName = (payments && payments.length > 0) ? (payments[0].payMode || 'CASH') : 'CASH';
    const referenceNo = (payments && payments.length > 0) ? (payments[0].referenceNo || paymentSessionId || '') : (paymentSessionId || '');
    const mainRemarks = `${req.body.remarks || `Credit payment collection (${payModeName})`} [Session: ${paymentSessionId || ''}]`;

    // Fetch active business start_date
    let startDate = null;
    const activeDayRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    if (activeDayRes.recordset.length > 0) {
      startDate = activeDayRes.recordset[0].StartDate;
    }

    // Write the primary PAYMENT transaction record
    const payTxResult = await transaction.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .input("Amount", sql.Decimal(18, 2), numericAmt)
      .input("PaymentMethod", sql.NVarChar(50), payModeName)
      .input("ReferenceNo", sql.NVarChar(100), referenceNo)
      .input("Remarks", sql.NVarChar(500), mainRemarks.substring(0, 500))
      .input("CreatedBy", sql.UniqueIdentifier, toGuidOrNull(userId))
      .input("StartDate", sql.Date, startDate)
      .query(`
        INSERT INTO CustomerCreditTransactions (MemberId, TransactionType, BillAmount, PaidAmount, OutstandingAmount, PaymentMethod, ReferenceNo, Status, Remarks, CreatedBy, CustomerType, start_date)
        OUTPUT INSERTED.TransactionId
        VALUES (@MemberId, 'PAYMENT', 0, @Amount, -@Amount, @PaymentMethod, @ReferenceNo, 'CLOSED', @Remarks, @CreatedBy, 'CREDIT', @StartDate)
      `);
    
    paymentTransactionId = payTxResult.recordset[0].TransactionId;
    
    if (req.body.allocations && Array.isArray(req.body.allocations) && req.body.allocations.length > 0) {
      // Manual Allocation
      for (const alloc of req.body.allocations) {
        if (remainingPayment <= 0.005) break;
        let allocAmt = parseFloat(alloc.amount);
        if (isNaN(allocAmt) || allocAmt <= 0) continue;
        
        allocAmt = Math.min(remainingPayment, allocAmt);
        if (allocAmt <= 0.005) continue;
        
        const billCheck = await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, memberId)
          .input("SettlementId", sql.UniqueIdentifier, toGuidOrNull(alloc.settlementId))
          .query(`
            SELECT TransactionId FROM CustomerCreditTransactions
            WHERE MemberId = @MemberId AND SettlementId = @SettlementId AND TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
          `);
        
        if (billCheck.recordset.length > 0) {
          const invoiceTransactionId = billCheck.recordset[0].TransactionId;
          
          await transaction.request()
            .input("TransactionId", sql.UniqueIdentifier, invoiceTransactionId)
            .input("AllocAmt", sql.Decimal(18, 2), allocAmt)
            .query(`
              UPDATE CustomerCreditTransactions
              SET 
                PaidAmount = PaidAmount + @AllocAmt,
                OutstandingAmount = OutstandingAmount - @AllocAmt,
                Status = CASE WHEN (OutstandingAmount - @AllocAmt) <= 0.01 THEN 'CLOSED' ELSE 'PARTIAL' END,
                UpdatedDate = GETDATE()
              WHERE TransactionId = @TransactionId
            `);

          // Insert allocation record
          await transaction.request()
            .input("PaymentTransactionId", sql.UniqueIdentifier, paymentTransactionId)
            .input("InvoiceTransactionId", sql.UniqueIdentifier, invoiceTransactionId)
            .input("AllocAmt", sql.Decimal(18, 2), allocAmt)
            .query(`
              INSERT INTO CustomerCreditAllocations (PaymentTransactionId, InvoiceTransactionId, Amount)
              VALUES (@PaymentTransactionId, @InvoiceTransactionId, @AllocAmt)
            `);
          
          remainingPayment -= allocAmt;
        }
      }
    } else {
      // Auto Allocation (FIFO)
      const outstandingRes = await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .query(`
          SELECT 
            TransactionId,
            SettlementId,
            BillNo,
            OutstandingAmount
          FROM CustomerCreditTransactions
          WHERE MemberId = @MemberId
            AND TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
            AND Status IN ('OPEN', 'PARTIAL')
          ORDER BY CreatedDate ASC
        `);
      
      const outstandingBills = outstandingRes.recordset;
      
      for (const bill of outstandingBills) {
        if (remainingPayment <= 0.005) break;
        
        const billDue = parseFloat(bill.OutstandingAmount) || 0;
        const allocAmt = Math.min(remainingPayment, billDue);
        
        await transaction.request()
          .input("TransactionId", sql.UniqueIdentifier, bill.TransactionId)
          .input("AllocAmt", sql.Decimal(18, 2), allocAmt)
          .query(`
            UPDATE CustomerCreditTransactions
            SET 
              PaidAmount = PaidAmount + @AllocAmt,
              OutstandingAmount = OutstandingAmount - @AllocAmt,
              Status = CASE WHEN (OutstandingAmount - @AllocAmt) <= 0.01 THEN 'CLOSED' ELSE 'PARTIAL' END,
              UpdatedDate = GETDATE()
            WHERE TransactionId = @TransactionId
          `);

        // Insert allocation record
        await transaction.request()
          .input("PaymentTransactionId", sql.UniqueIdentifier, paymentTransactionId)
          .input("InvoiceTransactionId", sql.UniqueIdentifier, bill.TransactionId)
          .input("AllocAmt", sql.Decimal(18, 2), allocAmt)
          .query(`
            INSERT INTO CustomerCreditAllocations (PaymentTransactionId, InvoiceTransactionId, Amount)
            VALUES (@PaymentTransactionId, @InvoiceTransactionId, @AllocAmt)
          `);
          
        remainingPayment -= allocAmt;
      }
    }

    // 4. Update customer balance (subtract paid amount)
    await transaction.request()
      .input("CustomerId", sql.UniqueIdentifier, memberId)
      .input("Amount", sql.Decimal(18, 2), numericAmt)
      .query("UPDATE CreditCustomerMaster SET CurrentBalance = CurrentBalance - @Amount WHERE CustomerId = @CustomerId");
  }, { name: "CreditCustomerPayment", timeoutMs: 60000 });

  res.json({ success: true, paymentTransactionId });
} catch (err) {
  console.error("[CREDIT CUSTOMER PAYMENT ERROR]", err);
  res.status(500).json({ error: err.message });
}
});

/* ================= OUTSTANDING BILLS ================= */
router.get("/outstanding/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          TransactionId,
          SettlementId,
          BillNo,
          BillAmount AS GrossAmount,
          PaidAmount,
          OutstandingAmount,
          CONVERT(VARCHAR, CreatedDate, 126) + '+08:00' AS InvoiceDate
        FROM CustomerCreditTransactions
        WHERE MemberId = @MemberId
          AND TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
          AND Status IN ('OPEN', 'PARTIAL')
        ORDER BY CreatedDate ASC
      `);
    res.json({ success: true, outstandingBills: result.recordset });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS OUTSTANDING BILLS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= STATEMENT / HISTORY ================= */
router.get("/statement/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          TransactionId,
          SettlementId,
          BillNo,
          TransactionType,
          CASE WHEN TransactionType = 'CREDIT_SALE' THEN BillAmount WHEN TransactionType = 'PAYMENT' THEN PaidAmount ELSE ISNULL(NULLIF(BillAmount, 0), PaidAmount) END AS Amount,
          BillAmount,
          PaidAmount,
          OutstandingAmount,
          PaymentMethod,
          ReferenceNo,
          Remarks,
          CONVERT(VARCHAR, CreatedDate, 126) + '+08:00' AS CreatedDate,
          CreatedBy
        FROM CustomerCreditTransactions
        WHERE MemberId = @MemberId
        ORDER BY CreatedDate ASC
      `);
    
    let runningBalance = 0;
    const transactions = result.recordset.map(t => {
      let movement = 0;
      const type = (t.TransactionType || '').toUpperCase();
      if (type === 'CREDIT_SALE' || type === 'DEBIT') {
        movement = parseFloat(t.BillAmount || t.Amount || 0);
      } else if (type === 'PAYMENT' || type === 'CREDIT') {
        movement = -parseFloat(t.PaidAmount || t.Amount || 0);
      } else if (type === 'ADJUSTMENT') {
        if (parseFloat(t.BillAmount || 0) > 0) {
          movement = parseFloat(t.BillAmount || 0);
        } else if (parseFloat(t.PaidAmount || 0) > 0) {
          movement = -parseFloat(t.PaidAmount || 0);
        } else {
          movement = parseFloat(t.Amount || 0);
        }
      } else {
        movement = parseFloat(t.BillAmount || 0) - parseFloat(t.PaidAmount || 0);
      }

      runningBalance += movement;

      return {
        ...t,
        Amount: Math.abs(parseFloat(t.Amount || 0)),
        runningBalance: parseFloat(runningBalance.toFixed(2))
      };
    });
    
    res.json({ success: true, transactions });
  } catch (err) {
    console.error("[CREDIT CUSTOMERS STATEMENT ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= RECEIVABLES DASHBOARD ================= */
router.get("/receivables/dashboard", async (req, res) => {
  try {
    const pool = await poolPromise;
    
    // Total Outstanding & Overdue (defined as bills older than 30 days)
    const statsRes = await pool.request().query(`
      SELECT 
        ISNULL(SUM(tx.OutstandingAmount), 0) AS TotalOutstanding,
        ISNULL(SUM(
          CASE 
            WHEN tx.CreatedDate < DATEADD(day, -30, GETDATE()) THEN tx.OutstandingAmount 
            ELSE 0 
          END
        ), 0) AS TotalOverdue
      FROM CustomerCreditTransactions tx
      WHERE tx.TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT') 
        AND tx.Status IN ('OPEN', 'PARTIAL')
        AND EXISTS (SELECT 1 FROM CreditCustomerMaster m WHERE tx.MemberId = m.CustomerId AND m.IsActive = 1)
    `);
    
    // Total Customers with Credit
    const custCountRes = await pool.request().query(`
      SELECT COUNT(*) AS CreditCustomerCount 
      FROM CreditCustomerMaster 
      WHERE CurrentBalance > 0.01 AND IsActive = 1
    `);
    
    // Collections Today & This Month
    const collRes = await pool.request().query(`
      SELECT 
        ISNULL(SUM(CASE WHEN tx.CreatedDate >= CAST(GETDATE() AS DATE) THEN tx.PaidAmount ELSE 0 END), 0) AS CollectionsToday,
        ISNULL(SUM(CASE WHEN tx.CreatedDate >= DATEADD(month, DATEDIFF(month, 0, GETDATE()), 0) THEN tx.PaidAmount ELSE 0 END), 0) AS CollectionsThisMonth
      FROM CustomerCreditTransactions tx
      JOIN CreditCustomerMaster c ON tx.MemberId = c.CustomerId
      WHERE tx.TransactionType = 'PAYMENT'
    `);

    // Total Credit sales and Total payments collected
    const creditStatsRes = await pool.request().query(`
      SELECT 
        ISNULL(SUM(CASE WHEN tx.TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT') THEN tx.BillAmount ELSE 0 END), 0) AS TotalCredit,
        ISNULL(SUM(CASE WHEN tx.TransactionType = 'PAYMENT' THEN tx.PaidAmount ELSE 0 END), 0) AS TotalPaid
      FROM CustomerCreditTransactions tx
      JOIN CreditCustomerMaster c ON tx.MemberId = c.CustomerId
    `);
    
    res.json({
      success: true,
      stats: {
        totalOutstanding: statsRes.recordset[0].TotalOutstanding,
        totalOverdue: Math.max(0, statsRes.recordset[0].TotalOverdue),
        totalCustomersWithCredit: custCountRes.recordset[0].CreditCustomerCount,
        collectionsToday: collRes.recordset[0].CollectionsToday,
        collectionsThisMonth: collRes.recordset[0].CollectionsThisMonth,
        totalCredit: creditStatsRes.recordset[0].TotalCredit,
        totalPaid: creditStatsRes.recordset[0].TotalPaid
      }
    });
  } catch (err) {
    console.error("[CREDIT RECEIVABLES DASHBOARD ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});
 
/* ================= AGING REPORT ================= */
router.get("/receivables/aging", async (req, res) => {
  try {
    const pool = await poolPromise;
    
    const query = `
      WITH Customers AS (
        SELECT CustomerId AS MemberId, Name, Phone, IsActive, CreditLimit, Email, Address, 'CREDIT' AS CustomerType FROM CreditCustomerMaster
      ),
      BillBalances AS (
        SELECT 
          MemberId,
          BillNo,
          CreatedDate AS BillDate,
          DATEDIFF(day, CreatedDate, GETDATE()) AS AgeDays,
          OutstandingAmount AS NetOutstanding
        FROM CustomerCreditTransactions
        WHERE TransactionType IN ('CREDIT_SALE', 'ADJUSTMENT')
          AND Status IN ('OPEN', 'PARTIAL')
      )
      SELECT 
        m.MemberId,
        m.Name,
        m.Phone,
        m.CustomerType,
        m.CreditLimit,
        m.Email,
        m.Address,
        m.IsActive,
        ISNULL(SUM(b.NetOutstanding), 0) AS OutstandingBalance,
        ISNULL(SUM(CASE WHEN b.AgeDays <= 30 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket0to30,
        ISNULL(SUM(CASE WHEN b.AgeDays > 30 AND b.AgeDays <= 60 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket31to60,
        ISNULL(SUM(CASE WHEN b.AgeDays > 60 AND b.AgeDays <= 90 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket61to90,
        ISNULL(SUM(CASE WHEN b.AgeDays > 90 THEN b.NetOutstanding ELSE 0 END), 0) AS Bucket90Plus
      FROM Customers m
      LEFT JOIN BillBalances b ON m.MemberId = b.MemberId
      WHERE m.IsActive = 1
      GROUP BY m.MemberId, m.Name, m.Phone, m.CustomerType, m.CreditLimit, m.Email, m.Address, m.IsActive
      HAVING ISNULL(SUM(b.NetOutstanding), 0) > 0
      ORDER BY m.Name
    `;
    
    const result = await pool.request().query(query);
    const customers = result.recordset || [];
    
    const summary = customers.reduce((acc, c) => {
      acc.totalOutstanding += parseFloat(c.OutstandingBalance);
      acc.aging0to30 += parseFloat(c.Bucket0to30);
      acc.aging31to60 += parseFloat(c.Bucket31to60);
      acc.aging61to90 += parseFloat(c.Bucket61to90);
      acc.aging90plus += parseFloat(c.Bucket90Plus);
      return acc;
    }, {
      totalOutstanding: 0,
      aging0to30: 0,
      aging31to60: 0,
      aging61to90: 0,
      aging90plus: 0
    });
    
    res.json({
      success: true,
      summary,
      customers
    });
  } catch (err) {
    console.error("[CREDIT RECEIVABLES AGING ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});
 
/* ================= ALLOCATIONS FOR A PAYMENT ================= */
router.get("/payment-allocations/:paymentTransactionId", async (req, res) => {
  try {
    const { paymentTransactionId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("PaymentTransactionId", sql.UniqueIdentifier, paymentTransactionId)
      .query(`
        SELECT 
          cca.AllocationId,
          cca.PaymentTransactionId,
          cca.InvoiceTransactionId,
          cca.Amount AS AllocatedAmount,
          CONVERT(VARCHAR, cca.CreatedDate, 126) + '+08:00' AS CreatedDate,
          tx.BillNo,
          tx.SettlementId,
          tx.BillAmount,
          tx.OutstandingAmount
        FROM CustomerCreditAllocations cca
        JOIN CustomerCreditTransactions tx ON cca.InvoiceTransactionId = tx.TransactionId
        WHERE cca.PaymentTransactionId = @PaymentTransactionId
      `);
    res.json({ success: true, allocations: result.recordset });
  } catch (err) {
    console.error("[GET PAYMENT ALLOCATIONS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});
 
/* ================= SETTLEMENTS FOR AN INVOICE ================= */
router.get("/invoice-settlements/:invoiceTransactionId", async (req, res) => {
  try {
    const { invoiceTransactionId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("InvoiceTransactionId", sql.UniqueIdentifier, invoiceTransactionId)
      .query(`
        SELECT 
          cca.AllocationId,
          cca.PaymentTransactionId,
          cca.InvoiceTransactionId,
          cca.Amount AS AllocatedAmount,
          CONVERT(VARCHAR, cca.CreatedDate, 126) + '+08:00' AS CreatedDate,
          tx.PaymentMethod,
          tx.ReferenceNo,
          tx.Remarks,
          tx.PaidAmount AS TotalPaymentAmount
        FROM CustomerCreditAllocations cca
        JOIN CustomerCreditTransactions tx ON cca.PaymentTransactionId = tx.TransactionId
        WHERE cca.InvoiceTransactionId = @InvoiceTransactionId
      `);
    res.json({ success: true, settlements: result.recordset });
  } catch (err) {
    console.error("[GET INVOICE SETTLEMENTS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});
 
/* ================= RECENT COLLECTIONS ================= */
router.get("/receivables/recent-collections", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP 50
        tx.TransactionId,
        tx.MemberId,
        tx.BillNo,
        tx.PaidAmount AS Amount,
        tx.PaymentMethod,
        tx.ReferenceNo,
        tx.Remarks,
        CONVERT(VARCHAR, tx.CreatedDate, 126) + '+08:00' AS CreatedDate,
        c.Name AS CustomerName,
        c.Phone AS CustomerPhone,
        'CREDIT' AS CustomerType
      FROM CustomerCreditTransactions tx
      JOIN CreditCustomerMaster c ON tx.MemberId = c.CustomerId
      WHERE tx.TransactionType = 'PAYMENT'
      ORDER BY tx.CreatedDate DESC
    `);
    res.json({ success: true, collections: result.recordset });
  } catch (err) {
    console.error("[GET RECENT COLLECTIONS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});
 
module.exports = router;
