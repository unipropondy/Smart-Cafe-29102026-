const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

// ─── PUBLIC PROMO ENDPOINTS (No Token Needed) ──────────────────────────────
router.get("/promocode/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const pool = await poolPromise;
    const cleanCode = code ? code.trim() : "";
    if (!cleanCode) {
      return res.status(400).json({ error: "Promo code is required" });
    }

    // 1. Check PromoCodeMaster first (for global promo codes configured in system)
    const promoResult = await pool.request()
      .input("code", sql.NVarChar, cleanCode)
      .query(`
        SELECT PromoId, PromoCode AS Promocode, PromoName, DiscountType, DiscountValue AS Promoamount, MaxUsage, UsedCount, IsActive
        FROM PromoCodeMaster
        WHERE PromoCode = @code AND IsActive = 1
      `);

    if (promoResult.recordset.length > 0) {
      const promo = promoResult.recordset[0];
      if (promo.MaxUsage !== null && promo.MaxUsage !== undefined && promo.UsedCount >= promo.MaxUsage) {
        return res.status(400).json({ error: "This promo code has reached maximum usage limit" });
      }
      return res.json({
        MemberId: null,
        Name: promo.PromoName || "Promo Code",
        Phone: "",
        Promocode: promo.Promocode,
        Promoamount: Number(promo.Promoamount || 0),
        DiscountType: (promo.DiscountType || "AMOUNT").toUpperCase(),
        MaxUsage: promo.MaxUsage,
        UsedCount: promo.UsedCount
      });
    }

    // 2. Check MemberMaster if not found in PromoCodeMaster
    const memberResult = await pool.request()
      .input("code", sql.NVarChar, cleanCode)
      .query(`
        SELECT MemberId, Name, Phone, Promocode, Promoamount 
        FROM MemberMaster 
        WHERE Promocode = @code AND IsActive = 1
      `);

    if (memberResult.recordset.length > 0) {
      const member = memberResult.recordset[0];
      if (Number(member.Promoamount || 0) <= 0) {
        return res.status(400).json({ error: "Promo code balance has been exhausted" });
      }
      return res.json({
        MemberId: member.MemberId,
        Name: member.Name,
        Phone: member.Phone,
        Promocode: member.Promocode,
        Promoamount: Number(member.Promoamount || 0),
        DiscountType: "AMOUNT"
      });
    }

    return res.status(404).json({ error: "Invalid or inactive promo code" });
  } catch (err) {
    console.error("[PROMOCODE LOOKUP ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/deduct-promo", async (req, res) => {
  try {
    const { promoCode, amount } = req.body;
    const cleanCode = promoCode ? promoCode.trim() : "";
    const deductAmt = Number(amount || 0);

    if (!cleanCode || deductAmt <= 0) {
      return res.status(400).json({ error: "Invalid promo code or amount" });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("PromoCode", sql.NVarChar(100), cleanCode)
      .input("DeductAmount", sql.Decimal(18, 2), deductAmt)
      .query(`
        UPDATE MemberMaster 
        SET Promoamount = CASE WHEN Promoamount - @DeductAmount < 0 THEN 0 ELSE Promoamount - @DeductAmount END,
            ModifiedOn = GETDATE()
        WHERE Promocode = @PromoCode AND IsActive = 1;

        UPDATE PromoCodeMaster 
        SET UsedCount = ISNULL(UsedCount, 0) + 1 
        WHERE PromoCode = @PromoCode AND IsActive = 1;

        SELECT MemberId, Promocode, Promoamount FROM MemberMaster WHERE Promocode = @PromoCode;
      `);

    const updatedMember = result.recordset.length > 0 ? result.recordset[0] : null;
    return res.json({
      success: true,
      message: "Promo amount deducted successfully from MemberMaster",
      remainingBalance: updatedMember ? Number(updatedMember.Promoamount || 0) : 0,
    });
  } catch (err) {
    console.error("[DEDUCT PROMO ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

let promoImageCache = null;
let promoImageCacheTime = 0;
const CACHE_TTL = 60000; // 60 seconds

router.get("/active-promo-image", async (req, res) => {
  try {
    const now = Date.now();
    if (promoImageCache && (now - promoImageCacheTime < CACHE_TTL)) {
      return res.json(promoImageCache);
    }

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT PromoImage, PromoCode, PromoName
      FROM PromoCodeMaster
      WHERE IsActive = 1 AND PromoImage IS NOT NULL
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No active promo images found" });
    }

    const promoImages = result.recordset.map(row => {
      const base64Image = Buffer.from(row.PromoImage).toString("base64");
      return {
        promoCode: row.PromoCode,
        promoName: row.PromoName,
        promoImage: `data:image/jpeg;base64,${base64Image}`
      };
    });

    const responseData = {
      success: true,
      promoImages
    };

    promoImageCache = responseData;
    promoImageCacheTime = now;

    return res.json(responseData);
  } catch (err) {
    console.error("[GET ACTIVE PROMO IMAGE ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PRIVATE SECURE ENDPOINTS (Token Required) ─────────────────────────────
router.use(authenticateToken);
const { runInTransaction } = require("../utils/transactionHelper");
const { processSplitPayments } = require("../services/payment.service");
const { computeThreshold, sendBalanceNotification } = require("../utils/whatsappService");


const toGuidOrNull = (value) => {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
};

router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT * FROM MemberMaster ORDER BY Name");
    res.json(result.recordset);
  } catch (err) {
    console.error("[MEMBERS GET ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/add", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { name, phone, email, creditLimit, currentBalance, balance, address, isActive, userId, promocode, promoamount } = req.body;
    
    // Duplicate Phone Check
    if (phone && phone.trim()) {
      const checkDup = await pool.request()
        .input("Phone", sql.NVarChar, phone.trim())
        .query("SELECT Name FROM MemberMaster WHERE Phone = @Phone AND IsActive = 1");
      if (checkDup.recordset.length > 0) {
        return res.status(400).json({ error: `Phone number is already assigned to member ${checkDup.recordset[0].Name}` });
      }
    }

    const result = await pool.request()
      .input("Name", sql.NVarChar, name)
      .input("Phone", sql.NVarChar, phone)
      .input("Email", sql.NVarChar, email || null)
      .input("Address", sql.NVarChar, address || null)
      .input("IsActive", sql.Bit, isActive !== undefined ? isActive : 1)
      .input("CreditLimit", sql.Decimal(18, 2), parseFloat(creditLimit) || 0)
      .input("CurrentBalance", sql.Decimal(18, 2), parseFloat(currentBalance) || 0)
      .input("Balance", sql.Decimal(18, 2), parseFloat(balance) || 0)
      .input("CreatedBy", sql.UniqueIdentifier, userId || null)
      .input("Promocode", sql.NVarChar, promocode || null)
      .input("Promoamount", sql.Decimal(18, 2), parseFloat(promoamount) || 0)
      .query(`
        DECLARE @newId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO MemberMaster (MemberId, Name, Phone, Email, Address, IsActive, CreditLimit, CurrentBalance, Balance, CreatedBy, Promocode, Promoamount)
        VALUES (@newId, @Name, @Phone, @Email, @Address, @IsActive, @CreditLimit, @CurrentBalance, @Balance, @CreatedBy, @Promocode, @Promoamount);
        SELECT @newId AS MemberId;
      `);
    
    const memberId = result.recordset[0].MemberId;
    res.json({
      success: true,
      member: {
        MemberId: memberId,
        Name: name,
        Phone: phone,
        CreditLimit: parseFloat(creditLimit) || 0,
        CurrentBalance: parseFloat(currentBalance) || 0,
        AvailableCredit: (parseFloat(creditLimit) || 0) > 0 ? ((parseFloat(creditLimit) || 0) - (parseFloat(currentBalance) || 0)) : (parseFloat(currentBalance) || 0),
        IsActive: isActive !== undefined ? isActive : 1,
        Promocode: promocode || null,
        Promoamount: parseFloat(promoamount) || 0
      }
    });
  } catch (err) {
    console.error("[MEMBERS ADD ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/update", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, name, phone, email, creditLimit, currentBalance, balance, address, isActive, userId, promocode, promoamount } = req.body;
    
    // Duplicate Phone Check excluding current member
    if (phone && phone.trim()) {
      const checkDup = await pool.request()
        .input("Phone", sql.NVarChar, phone.trim())
        .input("Id", sql.UniqueIdentifier, memberId)
        .query("SELECT Name FROM MemberMaster WHERE Phone = @Phone AND MemberId <> @Id AND IsActive = 1");
      if (checkDup.recordset.length > 0) {
        return res.status(400).json({ error: `Phone number is already assigned to member ${checkDup.recordset[0].Name}` });
      }
    }

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
      .input("ModifiedBy", sql.UniqueIdentifier, userId || null)
      .input("Promocode", sql.NVarChar, promocode || null)
      .input("Promoamount", sql.Decimal(18, 2), parseFloat(promoamount) || 0)
      .query(`
        UPDATE MemberMaster SET 
          Name = @Name, Phone = @Phone, Email = @Email, Address = @Address, IsActive = @IsActive,
          CreditLimit = @CreditLimit, CurrentBalance = @CurrentBalance, Balance = @Balance,
          ModifiedBy = @ModifiedBy, ModifiedDate = GETDATE(),
          Promocode = @Promocode, Promoamount = @Promoamount
        WHERE MemberId = @Id
      `);
    res.json({ success: true });
  } catch (err) {
    console.error("[MEMBERS UPDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/delete", async (req, res) => {
  try {
    const { memberId } = req.body;
    if (!memberId) return res.status(400).json({ error: "Missing memberId" });

    await runInTransaction(async (transaction) => {
      const request = new sql.Request(transaction);
      request.input("Id", sql.UniqueIdentifier, memberId);

      await request.query("IF OBJECT_ID('MemberTimeLog', 'U') IS NOT NULL DELETE FROM MemberTimeLog WHERE MemberId = @Id");
      await request.query("IF COL_LENGTH('SettlementHeader', 'MemberId') IS NOT NULL UPDATE SettlementHeader SET MemberId = NULL WHERE MemberId = @Id;");
      await request.query("DELETE FROM MemberMaster WHERE MemberId = @Id");
    }, { name: "DeleteMember" });

    res.json({ success: true });
  } catch (err) {
    console.error("[MEMBERS DELETE ERROR]", err);
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
        SELECT MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive, Promocode, Promoamount, AvailableCredit
        FROM MemberMaster 
        WHERE (Name LIKE @query OR Phone LIKE @query)
        ORDER BY Name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[MEMBERS SEARCH ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/promocodes/all", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT MemberId, Name, Phone, Promocode, Promoamount 
      FROM MemberMaster 
      WHERE Promocode IS NOT NULL AND LTRIM(RTRIM(Promocode)) <> '' AND IsActive = 1 AND Promoamount > 0
      ORDER BY Promocode
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[PROMOCODES ALL ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});



// Member Dashboard Stats — recharges this month, today, active members, total balance
router.get("/stats", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        -- Active members count
        (SELECT COUNT(*) FROM MemberMaster WHERE IsActive = 1) AS totalActiveMembers,
        -- Total available balance across all active members
        (SELECT ISNULL(SUM(CurrentBalance), 0) FROM MemberMaster WHERE IsActive = 1) AS totalAvailableBalance,
        -- Recharges added this calendar month (RECHARGE transactions in CCT linked to MemberMaster)
        (
          SELECT ISNULL(SUM(cct.PaidAmount), 0)
          FROM CustomerCreditTransactions cct
          INNER JOIN MemberMaster mm ON cct.MemberId = mm.MemberId
          WHERE cct.TransactionType = 'PAYMENT'
            AND MONTH(cct.CreatedDate) = MONTH(GETDATE())
            AND YEAR(cct.CreatedDate) = YEAR(GETDATE())
        ) AS rechargesThisMonth,
        -- Recharges added today
        (
          SELECT ISNULL(SUM(cct.PaidAmount), 0)
          FROM CustomerCreditTransactions cct
          INNER JOIN MemberMaster mm ON cct.MemberId = mm.MemberId
          WHERE cct.TransactionType = 'PAYMENT'
            AND CAST(cct.CreatedDate AS DATE) = CAST(GETDATE() AS DATE)
        ) AS rechargesToday
    `);

    const row = result.recordset[0] || {};
    res.json({
      success: true,
      stats: {
        totalActiveMembers: Number(row.totalActiveMembers || 0),
        totalAvailableBalance: Number(row.totalAvailableBalance || 0),
        rechargesThisMonth: Number(row.rechargesThisMonth || 0),
        rechargesToday: Number(row.rechargesToday || 0),
      }
    });
  } catch (err) {
    console.error("[MEMBER STATS ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/validate/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const { amount } = req.query;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT MemberId, Name, Phone, CreditLimit, CurrentBalance, IsActive, AvailableCredit
        FROM MemberMaster 
        WHERE MemberId = @MemberId
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Member not found" });
    }
    
    const member = result.recordset[0];
    if (!member.IsActive) {
      return res.status(400).json({ success: false, error: "Member is inactive" });
    }
    
    const billAmount = parseFloat(amount) || 0;
    const currentBalance = parseFloat(member.CurrentBalance) || 0;
    const creditLimit = parseFloat(member.CreditLimit) || 0;
    const remainingCredit = creditLimit - currentBalance;
    
    if (currentBalance + billAmount > creditLimit) {
      return res.status(400).json({ 
        success: false, 
        error: "Credit Limit Exceeded",
        member: {
          ...member,
          RemainingCredit: remainingCredit
        }
      });
    }
    
    res.json({
      success: true,
      member: {
        ...member,
        RemainingCredit: remainingCredit
      }
    });
  } catch (err) {
    console.error("[MEMBERS VALIDATE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/usage/:memberId", async (req, res) => {
  try {
    const { memberId } = req.params;
    const pool = await poolPromise;

    // Fetch the member's details (Name, Phone, RewardCredit, Balances)
    const memberRes = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT MemberId, Name, Phone, 
               ISNULL(RewardCredit, 0) as RewardCredit,
               ISNULL(AvailableCredit, 0) as AvailableCredit,
               ISNULL(CurrentBalance, 0) as CurrentBalance,
               ISNULL(Balance, 0) as Balance,
               ISNULL(CreditLimit, 0) as CreditLimit,
               CreatedAt
        FROM MemberMaster 
        WHERE MemberId = @MemberId
      `);
    
    const memberRow = memberRes.recordset[0] || {};
    const memberName = (memberRow.Name || "").trim();
    const rawPhone = (memberRow.Phone || "").trim();
    const cleanDigits = rawPhone.replace(/\D/g, "");
    const last8Digits = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;

    // Fast phone variants array for indexed matching
    const phoneVariants = [
      rawPhone,
      cleanDigits,
      last8Digits,
      `+65${last8Digits}`,
      `+60${last8Digits}`,
      `+91${last8Digits}`,
      `+1${last8Digits}`,
      `+44${last8Digits}`,
      `+61${last8Digits}`
    ].filter(p => Boolean(p) && p.trim().length > 3);

    // 1. Ultra-fast bills query
    const txReq = pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .input("MemberName", sql.NVarChar(100), memberName)
      .input("RewardCredit", sql.Decimal(18, 4), memberRow.RewardCredit || 0)
      .input("ModifiedDate", sql.DateTime, memberRow.ModifiedDate || null);
    
    const phoneParams = phoneVariants.map((p, idx) => {
      const pName = `Phone_${idx}`;
      txReq.input(pName, sql.NVarChar(50), p);
      return `@${pName}`;
    });

    const phoneCondition = phoneParams.length > 0 ? `OR sh.MobileNo IN (${phoneParams.join(", ")})` : "";
    const nameCondition = memberName && !['Guest Cus', 'Guest'].includes(memberName) 
      ? `OR (sh.MemberId IS NULL AND sh.MobileNo IS NULL AND sh.GuestName = @MemberName AND sh.GuestName NOT IN ('Guest Cus', 'Guest', ''))` 
      : "";
    const dateFallback = memberRow.ModifiedDate 
      ? `OR (ABS(DATEDIFF(second, sh.LastSettlementDate, @ModifiedDate)) <= 5 AND ABS(sh.SysAmount * 0.01 - @RewardCredit) < 0.005)` 
      : "";

    const txsRes = await txReq.query(`
      SELECT 
        sh.SettlementID, 
        sh.BillNo, 
        sh.MemberId,
        CONVERT(VARCHAR, sh.LastSettlementDate, 126) + '+08:00' AS LastSettlementDate, 
        sh.SysAmount,
        LTRIM(RTRIM(sh.TableNo)) as TableNo,
        ISNULL(sh.OrderType, 'DINE-IN') as OrderType,
        CASE WHEN sh.entry_status = 'q' THEN 1 ELSE 0 END as isQROrder,
        ISNULL(sh.DiscountAmount, 0) as DiscountAmount,
        sh.DiscountType,
        ROUND(sh.SysAmount * 0.01, 2) as PointsEarned,
        ISNULL((
          SELECT TOP 1 LTRIM(RTRIM(sd.Paymode)) 
          FROM SettlementDetail sd 
          WHERE sd.SettlementId = sh.SettlementID AND sd.Paymode IS NOT NULL AND sd.Paymode <> ''
        ), (
          SELECT TOP 1 LTRIM(RTRIM(std.PayMode))
          FROM SettlementTranDetail std
          WHERE std.SettlementID = sh.SettlementID AND std.PayMode IS NOT NULL AND std.PayMode <> ''
        )) as PayMode
      FROM SettlementHeader sh
      WHERE (
          sh.MemberId = @MemberId 
          ${phoneCondition} 
          ${nameCondition}
          OR sh.BillNo IN (SELECT ro.OrderNumber FROM RestaurantOrderCur ro WHERE ro.CustomerId = @MemberId)
          OR sh.BillNo IN (SELECT ro2.OrderNumber FROM RestaurantOrder ro2 WHERE ro2.CustomerId = @MemberId)
          OR sh.SettlementID IN (SELECT rpd.SettlementId FROM RewardPointDetails rpd WHERE rpd.MemberId = @MemberId)
          OR sh.BillNo IN (SELECT rpd2.BillNo FROM RewardPointDetails rpd2 WHERE rpd2.MemberId = @MemberId)
          ${dateFallback}
        )
        AND sh.IsCancelled = 0 
      ORDER BY sh.LastSettlementDate DESC
    `);

    const transactions = txsRes.recordset || [];

    // 2. Summary calculated instantly from transactions
    const totalSpent = transactions.reduce((acc, tx) => acc + (parseFloat(tx.SysAmount) || 0), 0);
    const totalOrders = transactions.length;

    // 3. Ultra-fast Items query using exact SettlementIDs
    let items = [];
    if (transactions.length > 0) {
      const sIds = transactions.map(t => `'${t.SettlementID}'`).join(',');
      const itemsRes = await pool.request().query(`
        SELECT 
          sid.DishName, 
          SUM(sid.Qty) as TotalQty, 
          SUM(sid.Price * sid.Qty) as TotalAmount 
        FROM SettlementItemDetail sid
        WHERE sid.SettlementID IN (${sIds})
        GROUP BY sid.DishName 
        ORDER BY TotalQty DESC
      `);
      items = itemsRes.recordset || [];
    }

    // 4. Restaurant orders (including QR Orders) without grouping whole table
    const orderReq = pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .input("MemberName", sql.NVarChar(100), memberName);
    
    phoneVariants.forEach((p, idx) => {
      orderReq.input(`OPhone_${idx}`, sql.NVarChar(50), p);
    });
    const orderPhoneCond = phoneParams.length > 0 ? `OR ro.MobileNo IN (${phoneVariants.map((_, i) => `@OPhone_${i}`).join(", ")})` : "";
    const orderNameCond = memberName && !['Guest Cus', 'Guest'].includes(memberName)
      ? `OR (ro.CustomerId IS NULL AND ro.MobileNo IS NULL AND ro.CustomerName = @MemberName)`
      : "";

    const allOrdersRes = await orderReq.query(`
      SELECT 
        ro.OrderId,
        ro.OrderNumber,
        CONVERT(VARCHAR, ro.OrderDateTime, 126) + '+08:00' AS OrderDateTime,
        LTRIM(RTRIM(ro.Tableno)) as TableNo,
        ro.TotalAmount,
        ro.entry_status,
        ro.isOrderClosed,
        CASE WHEN ro.entry_status = 'q' THEN 1 ELSE 0 END as isQROrder
      FROM RestaurantOrderCur ro
      WHERE (ro.CustomerId = @MemberId ${orderPhoneCond} ${orderNameCond})
      ORDER BY ro.OrderDateTime DESC
    `);

    // Match QR status and update isQROrder on transactions
    const qrBillNumbers = new Set();
    const allOrders = (allOrdersRes.recordset || []).map(ro => {
      if (ro.isQROrder === 1) {
        qrBillNumbers.add(ro.OrderNumber);
      }
      const matchTx = transactions.find(t => t.BillNo === ro.OrderNumber);
      return {
        ...ro,
        SettlementID: matchTx?.SettlementID || null,
        BillStatus: matchTx ? 'SETTLED' : (ro.isOrderClosed ? 'CLOSED' : 'OPEN / KITCHEN')
      };
    });

    // Ensure transaction knows if it was a QR order
    transactions.forEach(tx => {
      if (qrBillNumbers.has(tx.BillNo)) {
        tx.isQROrder = 1;
      }
    });

    // 5. Reward Points History Ledger (Show ONLY particular orders that have reward points)
    const currentRewardCredit = parseFloat(memberRow.RewardCredit) || 0;

    // Check if explicit reward points transactions exist in RewardPointDetails
    const rpdRes = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          Id, SettlementId, BillNo, BillAmount as Amount, 
          PointsEarned, PointsUsed, TransType, PayMode, Remarks,
          CONVERT(VARCHAR, ISNULL(CreatedOn, GETDATE()), 126) + '+08:00' as Date
        FROM RewardPointDetails
        WHERE MemberId = @MemberId AND (PointsEarned > 0 OR PointsUsed > 0)
        ORDER BY CreatedOn DESC
      `);
    const rpdRows = rpdRes.recordset || [];

    let rewardHistory = [];
    let earnedFromBills = 0;

    if (rpdRows.length > 0) {
      rewardHistory = rpdRows.map(r => {
        const isEarned = (parseFloat(r.PointsEarned) || 0) > 0;
        const pts = isEarned ? parseFloat(r.PointsEarned) : -parseFloat(r.PointsUsed || 0);
        if (isEarned) earnedFromBills += parseFloat(r.PointsEarned || 0);
        return {
          Id: r.Id,
          SettlementID: r.SettlementId,
          BillNo: r.BillNo,
          Amount: r.Amount,
          Points: pts,
          Type: r.TransType || (isEarned ? 'EARNED' : 'REDEEMED'),
          Date: r.Date,
          Remarks: r.Remarks || (isEarned ? `Earned points on Bill #${r.BillNo}` : `Redeemed points on Bill #${r.BillNo}`)
        };
      });
    } else if (currentRewardCredit > 0) {
      // Historical/Legacy fallback: ONLY orders that actually have reward points!
      const pointOrders = transactions.filter(tx => {
        const isMemberBill = tx.MemberId && tx.MemberId.toLowerCase() === memberId.toLowerCase();
        return isMemberBill && (tx.PointsEarned > 0);
      });

      // If no bills have MemberId yet, check if any bill matched the member's RewardCredit exactly
      const qualifyingBills = pointOrders.length > 0 ? pointOrders : transactions.filter(tx => {
        return Math.abs((tx.PointsEarned || 0) - currentRewardCredit) < 0.01;
      });

      rewardHistory = qualifyingBills.map(tx => {
        earnedFromBills += (tx.PointsEarned || 0);
        return {
          Id: tx.SettlementID,
          SettlementID: tx.SettlementID,
          BillNo: tx.BillNo,
          TableNo: tx.TableNo,
          OrderType: tx.OrderType,
          isQROrder: tx.isQROrder,
          Amount: tx.SysAmount,
          Points: tx.PointsEarned || 0,
          Type: 'EARNED',
          Date: tx.LastSettlementDate,
          Remarks: `Earned 1% loyalty points on Bill #${tx.BillNo}`
        };
      });
    }

    const initialOpeningPoints = Math.max(0, Math.round((currentRewardCredit - earnedFromBills) * 100) / 100);

    if (initialOpeningPoints > 0) {
      rewardHistory.push({
        Id: 'opening-bal',
        SettlementID: null,
        BillNo: 'OPENING-BALANCE',
        Amount: 0,
        Points: initialOpeningPoints,
        Type: 'OPENING',
        Date: memberRow.CreatedAt ? new Date(memberRow.CreatedAt).toISOString() : new Date().toISOString(),
        Remarks: 'Opening balance / initial registration points'
      });
    }

    rewardHistory.sort((a, b) => new Date(b.Date) - new Date(a.Date));
      
    res.json({
        success: true,
        member: memberRow,
        summary: {
          TotalSpent: totalSpent,
          TotalOrders: totalOrders,
          RewardCredit: currentRewardCredit,
          EarnedFromBills: Math.round(earnedFromBills * 100) / 100,
          OpeningPoints: initialOpeningPoints,
          AvailableCredit: parseFloat(memberRow.AvailableCredit) || 0,
          CurrentBalance: parseFloat(memberRow.CurrentBalance) || 0,
          Balance: parseFloat(memberRow.Balance) || 0,
          CreditLimit: parseFloat(memberRow.CreditLimit) || 0,
        },
        items,
        transactions,
        allOrders,
        qrOrders: allOrders.filter(o => o.isQROrder === 1),
        rewardHistory
    });
  } catch (err) {
    console.error("[MEMBERS USAGE ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/usage-by-phone/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    const pool = await poolPromise;
    const cleanPhone = String(phone || "").trim();

    // 1. Look up the member by phone number
    const memberRes = await pool.request()
      .input("Phone", sql.NVarChar(50), cleanPhone)
      .query(`
        SELECT TOP 1 MemberId, Name, Phone, Promocode, Promoamount
        FROM MemberMaster
        WHERE Phone = @Phone OR Phone LIKE '%' + @Phone OR REPLACE(Phone, '+', '') LIKE '%' + @Phone
      `);

    if (memberRes.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Member not found for this phone number" });
    }

    const member = memberRes.recordset[0];
    const memberId = member.MemberId;
    const memberName = (member.Name || "").trim();
    const rawPhone = (member.Phone || "").trim();
    const cleanDigits = rawPhone.replace(/\D/g, "");
    const last8Digits = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;

    const phoneVariants = [
      rawPhone,
      cleanDigits,
      last8Digits,
      `+65${last8Digits}`,
      `+60${last8Digits}`,
      `+91${last8Digits}`,
      `+1${last8Digits}`,
      `+44${last8Digits}`,
      `+61${last8Digits}`
    ].filter(p => Boolean(p) && p.trim().length > 3);

    // 1. Ultra-fast bills query
    const txReq = pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .input("MemberName", sql.NVarChar(100), memberName);
    
    phoneVariants.forEach((p, idx) => {
      txReq.input(`Phone_${idx}`, sql.NVarChar(50), p);
    });

    const phoneCondition = phoneVariants.length > 0 ? `OR sh.MobileNo IN (${phoneVariants.map((_, i) => `@Phone_${i}`).join(", ")})` : "";
    const nameCondition = memberName && !['Guest Cus', 'Guest'].includes(memberName) 
      ? `OR (sh.GuestName = @MemberName AND sh.GuestName NOT IN ('Guest Cus', 'Guest', ''))` 
      : "";

    const txsRes = await txReq.query(`
      SELECT 
        sh.SettlementID, 
        sh.BillNo, 
        CONVERT(VARCHAR, sh.LastSettlementDate, 126) + '+08:00' AS LastSettlementDate, 
        sh.SysAmount,
        LTRIM(RTRIM(sh.TableNo)) as TableNo,
        ISNULL(sh.OrderType, 'DINE-IN') as OrderType,
        CASE WHEN sh.entry_status = 'q' THEN 1 ELSE 0 END as isQROrder,
        ISNULL(sh.DiscountAmount, 0) as DiscountAmount,
        sh.DiscountType,
        ROUND(sh.SysAmount * 0.01, 2) as PointsEarned
      FROM SettlementHeader sh
      WHERE (sh.MemberId = @MemberId ${phoneCondition} ${nameCondition})
        AND sh.IsCancelled = 0 
      ORDER BY sh.LastSettlementDate DESC
    `);

    const transactions = txsRes.recordset || [];

    // 2. Summary
    const totalSpent = transactions.reduce((acc, tx) => acc + (parseFloat(tx.SysAmount) || 0), 0);
    const totalOrders = transactions.length;

    // 3. Items Consumed
    let items = [];
    if (transactions.length > 0) {
      const sIds = transactions.map(t => `'${t.SettlementID}'`).join(',');
      const itemsRes = await pool.request().query(`
        SELECT 
          sid.DishName, 
          SUM(sid.Qty) as TotalQty, 
          SUM(sid.Price * sid.Qty) as TotalAmount 
        FROM SettlementItemDetail sid
        WHERE sid.SettlementID IN (${sIds})
        GROUP BY sid.DishName 
        ORDER BY TotalQty DESC
      `);
      items = itemsRes.recordset || [];
    }
      
    res.json({
        success: true,
        member,
        summary: {
          TotalSpent: totalSpent,
          TotalOrders: totalOrders
        },
        items,
        transactions
    });
  } catch (err) {
    console.error("[MEMBERS USAGE BY PHONE ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
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
        console.log(`[MEMBER PAY] Duplicate request detected. Session ${paymentSessionId} already exists.`);
        return res.json({ success: true, message: "Duplicate payment skipped", duplicate: true });
      }
    }

    if (!memberId) {
      return res.status(400).json({ error: "memberId is required" });
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

    let memberPaymentId;
    let paymentTransactionId;
    const payModeName = (payments && payments.length > 0) ? (payments[0].payMode || 'CASH') : 'CASH';

    await runInTransaction(async (transaction) => {
      // 1. Verify member exists and is active
      const memberCheck = await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .query("SELECT CreditLimit, CurrentBalance, IsActive FROM MemberMaster WITH (UPDLOCK) WHERE MemberId = @MemberId");
      
      if (memberCheck.recordset.length === 0) {
        throw new Error("Member not found");
      }
      
      const member = memberCheck.recordset[0];
      if (!member.IsActive) {
        throw new Error("Member is inactive");
      }

      // 2. Generate a new MemberPaymentId
      const payIdRes = await transaction.request().query("SELECT NEWID() as id");
      memberPaymentId = payIdRes.recordset[0].id;

      // 3. Process split payments using unified service
      await processSplitPayments({
        referenceType: "MEMBER",
        referenceId: memberId,
        payments,
        transaction,
        cashierId: userId ? String(userId).trim() : null
      });

      // 3.5. Write allocation credit rows to CustomerCreditTransactions
      let remainingPayment = numericAmt;
      const referenceNo = (payments && payments.length > 0) ? (payments[0].referenceNo || paymentSessionId || '') : (paymentSessionId || '');
      const mainRemarks = `${req.body.remarks || `Credit payment collection (${payModeName})`} [Session: ${paymentSessionId || ''}]`;

      // Fetch active business start_date
      let startDate = null;
      const activeDayRes = await transaction.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
      if (activeDayRes.recordset.length > 0) {
        startDate = activeDayRes.recordset[0].StartDate;
      }

      // 1. Write the primary PAYMENT transaction record
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
          VALUES (@MemberId, 'PAYMENT', 0, @Amount, -@Amount, @PaymentMethod, @ReferenceNo, 'CLOSED', @Remarks, @CreatedBy, 'MEMBER', @StartDate)
        `);
      
      paymentTransactionId = payTxResult.recordset[0].TransactionId;
      
      if (req.body.allocations && Array.isArray(req.body.allocations) && req.body.allocations.length > 0) {
        // --- MANUAL ALLOCATION ---
        for (const alloc of req.body.allocations) {
          const allocAmt = parseFloat(alloc.amount);
          if (isNaN(allocAmt) || allocAmt <= 0) continue;
          
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
          }
        }
      } else {
        // --- AUTO ALLOCATION (FIFO) ---
        // Fetch outstanding bills ordered by date
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

      // 4. Update member balance (subtract paid amount to clear/reduce credit balance)
      await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .input("Amount", sql.Decimal(18, 2), numericAmt)
        .query("UPDATE MemberMaster SET CurrentBalance = CurrentBalance - @Amount WHERE MemberId = @MemberId");
    }, { name: "MemberPayment", timeoutMs: 60000 });

    // 🏆 LOYALTY POINTS EARNED ON LEDGER SETTLEMENT COLLECTION
    setImmediate(async () => {
      try {
        // 1. Fetch active reward rule
        const ruleRes = await pool.query(
          `SELECT TOP 1 SpendAmount, CreditAmount FROM RewardMaster WHERE IsActive = 1 ORDER BY Id DESC`
        );
        if (ruleRes.recordset.length > 0) {
          const rule = ruleRes.recordset[0];
          const earned = (numericAmt / rule.SpendAmount) * rule.CreditAmount;
          const rewardPointsEarned = Math.round(earned * 10000) / 10000; // 4dp precision

          if (rewardPointsEarned > 0) {
            // 2. Add to MemberMaster.RewardCredit
            await pool.request()
              .input("MemberId", sql.UniqueIdentifier, memberId)
              .input("Points", sql.Decimal(18, 4), rewardPointsEarned)
              .query(`UPDATE MemberMaster SET RewardCredit = ISNULL(RewardCredit, 0) + @Points WHERE MemberId = @MemberId`);

            // 3. Log to RewardPointDetails audit table
            await pool.request()
              .input("MemberId", sql.UniqueIdentifier, memberId)
              .input("PaymentTransactionId", sql.UniqueIdentifier, paymentTransactionId)
              .input("BillAmount", sql.Decimal(18, 2), numericAmt)
              .input("PointsEarned", sql.Decimal(18, 4), rewardPointsEarned)
              .input("PayMode", sql.NVarChar(50), payModeName)
              .input("Remarks", sql.NVarChar(255), `Earned on ledger payment settlement`)
              .query(`
                INSERT INTO RewardPointDetails (MemberId, SettlementId, BillNo, BillAmount, PointsEarned, PointsUsed, TransType, PayMode, Remarks)
                VALUES (@MemberId, @PaymentTransactionId, 'SETTLEMENT', @BillAmount, @PointsEarned, 0, 'EARN', @PayMode, @Remarks)
              `);

            console.log(`[Rewards] ✅ Settlement points: awarded ${rewardPointsEarned} credit on outstanding payment of ${numericAmt} for member ${memberId}.`);
          }
        }
      } catch (rewardErr) {
        console.error(`[Rewards] ❌ Settlement points award failed (non-blocking):`, rewardErr.message);
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[MEMBER PAY ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/members/recharge ──────────────────────────────────────────────
router.post("/recharge", async (req, res) => {
  try {
    const { memberId, amount } = req.body;
    const numericAmt = parseFloat(amount);
    
    if (isNaN(numericAmt) || numericAmt <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    let updated;
    await runInTransaction(async (transaction) => {
      // Lock row to prevent concurrent updates
      const check = await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .query("SELECT MemberId, Name, Balance, CurrentBalance, IsActive FROM MemberMaster WITH (UPDLOCK) WHERE MemberId = @MemberId");

      if (check.recordset.length === 0) throw new Error("Member not found");
      if (!check.recordset[0].IsActive) throw new Error("Member is inactive");

      const result = await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .input("Amount", sql.Decimal(18, 2), numericAmt)
        .query(`
          UPDATE MemberMaster
          SET
            Balance            = Balance + @Amount,
            CurrentBalance     = CurrentBalance + @Amount,
            LowBalanceAlertSent = 0
          OUTPUT
            INSERTED.Balance,
            INSERTED.CurrentBalance,
            INSERTED.LowBalanceAlertSent
          WHERE MemberId = @MemberId
        `);

      updated = result.recordset[0];
    }, { name: "MemberRecharge", timeoutMs: 30000 });

    setImmediate(async () => {
      try {
        const pool = await poolPromise;
        await sendBalanceNotification(memberId, pool);
      } catch (err) {
        console.error("[WhatsApp] sendBalanceNotification error in recharge setImmediate:", err.message);
      }
    });

    res.json({
      success: true,
      Balance: updated.Balance,
      CurrentBalance: updated.CurrentBalance,
      LowBalanceAlertSent: updated.LowBalanceAlertSent,
    });
  } catch (err) {
    console.error("[MEMBER RECHARGE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/members/deductSale ────────────────────────────────────────────
// Internal endpoint called by the sale/checkout flow when CustomerType = MEMBER.
// Deducts saleAmount from CurrentBalance. If the resulting balance drops below
// the configured threshold AND no alert has been sent yet, fires a single
// WhatsApp low-balance notification and sets LowBalanceAlertSent = 1.
router.post("/deductSale", async (req, res) => {
  try {
    const { memberId, saleAmount } = req.body;

    if (!memberId) return res.status(400).json({ error: "memberId is required" });
    const numericAmt = parseFloat(saleAmount);
    if (isNaN(numericAmt) || numericAmt <= 0) {
      return res.status(400).json({ error: "saleAmount must be a positive number" });
    }

    let updatedBalance, alertFired = false;

    const pool = await poolPromise;

    await runInTransaction(async (transaction) => {
      // Lock and fetch member
      const check = await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .query("SELECT MemberId, CurrentBalance, CreditLimit, IsActive, LowBalanceAlertSent FROM MemberMaster WITH (UPDLOCK) WHERE MemberId = @MemberId");

      if (check.recordset.length === 0) throw new Error("Member not found");
      const member = check.recordset[0];
      if (!member.IsActive) throw new Error("Member is inactive");

      const currentBal = parseFloat(member.CurrentBalance) || 0;
      if (currentBal < numericAmt) {
        throw new Error(`Insufficient balance. Available: RM ${currentBal.toFixed(2)}, Required: RM ${numericAmt.toFixed(2)}`);
      }

      // Deduct balance
      const result = await transaction.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .input("Amount", sql.Decimal(18, 2), numericAmt)
        .query(`
          UPDATE MemberMaster
          SET CurrentBalance = CurrentBalance - @Amount
          OUTPUT INSERTED.CurrentBalance, INSERTED.CreditLimit, INSERTED.LowBalanceAlertSent
          WHERE MemberId = @MemberId
        `);

      const updated = result.recordset[0];
      updatedBalance = parseFloat(updated.CurrentBalance);
      const threshold = computeThreshold(parseFloat(updated.CreditLimit) || 0);

      // Fire alert only once per low-balance event
      if (updatedBalance < threshold && updated.LowBalanceAlertSent === false) {
        await transaction.request()
          .input("MemberId", sql.UniqueIdentifier, memberId)
          .query("UPDATE MemberMaster SET LowBalanceAlertSent = 1 WHERE MemberId = @MemberId");
        alertFired = true;
      }
    }, { name: "MemberDeductSale", timeoutMs: 30000 });

    // Send WhatsApp outside the transaction (non-fatal)
    setImmediate(async () => {
      try {
        await sendBalanceNotification(memberId, pool);
      } catch (err) {
        console.error("[WhatsApp] sendBalanceNotification error in deductSale setImmediate:", err.message);
      }
    });

    res.json({
      success: true,
      newBalance: updatedBalance,
      alertFired,
    });
  } catch (err) {
    console.error("[MEMBER DEDUCT SALE ERROR]", err);
    const status = err.message.startsWith("Insufficient") ? 400 : 500;
    res.status(status).json({ error: err.message });
  }

});

// Unused credit customer/receivables endpoints removed

module.exports = router;

