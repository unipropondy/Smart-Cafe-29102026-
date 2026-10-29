const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");

// Require auth token for all config routes
router.use(authenticateToken);

// ================= GET ALL CONFIGURATIONS =================
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        r.RuleId,
        r.CampaignId,
        r.LoyaltyType,
        r.PurchaseDishId,
        pd.Name AS PurchaseDishName,
        r.PurchaseDishGroupId,
        dg.DishGroupName AS PurchaseDishGroupName,
        r.RewardDishId,
        rd.Name AS RewardDishName,
        r.RewardDishGroupId,
        rg.DishGroupName AS RewardDishGroupName,
        r.RequiredBills,
        r.IsActive,
        c.Name AS CampaignName,
        c.StartDate,
        c.EndDate,
        r.CreatedOn
      FROM LoyaltyRule r
      INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
      LEFT JOIN DishMaster pd ON r.PurchaseDishId = pd.DishId
      LEFT JOIN DishGroupMaster dg ON r.PurchaseDishGroupId = dg.DishGroupId
      LEFT JOIN DishMaster rd ON r.RewardDishId = rd.DishId
      LEFT JOIN DishGroupMaster rg ON r.RewardDishGroupId = rg.DishGroupId
      ORDER BY r.CreatedOn DESC
    `);
    res.json(result.recordset || []);
  } catch (err) {
    console.error("[LOYALTY CONFIG GET ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= SAVE / CREATE CONFIGURATION =================
router.post("/save", async (req, res) => {
  try {
    const { ruleId, campaignName, loyaltyType, purchaseDishId, purchaseDishGroupId, rewardDishId, rewardDishGroupId, requiredBills, isActive, startDate, endDate } = req.body;

    const type = loyaltyType || "Dish";

    if (!campaignName || !requiredBills) {
      return res.status(400).json({ error: "Missing required fields: campaignName, requiredBills" });
    }

    if (type === "Dish" && !purchaseDishId) {
      return res.status(400).json({ error: "Purchase dish is required for Dish loyalty." });
    }

    if (type === "DishGroup" && !purchaseDishGroupId) {
      return res.status(400).json({ error: "Purchase dish group is required for Dish Group loyalty." });
    }

    const billsCount = parseInt(requiredBills);
    if (isNaN(billsCount) || billsCount <= 0) {
      return res.status(400).json({ error: "Required bills count must be a positive integer greater than zero." });
    }

    const pool = await poolPromise;
    const ruleActiveState = isActive === undefined ? 1 : (isActive ? 1 : 0);

    // 1. Validation: Verify dishes / groups exist
    if (type === "Dish") {
      if (!purchaseDishId || !rewardDishId) {
        return res.status(400).json({ error: "Missing purchaseDishId or rewardDishId for Dish loyalty." });
      }
      const dishCheck = await pool.request()
        .input("PurchaseId", sql.UniqueIdentifier, purchaseDishId)
        .input("RewardId", sql.UniqueIdentifier, rewardDishId)
        .query(`
          SELECT DishId FROM DishMaster WHERE DishId IN (@PurchaseId, @RewardId)
        `);
      
      if (dishCheck.recordset.length < (purchaseDishId === rewardDishId ? 1 : 2)) {
        return res.status(400).json({ error: "One or both selected dishes do not exist in DishMaster." });
      }
    } else {
      if (!purchaseDishGroupId || !rewardDishGroupId) {
        return res.status(400).json({ error: "Missing purchaseDishGroupId or rewardDishGroupId for Dish Group loyalty." });
      }
      const groupCheck = await pool.request()
        .input("PurchaseGroupId", sql.UniqueIdentifier, purchaseDishGroupId)
        .input("RewardGroupId", sql.UniqueIdentifier, rewardDishGroupId)
        .query(`
          SELECT DishGroupId FROM DishGroupMaster WHERE DishGroupId IN (@PurchaseGroupId, @RewardGroupId)
        `);
      
      if (groupCheck.recordset.length < (purchaseDishGroupId === rewardDishGroupId ? 1 : 2)) {
        return res.status(400).json({ error: "One or both selected dish groups do not exist." });
      }
    }

    // 2. Validation: Prevent duplicate active rules for same target
    if (ruleActiveState === 1) {
      const dupQuery = pool.request();
      let dupSql = "";
      
      if (type === "Dish") {
        dupQuery.input("PurchaseId", sql.UniqueIdentifier, purchaseDishId);
        dupSql = `
          SELECT RuleId FROM LoyaltyRule 
          WHERE PurchaseDishId = @PurchaseId AND LoyaltyType = 'Dish' AND IsActive = 1
        `;
      } else {
        dupQuery.input("GroupId", sql.UniqueIdentifier, purchaseDishGroupId);
        dupSql = `
          SELECT RuleId FROM LoyaltyRule 
          WHERE PurchaseDishGroupId = @GroupId AND LoyaltyType = 'DishGroup' AND IsActive = 1
        `;
      }

      if (ruleId) {
        dupQuery.input("RuleId", sql.UniqueIdentifier, ruleId);
        dupSql += " AND RuleId <> @RuleId";
      }

      const dupRes = await dupQuery.query(dupSql);
      if (dupRes.recordset.length > 0) {
        return res.status(400).json({ error: `An active loyalty configuration already exists for this purchase ${type === "Dish" ? "dish" : "group"}.` });
      }
    }

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(new Date().setFullYear(new Date().getFullYear() + 10)); // Default 10 years out

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      if (ruleId) {
        // --- UPDATE ---
        const existingRule = await transaction.request()
          .input("RuleId", sql.UniqueIdentifier, ruleId)
          .query("SELECT CampaignId FROM LoyaltyRule WHERE RuleId = @RuleId");

        if (existingRule.recordset.length === 0) {
          throw new Error("Loyalty configuration not found.");
        }

        const campaignId = existingRule.recordset[0].CampaignId;

        // Update Campaign
        await transaction.request()
          .input("CampaignId", sql.UniqueIdentifier, campaignId)
          .input("Name", sql.NVarChar(100), campaignName.trim())
          .input("StartDate", sql.DateTime, start)
          .input("EndDate", sql.DateTime, end)
          .query(`
            UPDATE LoyaltyCampaign 
            SET Name = @Name, StartDate = @StartDate, EndDate = @EndDate
            WHERE CampaignId = @CampaignId
          `);

        // Update Rule
        await transaction.request()
          .input("RuleId", sql.UniqueIdentifier, ruleId)
          .input("LoyaltyType", sql.NVarChar(50), type)
          .input("PurchaseDishId", sql.UniqueIdentifier, type === "Dish" ? purchaseDishId : null)
          .input("PurchaseDishGroupId", sql.UniqueIdentifier, type === "DishGroup" ? purchaseDishGroupId : null)
          .input("RewardDishId", sql.UniqueIdentifier, type === "Dish" ? rewardDishId : null)
          .input("RewardDishGroupId", sql.UniqueIdentifier, type === "DishGroup" ? rewardDishGroupId : null)
          .input("RequiredBills", sql.Int, billsCount)
          .input("IsActive", sql.Bit, ruleActiveState)
          .query(`
            UPDATE LoyaltyRule
            SET LoyaltyType = @LoyaltyType,
                PurchaseDishId = @PurchaseDishId,
                PurchaseDishGroupId = @PurchaseDishGroupId,
                RewardDishId = @RewardDishId,
                RewardDishGroupId = @RewardDishGroupId,
                RequiredBills = @RequiredBills,
                IsActive = @IsActive
            WHERE RuleId = @RuleId
          `);
      } else {
        // --- INSERT ---
        const insertCampaignRes = await transaction.request()
          .input("Name", sql.NVarChar(100), campaignName.trim())
          .input("StartDate", sql.DateTime, start)
          .input("EndDate", sql.DateTime, end)
          .query(`
            DECLARE @campId UNIQUEIDENTIFIER = NEWID();
            INSERT INTO LoyaltyCampaign (CampaignId, Name, StartDate, EndDate, IsActive)
            VALUES (@campId, @Name, @StartDate, @EndDate, 1);
            SELECT @campId AS CampaignId;
          `);
        
        const campaignId = insertCampaignRes.recordset[0].CampaignId;

        await transaction.request()
          .input("CampaignId", sql.UniqueIdentifier, campaignId)
          .input("LoyaltyType", sql.NVarChar(50), type)
          .input("PurchaseDishId", sql.UniqueIdentifier, type === "Dish" ? purchaseDishId : null)
          .input("PurchaseDishGroupId", sql.UniqueIdentifier, type === "DishGroup" ? purchaseDishGroupId : null)
          .input("RewardDishId", sql.UniqueIdentifier, type === "Dish" ? rewardDishId : null)
          .input("RewardDishGroupId", sql.UniqueIdentifier, type === "DishGroup" ? rewardDishGroupId : null)
          .input("RequiredBills", sql.Int, billsCount)
          .input("IsActive", sql.Bit, ruleActiveState)
          .query(`
            INSERT INTO LoyaltyRule (RuleId, CampaignId, LoyaltyType, PurchaseDishId, PurchaseDishGroupId, RewardDishId, RewardDishGroupId, RequiredBills, IsActive)
            VALUES (NEWID(), @CampaignId, @LoyaltyType, @PurchaseDishId, @PurchaseDishGroupId, @RewardDishId, @RewardDishGroupId, @RequiredBills, @IsActive)
          `);
      }

      await transaction.commit();
      res.json({ success: true, message: "Loyalty configuration saved successfully." });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("[LOYALTY CONFIG SAVE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= TOGGLE ACTIVE STATUS =================
router.patch("/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body; // boolean

    if (isActive === undefined) {
      return res.status(400).json({ error: "Missing required field: isActive" });
    }

    const pool = await poolPromise;
    const targetState = isActive ? 1 : 0;

    // If activating, verify no duplicates
    if (targetState === 1) {
      const currentRule = await pool.request()
        .input("RuleId", sql.UniqueIdentifier, id)
        .query("SELECT LoyaltyType, PurchaseDishId, PurchaseDishGroupId FROM LoyaltyRule WHERE RuleId = @RuleId");
      
      if (currentRule.recordset.length === 0) {
        return res.status(404).json({ error: "Loyalty configuration not found." });
      }

      const { LoyaltyType, PurchaseDishId, PurchaseDishGroupId } = currentRule.recordset[0];
      const type = LoyaltyType || "Dish";

      const dupQuery = pool.request().input("RuleId", sql.UniqueIdentifier, id);
      let dupSql = "";

      if (type === "Dish") {
        dupQuery.input("PurchaseId", sql.UniqueIdentifier, PurchaseDishId);
        dupSql = `
          SELECT RuleId FROM LoyaltyRule 
          WHERE PurchaseDishId = @PurchaseId AND LoyaltyType = 'Dish' AND IsActive = 1 AND RuleId <> @RuleId
        `;
      } else {
        dupQuery.input("GroupId", sql.UniqueIdentifier, PurchaseDishGroupId);
        dupSql = `
          SELECT RuleId FROM LoyaltyRule 
          WHERE PurchaseDishGroupId = @GroupId AND LoyaltyType = 'DishGroup' AND IsActive = 1 AND RuleId <> @RuleId
        `;
      }

      const dupCheck = await dupQuery.query(dupSql);
      
      if (dupCheck.recordset.length > 0) {
        return res.status(400).json({ error: `An active loyalty configuration already exists for this purchase ${type === "Dish" ? "dish" : "group"}.` });
      }
    }

    await pool.request()
      .input("RuleId", sql.UniqueIdentifier, id)
      .input("IsActive", sql.Bit, targetState)
      .query("UPDATE LoyaltyRule SET IsActive = @IsActive WHERE RuleId = @RuleId");

    res.json({ success: true, message: `Loyalty configuration successfully ${targetState === 1 ? "activated" : "deactivated"}.` });
  } catch (err) {
    console.error("[LOYALTY CONFIG TOGGLE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= DELETE CONFIGURATION =================
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;

    // Fetch existing CampaignId to clean up both tables
    const existingRule = await pool.request()
      .input("RuleId", sql.UniqueIdentifier, id)
      .query("SELECT CampaignId FROM LoyaltyRule WHERE RuleId = @RuleId");

    if (existingRule.recordset.length === 0) {
      return res.status(404).json({ error: "Loyalty configuration not found." });
    }

    const campaignId = existingRule.recordset[0].CampaignId;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 1. Delete rule first (foreign key dependency)
      await transaction.request()
        .input("RuleId", sql.UniqueIdentifier, id)
        .query("DELETE FROM LoyaltyRule WHERE RuleId = @RuleId");

      // 2. Delete campaign
      await transaction.request()
        .input("CampaignId", sql.UniqueIdentifier, campaignId)
        .query("DELETE FROM LoyaltyCampaign WHERE CampaignId = @CampaignId");

      await transaction.commit();
      res.json({ success: true, message: "Loyalty configuration deleted successfully." });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("[LOYALTY CONFIG DELETE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
