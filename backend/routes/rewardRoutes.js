const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

router.use((req, res, next) => {
  if (req.method === "GET" && (req.path === "/members/by-id-or-phone" || req.path === "/members/search" || req.path === "/master")) {
    return next();
  }
  return authenticateToken(req, res, next);
});

// ─────────────────────────────────────────────
// REWARD MASTER CONFIG
// ─────────────────────────────────────────────

/**
 * GET /api/rewards/master
 * Returns the active reward earn rule (spend amount → credit amount)
 */
router.get("/master", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT TOP 1 Id, SpendAmount, CreditAmount, IsActive, Description, CreatedOn, ModifiedOn
      FROM RewardMaster
      WHERE IsActive = 1
      ORDER BY Id DESC
    `);
    if (result.recordset.length === 0) {
      return res.json({ SpendAmount: 100, CreditAmount: 1, IsActive: 1, Description: "Default" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[Rewards] GET master error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/rewards/master
 * Update the active reward earn rule
 * Body: { spendAmount, creditAmount, description }
 */
router.put("/master", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { spendAmount, creditAmount, description } = req.body;
    const spend = parseFloat(spendAmount);
    const credit = parseFloat(creditAmount);

    if (!spend || spend <= 0 || !credit || credit <= 0) {
      return res.status(400).json({ error: "spendAmount and creditAmount must be positive numbers" });
    }

    const existing = await pool.request().query(`SELECT TOP 1 Id FROM RewardMaster ORDER BY Id DESC`);
    if (existing.recordset.length > 0) {
      await pool.request()
        .input("SpendAmount", sql.Decimal(18, 2), spend)
        .input("CreditAmount", sql.Decimal(18, 4), credit)
        .input("Description", sql.NVarChar(255), description || null)
        .input("Id", sql.Int, existing.recordset[0].Id)
        .query(`
          UPDATE RewardMaster 
          SET SpendAmount = @SpendAmount, CreditAmount = @CreditAmount, Description = @Description, ModifiedOn = GETDATE()
          WHERE Id = @Id
        `);
    } else {
      await pool.request()
        .input("SpendAmount", sql.Decimal(18, 2), spend)
        .input("CreditAmount", sql.Decimal(18, 4), credit)
        .input("Description", sql.NVarChar(255), description || null)
        .query(`
          INSERT INTO RewardMaster (SpendAmount, CreditAmount, IsActive, Description)
          VALUES (@SpendAmount, @CreditAmount, 1, @Description)
        `);
    }
    res.json({ success: true, spendAmount: spend, creditAmount: credit });
  } catch (err) {
    console.error("[Rewards] PUT master error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// MEMBER SEARCH (by name or phone)
// ─────────────────────────────────────────────

/**
 * GET /api/rewards/members/search?q=
 * Search MemberMaster by name or phone for reward lookup
 */
router.get("/members/search", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { q } = req.query;
    const query = `%${(q || "").trim()}%`;
    const result = await pool.request()
      .input("query", sql.NVarChar, query)
      .query(`
        SELECT 
          MemberId, Name, Phone, 
          ISNULL(RewardCredit, 0) AS RewardCredit,
          AvailableCredit,
          CreditLimit, CurrentBalance, IsActive
        FROM MemberMaster
        WHERE IsActive = 1
          AND (Name LIKE @query OR Phone LIKE @query)
        ORDER BY Name
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[Rewards] member search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rewards/members/by-id-or-phone?id=&phone=
 * Lookup a single active member with full reward details by MemberId or Phone
 */
router.get("/members/by-id-or-phone", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { id, phone } = req.query;
    const rawId = (id || "").trim();
    const rawPhone = (phone || "").trim();

    if (!rawId && !rawPhone) {
      return res.status(400).json({ success: false, error: "Missing id or phone" });
    }

    const reqDb = pool.request();
    const conditions = [];

    if (rawId) {
      reqDb.input("MemberId", sql.VarChar(50), rawId);
      conditions.push("(TRY_CAST(@MemberId AS UNIQUEIDENTIFIER) IS NOT NULL AND MemberId = TRY_CAST(@MemberId AS UNIQUEIDENTIFIER))");
    }

    if (rawPhone) {
      reqDb.input("Phone", sql.NVarChar(50), rawPhone);
      conditions.push(`(
        Phone = @Phone 
        OR REPLACE(REPLACE(Phone, ' ', ''), '-', '') = REPLACE(REPLACE(@Phone, ' ', ''), '-', '')
        OR (LEN(REPLACE(REPLACE(@Phone, ' ', ''), '-', '')) >= 8 AND Phone LIKE '%' + REPLACE(REPLACE(@Phone, ' ', ''), '-', ''))
        OR (LEN(REPLACE(REPLACE(@Phone, ' ', ''), '-', '')) >= 8 AND REPLACE(REPLACE(@Phone, ' ', ''), '-', '') LIKE '%' + REPLACE(REPLACE(Phone, ' ', ''), '-', ''))
      )`);
    }

    const query = `
      SELECT TOP 1
        MemberId, Name, Phone, Email,
        ISNULL(RewardCredit, 0) AS RewardCredit,
        AvailableCredit,
        CreditLimit, CurrentBalance, IsActive
      FROM MemberMaster
      WHERE IsActive = 1
        AND (${conditions.join(" OR ")})
    `;

    const result = await reqDb.query(query);
    if (result.recordset.length > 0) {
      return res.json({ success: true, member: result.recordset[0] });
    }
    return res.json({ success: false, member: null });
  } catch (err) {
    console.error("[Rewards] member by-id-or-phone error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rewards/members/check-phone?phone=
 * Check if a phone number is already registered (for duplicate prevention)
 */
router.get("/members/check-phone", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { phone, excludeId } = req.query;
    if (!phone || !phone.trim()) {
      return res.json({ exists: false });
    }
    const req2 = pool.request().input("Phone", sql.NVarChar(50), phone.trim());
    let query = `SELECT MemberId, Name FROM MemberMaster WHERE Phone = @Phone AND IsActive = 1`;
    if (excludeId) {
      req2.input("ExcludeId", sql.UniqueIdentifier, excludeId);
      query += ` AND MemberId <> @ExcludeId`;
    }
    const result = await req2.query(query);
    if (result.recordset.length > 0) {
      res.json({ exists: true, member: result.recordset[0] });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    console.error("[Rewards] check-phone error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// REWARD HISTORY & BALANCE
// ─────────────────────────────────────────────

/**
 * GET /api/rewards/history/:memberId
 * Get reward transaction history for a member
 */
router.get("/history/:memberId", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId } = req.params;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT TOP 50
          rpd.Id, rpd.BillNo, rpd.BillAmount, rpd.PointsEarned, rpd.PointsUsed,
          rpd.TransType, rpd.PayMode, rpd.Remarks, rpd.CreatedOn,
          mm.Name, mm.Phone
        FROM RewardPointDetails rpd
        INNER JOIN MemberMaster mm ON rpd.MemberId = mm.MemberId
        WHERE rpd.MemberId = @MemberId
        ORDER BY rpd.CreatedOn DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[Rewards] history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rewards/balance/:memberId
 * Get member's current reward wallet balance
 */
router.get("/balance/:memberId", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId } = req.params;
    const result = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT 
          MemberId, Name, Phone,
          ISNULL(RewardCredit, 0) AS RewardCredit,
          AvailableCredit,
          CreditLimit, CurrentBalance
        FROM MemberMaster
        WHERE MemberId = @MemberId
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }
    res.json(result.recordset[0]);
  } catch (err) {
    console.error("[Rewards] balance error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// REWARD POINTS CALCULATOR (util for frontend preview)
// ─────────────────────────────────────────────

/**
 * GET /api/rewards/calculate?amount=
 * Calculate reward credit for a given bill amount using active rule
 */
router.get("/calculate", async (req, res) => {
  try {
    const pool = await poolPromise;
    const amount = parseFloat(req.query.amount) || 0;
    const ruleRes = await pool.request().query(`
      SELECT TOP 1 SpendAmount, CreditAmount FROM RewardMaster WHERE IsActive = 1 ORDER BY Id DESC
    `);
    if (ruleRes.recordset.length === 0 || amount <= 0) {
      return res.json({ creditEarned: 0, rule: null });
    }
    const rule = ruleRes.recordset[0];
    const creditEarned = (amount / rule.SpendAmount) * rule.CreditAmount;
    res.json({
      creditEarned: Math.round(creditEarned * 10000) / 10000, // 4 decimal precision
      rule: { SpendAmount: rule.SpendAmount, CreditAmount: rule.CreditAmount }
    });
  } catch (err) {
    console.error("[Rewards] calculate error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// REWARD REDEMPTION
// ─────────────────────────────────────────────

/**
 * POST /api/rewards/redeem
 * Deduct the redeemed reward credit from MemberMaster and log to RewardPointDetails
 * Body: { memberId, amount, billNo, billAmount }
 */
router.post("/redeem", async (req, res) => {
  try {
    const pool = await poolPromise;
    const { memberId, amount, billNo, billAmount } = req.body;

    if (!memberId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: "memberId and a positive amount are required" });
    }

    const redeemAmount = parseFloat(amount);

    // Fetch current RewardCredit for the member
    const memberRes = await pool.request()
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        SELECT MemberId, Name, ISNULL(RewardCredit, 0) AS RewardCredit
        FROM MemberMaster
        WHERE MemberId = @MemberId
      `);

    if (memberRes.recordset.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }

    const currentCredit = parseFloat(memberRes.recordset[0].RewardCredit) || 0;
    const deductAmount = Math.min(redeemAmount, currentCredit); // Never go below 0
    const newCredit = Math.max(0, currentCredit - deductAmount);

    // Update RewardCredit in MemberMaster
    await pool.request()
      .input("NewCredit", sql.Decimal(18, 4), newCredit)
      .input("MemberId", sql.UniqueIdentifier, memberId)
      .query(`
        UPDATE MemberMaster
        SET RewardCredit = @NewCredit, ModifiedDate = GETDATE()
        WHERE MemberId = @MemberId
      `);

    // Log the redemption to RewardPointDetails (if table exists)
    try {
      await pool.request()
        .input("MemberId", sql.UniqueIdentifier, memberId)
        .input("BillNo", sql.NVarChar(100), billNo || null)
        .input("BillAmount", sql.Decimal(18, 4), parseFloat(billAmount) || 0)
        .input("PointsUsed", sql.Decimal(18, 4), deductAmount)
        .input("Remarks", sql.NVarChar(255), `Reward redeemed as discount on bill ${billNo || ""}`)
        .query(`
          INSERT INTO RewardPointDetails
            (MemberId, BillNo, BillAmount, PointsEarned, PointsUsed, TransType, Remarks, CreatedOn)
          VALUES
            (@MemberId, @BillNo, @BillAmount, 0, @PointsUsed, 'REDEEM', @Remarks, GETDATE())
        `);
    } catch (logErr) {
      // Non-fatal — just log, don't fail the whole request
      console.warn("[Rewards] Could not write to RewardPointDetails:", logErr.message);
    }

    res.json({
      success: true,
      memberId,
      redeemedAmount: deductAmount,
      previousCredit: currentCredit,
      newCredit,
    });
  } catch (err) {
    console.error("[Rewards] redeem error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
