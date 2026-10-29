const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
router.use((req, res, next) => {
  // Allow customer public QR calls (GET status, customer orders, dish progress) to bypass POS staff auth
  const isCustomerEndpoint = req.path.startsWith("/status/") || req.path.startsWith("/customer/");
  if (isCustomerEndpoint && req.method === "GET") {
    return next();
  }
  return authenticateToken(req, res, next);
});
const sql = require("mssql");
const { poolPromise } = require("../config/db");

// GET /api/loyalty/search?q=query
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    const pool = await poolPromise;
    if (!q || q.trim() === "") {
      const result = await pool.request()
        .query(`
          SELECT 
            cust.Phone, 
            cust.Name, 
            ISNULL(s.CurrentCount, 0) AS VisitCount, 
            cust.TotalVisits, 
            cust.RewardPending 
          FROM LoyaltyCustomer cust
          OUTER APPLY (
            SELECT TOP 1 state.CurrentCount 
            FROM CustomerDishLoyaltyState state
            INNER JOIN LoyaltyRule r ON state.RuleId = r.RuleId
            INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
            WHERE state.CustomerId = cust.LoyaltyCustomerId
              AND r.IsActive = 1 AND c.IsActive = 1
              AND GETDATE() BETWEEN c.StartDate AND c.EndDate
          ) s
          ORDER BY cust.LastVisitDate DESC, cust.Name ASC
        `);
      return res.json(result.recordset);
    }
    const result = await pool.request()
      .input("Query", sql.NVarChar(50), `%${q.trim()}%`)
      .query(`
        SELECT 
          cust.Phone, 
          cust.Name, 
          ISNULL(s.CurrentCount, 0) AS VisitCount, 
          cust.TotalVisits, 
          cust.RewardPending 
        FROM LoyaltyCustomer cust
        OUTER APPLY (
          SELECT TOP 1 state.CurrentCount 
          FROM CustomerDishLoyaltyState state
          INNER JOIN LoyaltyRule r ON state.RuleId = r.RuleId
          INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
          WHERE state.CustomerId = cust.LoyaltyCustomerId
            AND r.IsActive = 1 AND c.IsActive = 1
            AND GETDATE() BETWEEN c.StartDate AND c.EndDate
        ) s
        WHERE cust.Phone LIKE @Query OR cust.Name LIKE @Query
        ORDER BY cust.LastVisitDate DESC, cust.Name ASC
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[LOYALTY SEARCH ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loyalty/status/:phone
router.get("/status/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    if (!phone || phone.trim() === "") {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const pool = await poolPromise;
    const cleanPhone = phone.trim();
    const result = await pool.request()
      .input("Phone", sql.NVarChar(50), cleanPhone)
      .query(`
        SELECT 
          cust.LoyaltyCustomerId, 
          cust.Phone, 
          cust.Name, 
          ISNULL(s.CurrentCount, 0) AS VisitCount, 
          cust.TotalVisits, 
          cust.RewardsEarned, 
          cust.RewardsRedeemed, 
          cust.RewardPending 
        FROM LoyaltyCustomer cust
        OUTER APPLY (
          SELECT TOP 1 state.CurrentCount 
          FROM CustomerDishLoyaltyState state
          INNER JOIN LoyaltyRule r ON state.RuleId = r.RuleId
          INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
          WHERE state.CustomerId = cust.LoyaltyCustomerId
            AND r.IsActive = 1 AND c.IsActive = 1
            AND GETDATE() BETWEEN c.StartDate AND c.EndDate
        ) s
        WHERE cust.Phone = @Phone
           OR REPLACE(REPLACE(cust.Phone, ' ', ''), '-', '') = REPLACE(REPLACE(@Phone, ' ', ''), '-', '')
           OR (LEN(REPLACE(REPLACE(@Phone, ' ', ''), '-', '')) >= 8 AND cust.Phone LIKE '%' + REPLACE(REPLACE(@Phone, ' ', ''), '-', ''))
           OR (LEN(REPLACE(REPLACE(@Phone, ' ', ''), '-', '')) >= 8 AND REPLACE(REPLACE(@Phone, ' ', ''), '-', '') LIKE '%' + REPLACE(REPLACE(cust.Phone, ' ', ''), '-', ''))
      `);

    if (result.recordset.length > 0) {
      return res.json({ success: true, exists: true, customer: result.recordset[0] });
    } else {
      // Check if this phone belongs to a registered Member in MemberMaster
      let memberName = "";
      try {
        const memRes = await pool.request()
          .input("Phone", sql.NVarChar(50), cleanPhone)
          .query(`
            SELECT TOP 1 Name 
            FROM MemberMaster 
            WHERE IsActive = 1 AND (
              Phone = @Phone 
              OR REPLACE(REPLACE(Phone, ' ', ''), '-', '') = REPLACE(REPLACE(@Phone, ' ', ''), '-', '')
              OR (LEN(REPLACE(REPLACE(@Phone, ' ', ''), '-', '')) >= 8 AND Phone LIKE '%' + REPLACE(REPLACE(@Phone, ' ', ''), '-', ''))
              OR (LEN(REPLACE(REPLACE(@Phone, ' ', ''), '-', '')) >= 8 AND REPLACE(REPLACE(@Phone, ' ', ''), '-', '') LIKE '%' + REPLACE(REPLACE(Phone, ' ', ''), '-', ''))
            )
          `);
        if (memRes.recordset.length > 0 && memRes.recordset[0].Name) {
          memberName = memRes.recordset[0].Name;
        }
      } catch (_) {}

      // Return a virtual new guest customer with memberName if found
      return res.json({
        success: true,
        exists: false,
        customer: {
          LoyaltyCustomerId: null,
          Phone: cleanPhone,
          Name: memberName || "",
          VisitCount: 0,
          TotalVisits: 0,
          RewardsEarned: 0,
          RewardsRedeemed: 0,
          RewardPending: 0,
          isNew: true
        }
      });
    }
  } catch (err) {
    console.error("[LOYALTY STATUS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loyalty/customer/:phone/dish-progress
router.get("/customer/:phone/dish-progress", async (req, res) => {
  try {
    const { phone } = req.params;
    if (!phone || phone.trim() === "") {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("Phone", sql.NVarChar(50), phone.trim())
      .query(`
        SELECT 
          r.RuleId,
          r.LoyaltyType,
          r.RequiredBills,
          ISNULL(pd.Name, dg.DishGroupName) AS PurchaseDishName,
          ISNULL(rd.Name, dgReward.DishGroupName) AS RewardDishName,
          ISNULL(s.CurrentCount, 0) AS CurrentCount,
          ISNULL(s.RewardsAvailable, 0) AS RewardsAvailable,
          ISNULL(s.RewardCyclesCompleted, 0) AS RewardCyclesCompleted,
          r.IsActive AS RuleActive,
          c.Name AS CampaignName
        FROM LoyaltyRule r
        INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
        LEFT JOIN DishMaster pd ON r.PurchaseDishId = pd.DishId
        LEFT JOIN DishGroupMaster dg ON r.PurchaseDishGroupId = dg.DishGroupId
        LEFT JOIN DishMaster rd ON r.RewardDishId = rd.DishId
        LEFT JOIN DishGroupMaster dgReward ON r.RewardDishGroupId = dgReward.DishGroupId
        LEFT JOIN LoyaltyCustomer cust ON cust.Phone = @Phone
        LEFT JOIN CustomerDishLoyaltyState s ON s.RuleId = r.RuleId AND s.CustomerId = cust.LoyaltyCustomerId
        WHERE 
          (r.IsActive = 1 AND c.IsActive = 1 AND GETDATE() BETWEEN c.StartDate AND c.EndDate)
          OR (s.CustomerId IS NOT NULL AND (s.CurrentCount > 0 OR s.RewardsAvailable > 0))
      `);

    res.json(result.recordset || []);
  } catch (err) {
    console.error("[LOYALTY DISH PROGRESS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loyalty/calculate-bill-rewards
router.post("/calculate-bill-rewards", async (req, res) => {
  try {
    const { phone, items } = req.body;
    if (!phone || !Array.isArray(items)) {
      return res.status(400).json({ error: "Missing required fields (phone, items)" });
    }

    const pool = await poolPromise;
    const cleanPhone = phone.trim();

    // 1. Get customer
    const custRes = await pool.request()
      .input("Phone", sql.NVarChar(50), cleanPhone)
      .query("SELECT LoyaltyCustomerId FROM LoyaltyCustomer WHERE Phone = @Phone");

    if (custRes.recordset.length === 0) {
      return res.json({ success: true, items: items, appliedRewards: [], totalDiscount: 0 });
    }

    const customerId = custRes.recordset[0].LoyaltyCustomerId;

    // 2. Fetch active rules
    const rulesRes = await pool.request().query(`
      SELECT r.RuleId, r.LoyaltyType, r.PurchaseDishId, r.PurchaseDishGroupId, r.RewardDishId, r.RewardDishGroupId, r.RequiredBills,
             d.Name AS RewardDishName, d.currentcost AS RewardDishPrice
      FROM LoyaltyRule r
      INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
      LEFT JOIN DishMaster d ON r.RewardDishId = d.DishId
      WHERE r.IsActive = 1 AND c.IsActive = 1
        AND GETDATE() BETWEEN c.StartDate AND c.EndDate
    `);

    const activeRules = rulesRes.recordset || [];
    if (activeRules.length === 0) {
      return res.json({ success: true, items: items, appliedRewards: [], totalDiscount: 0 });
    }

    // 3. Fetch customer loyalty state for active rules
    const stateRes = await pool.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .query(`
        SELECT RuleId, CurrentCount, RewardsAvailable FROM CustomerDishLoyaltyState
        WHERE CustomerId = @CustomerId
      `);

    const userStates = stateRes.recordset || [];
    const ruleCurrentCountMap = {}; // ruleId -> CurrentCount (carried forward balance)
    const ruleRewardsAvailableMap = {}; // ruleId -> RewardsAvailable
    userStates.forEach(s => {
      ruleCurrentCountMap[s.RuleId] = s.CurrentCount || 0;
      ruleRewardsAvailableMap[s.RuleId] = s.RewardsAvailable || 0;
    });

    const updatedItems = items.map(item => ({ ...item }));
    const appliedRewards = [];
    let totalDiscount = 0;

    // A. Resolve DishGroupIds for all items in the cart
    const itemGroupIdMap = {}; // dishId (lowercase string) -> DishGroupId (lowercase string or null)
    const missingDishIds = [];
    for (const item of updatedItems) {
      const dishId = String(item.DishId || item.dishId || item.id || "");
      if (!dishId) continue;
      const key = dishId.toLowerCase();
      
      const providedGroupId = item.DishGroupId || item.dishGroupId || item.groupId;
      if (providedGroupId) {
        itemGroupIdMap[key] = String(providedGroupId).toLowerCase();
      } else {
        missingDishIds.push(dishId);
      }
    }

    if (missingDishIds.length > 0) {
      const uniqueMissingIds = [...new Set(missingDishIds)];
      const dishDetailsQuery = pool.request();
      const paramNames = uniqueMissingIds.map((id, index) => {
        const paramName = `dishId_${index}`;
        dishDetailsQuery.input(paramName, sql.UniqueIdentifier, id);
        return `@${paramName}`;
      });

      if (paramNames.length > 0) {
        const dishDetailsRes = await dishDetailsQuery.query(`
          SELECT DishId, DishGroupId FROM DishMaster 
          WHERE DishId IN (${paramNames.join(",")})
        `);
        
        (dishDetailsRes.recordset || []).forEach(row => {
          if (row.DishId && row.DishGroupId) {
            itemGroupIdMap[String(row.DishId).toLowerCase()] = String(row.DishGroupId).toLowerCase();
          }
        });
      }
    }

    // Evaluate each active rule
    for (const rule of activeRules) {
      const loyaltyType = rule.LoyaltyType || "Dish";
      const purchaseDishIdLower = rule.PurchaseDishId ? String(rule.PurchaseDishId).toLowerCase() : null;
      const purchaseGroupIdLower = rule.PurchaseDishGroupId ? String(rule.PurchaseDishGroupId).toLowerCase() : null;
      const rewardDishIdLower = String(rule.RewardDishId || "").toLowerCase();
      
      // Calculate total quantity of this dish/group being purchased in this transaction
      let purchaseQty = 0;
      for (const item of updatedItems) {
        const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
        if (item.isDishReward) continue;

        if (loyaltyType === "DishGroup" && purchaseGroupIdLower) {
          const resolvedGroupId = itemGroupIdMap[itemDishIdLower];
          if (resolvedGroupId === purchaseGroupIdLower) {
            purchaseQty += (item.Qty || 1);
          }
        } else if (loyaltyType === "Dish" && purchaseDishIdLower) {
          if (itemDishIdLower === purchaseDishIdLower) {
            purchaseQty += (item.Qty || 1);
          }
        }
      }

      // Check how many of the reward dish/group items are present in the cart
      let availableRewardDishQty = 0;
      for (const item of updatedItems) {
        const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
        if (item.isDishReward) continue;

        if (loyaltyType === "DishGroup" && rule.RewardDishGroupId) {
          const resolvedGroupId = itemGroupIdMap[itemDishIdLower];
          if (resolvedGroupId === String(rule.RewardDishGroupId).toLowerCase()) {
            availableRewardDishQty += (item.Qty || 1);
          }
        } else if (loyaltyType === "Dish" && rule.RewardDishId) {
          if (itemDishIdLower === String(rule.RewardDishId).toLowerCase()) {
            availableRewardDishQty += (item.Qty || 1);
          }
        }
      }

      // 1. Stored rewards from previous visits
      const storedRewards = ruleRewardsAvailableMap[rule.RuleId] || 0;

      // 2. New rewards earned in this transaction
      const currentBalance = ruleCurrentCountMap[rule.RuleId] || 0;
      const totalAccumulated = currentBalance + purchaseQty;
      const blockSize = (rule.RequiredBills || 9) + 1;
      const newRewardsEarned = Math.floor(totalAccumulated / blockSize);

      const totalRewardsToApply = storedRewards + newRewardsEarned;
      if (totalRewardsToApply <= 0) continue;

      // The free reward should not reduce the bill unless the reward item is in the cart
      const rewardsForThisBill = Math.min(totalRewardsToApply, availableRewardDishQty);
      if (rewardsForThisBill <= 0) continue;

      let rewardsApplied = 0;
      if (loyaltyType === "DishGroup" && rule.RewardDishGroupId) {
        // Traverse the cart in reverse order (last added first) to select eligible items from the group
        const originalLength = updatedItems.length;
        for (let i = originalLength - 1; i >= 0; i--) {
          if (rewardsApplied >= rewardsForThisBill) break;
          const item = updatedItems[i];
          const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
          const resolvedGroupId = itemGroupIdMap[itemDishIdLower];
          if (resolvedGroupId === String(rule.RewardDishGroupId).toLowerCase() && !item.isDishReward) {
            const qtyToFree = Math.min(item.Qty || 1, rewardsForThisBill - rewardsApplied);
            if (qtyToFree > 0) {
              const originalPrice = parseFloat(item.Price || item.price || 0);
              const crypto = require("crypto");
              
              if (item.Qty > qtyToFree) {
                // Split line item
                item.Qty = item.Qty - qtyToFree;
                if (item.qty !== undefined) item.qty = item.Qty;

                updatedItems.push({
                  ...item,
                  lineItemId: crypto.randomUUID(),
                  Qty: qtyToFree,
                  qty: qtyToFree,
                  Price: 0,
                  price: 0,
                  originalPrice: originalPrice,
                  isDishReward: true,
                  rewardRuleId: rule.RuleId,
                  rewardDishId: item.DishId || item.dishId || item.id
                });
              } else {
                item.originalPrice = originalPrice;
                item.Price = 0;
                item.price = 0;
                item.isDishReward = true;
                item.rewardRuleId = rule.RuleId;
                item.rewardDishId = item.DishId || item.dishId || item.id;
              }

              rewardsApplied += qtyToFree;
              totalDiscount += originalPrice * qtyToFree;
              appliedRewards.push({
                ruleId: rule.RuleId,
                campaignName: rule.CampaignName,
                rewardDishId: item.DishId || item.dishId || item.id,
                qty: qtyToFree
              });
            }
          }
        }
      } else {
        // Dish loyalty: auto-apply reward to matches using original forward traverse order
        for (let i = 0; i < updatedItems.length; i++) {
          if (rewardsApplied >= rewardsForThisBill) break;
          const item = updatedItems[i];
          if (String(item.DishId || item.dishId || item.id).toLowerCase() === rewardDishIdLower && !item.isDishReward) {
            const qtyToFree = Math.min(item.Qty || 1, rewardsForThisBill - rewardsApplied);
            if (qtyToFree > 0) {
              const originalPrice = parseFloat(item.Price || item.price || 0);
              const crypto = require("crypto");
              
              if (item.Qty > qtyToFree) {
                // Split line item
                item.Qty = item.Qty - qtyToFree;
                if (item.qty !== undefined) item.qty = item.Qty;

                updatedItems.push({
                  ...item,
                  lineItemId: crypto.randomUUID(),
                  Qty: qtyToFree,
                  qty: qtyToFree,
                  Price: 0,
                  price: 0,
                  originalPrice: originalPrice,
                  isDishReward: true,
                  rewardRuleId: rule.RuleId,
                  rewardDishId: rule.RewardDishId
                });
              } else {
                item.originalPrice = originalPrice;
                item.Price = 0;
                item.price = 0;
                item.isDishReward = true;
                item.rewardRuleId = rule.RuleId;
                item.rewardDishId = rule.RewardDishId;
              }

              rewardsApplied += qtyToFree;
              totalDiscount += originalPrice * qtyToFree;
              appliedRewards.push({
                ruleId: rule.RuleId,
                campaignName: rule.CampaignName,
                rewardDishId: rule.RewardDishId,
                qty: qtyToFree
              });
            }
          }
        }
      }
    }

    res.json({
      success: true,
      items: updatedItems,
      appliedRewards,
      totalDiscount
    });
  } catch (err) {
    console.error("[LOYALTY CALCULATE REWARDS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loyalty/log-visit
router.post("/log-visit", async (req, res) => {
  try {
    const { phone, name, settlementId, billNo, items } = req.body;

    if (!phone || !settlementId || !billNo) {
      return res.status(400).json({ error: "Missing required fields (phone, settlementId, billNo)" });
    }

    const pool = await poolPromise;
    const cleanPhone = phone.trim();
    const cleanBillNo = billNo.trim();

    // 1. Idempotency Check
    const dupCheck = await pool.request()
      .input("SettlementId", sql.UniqueIdentifier, settlementId)
      .query("SELECT LoyaltyVisitId FROM LoyaltyVisit WHERE SettlementId = @SettlementId");

    if (dupCheck.recordset.length > 0) {
      return res.json({ success: true, message: "Visit already logged for this settlement", duplicate: true });
    }

    // 2. Split Bill Check: Deduplicate by Base Bill No
    const baseBillNo = cleanBillNo.split("-S")[0];
    const splitCheck = await pool.request()
      .input("BaseBillNo", sql.NVarChar(50), baseBillNo)
      .query("SELECT LoyaltyVisitId FROM LoyaltyVisit WHERE BillNo LIKE @BaseBillNo + '%'");

    const isSplitDuplicate = splitCheck.recordset.length > 0;

    // Use a transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // 4. Fetch all active loyalty rules
      const activeRulesRes = await transaction.request().query(`
        SELECT r.RuleId, r.LoyaltyType, r.PurchaseDishId, r.PurchaseDishGroupId, r.RewardDishId, r.RequiredBills
        FROM LoyaltyRule r
        INNER JOIN LoyaltyCampaign c ON r.CampaignId = c.CampaignId
        WHERE r.IsActive = 1 AND c.IsActive = 1
          AND GETDATE() BETWEEN c.StartDate AND c.EndDate
      `);
      const activeRules = activeRulesRes.recordset || [];

      const itemsList = items || [];

      // Resolve DishGroupIds for all items in the cart (Performance Optimized)
      const itemGroupIdMap = {}; // dishId (lowercase string) -> DishGroupId (lowercase string or null)
      const missingDishIds = [];
      for (const item of itemsList) {
        const dishId = String(item.DishId || item.dishId || item.id || "");
        if (!dishId) continue;
        const key = dishId.toLowerCase();
        
        const providedGroupId = item.DishGroupId || item.dishGroupId || item.groupId;
        if (providedGroupId) {
          itemGroupIdMap[key] = String(providedGroupId).toLowerCase();
        } else {
          missingDishIds.push(dishId);
        }
      }

      if (missingDishIds.length > 0) {
        const uniqueMissingIds = [...new Set(missingDishIds)];
        const dishDetailsQuery = transaction.request();
        const paramNames = uniqueMissingIds.map((id, index) => {
          const paramName = `dishId_${index}`;
          dishDetailsQuery.input(paramName, sql.UniqueIdentifier, id);
          return `@${paramName}`;
        });

        if (paramNames.length > 0) {
          const dishDetailsRes = await dishDetailsQuery.query(`
            SELECT DishId, DishGroupId FROM DishMaster 
            WHERE DishId IN (${paramNames.join(",")})
          `);
          
          (dishDetailsRes.recordset || []).forEach(row => {
            if (row.DishId && row.DishGroupId) {
              itemGroupIdMap[String(row.DishId).toLowerCase()] = String(row.DishGroupId).toLowerCase();
            }
          });
        }
      }

      const hasLoyaltyDishOrdered = Array.isArray(itemsList) && activeRules.length > 0 && itemsList.some(item => {
        const isReward = item.isDishReward === true || item.isDishReward === 1 || String(item.isDishReward).toLowerCase() === 'true';
        if (isReward) return false;
        const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
        return activeRules.some(rule => {
          const loyaltyType = rule.LoyaltyType || "Dish";
          if (loyaltyType === "DishGroup" && rule.PurchaseDishGroupId) {
            return itemGroupIdMap[itemDishIdLower] === String(rule.PurchaseDishGroupId).toLowerCase();
          } else if (loyaltyType === "Dish" && rule.PurchaseDishId) {
            return String(rule.PurchaseDishId).toLowerCase() === itemDishIdLower;
          }
          return false;
        });
      });

      const hasRewardClaimed = Array.isArray(itemsList) && itemsList.some(item => {
        const isReward = item.isDishReward === true || item.isDishReward === 1 || String(item.isDishReward).toLowerCase() === 'true';
        return isReward;
      });

      // 3. Upsert LoyaltyCustomer (Global Visits)
      let customerId;
      const custRes = await transaction.request()
        .input("Phone", sql.NVarChar(50), cleanPhone)
        .query("SELECT LoyaltyCustomerId, VisitCount, TotalVisits, RewardPending FROM LoyaltyCustomer WITH (UPDLOCK) WHERE Phone = @Phone");

      if (custRes.recordset.length === 0) {
        let initialVisitCount = 0;
        const primaryRule = activeRules[0];
        if (!isSplitDuplicate && primaryRule) {
          const primaryLoyaltyType = primaryRule.LoyaltyType || "Dish";
          const primaryPurchaseDishIdLower = primaryRule.PurchaseDishId ? String(primaryRule.PurchaseDishId).toLowerCase() : null;
          const primaryPurchaseGroupIdLower = primaryRule.PurchaseDishGroupId ? String(primaryRule.PurchaseDishGroupId).toLowerCase() : null;

          let transactionQty = 0;
          for (const item of itemsList) {
            const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
            if (item.isDishReward) continue;

            if (primaryLoyaltyType === "DishGroup" && primaryPurchaseGroupIdLower) {
              if (itemGroupIdMap[itemDishIdLower] === primaryPurchaseGroupIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            } else if (primaryLoyaltyType === "Dish" && primaryPurchaseDishIdLower) {
              if (itemDishIdLower === primaryPurchaseDishIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            }
          }
          const blockSize = (primaryRule.RequiredBills || 9) + 1;
          initialVisitCount = transactionQty % blockSize;
        } else if (!isSplitDuplicate && hasLoyaltyDishOrdered) {
          initialVisitCount = 1;
        }

        const initialTotalVisits = isSplitDuplicate ? 0 : 1;
        const insertCustRes = await transaction.request()
          .input("Phone", sql.NVarChar(50), cleanPhone)
          .input("Name", sql.NVarChar(255), name ? name.trim() : null)
          .input("VisitCount", sql.Int, initialVisitCount)
          .input("TotalVisits", sql.Int, initialTotalVisits)
          .query(`
            DECLARE @newCustId UNIQUEIDENTIFIER = NEWID();
            INSERT INTO LoyaltyCustomer (LoyaltyCustomerId, Phone, Name, VisitCount, TotalVisits, LastVisitDate)
            VALUES (@newCustId, @Phone, @Name, @VisitCount, @TotalVisits, GETDATE());
            SELECT @newCustId AS LoyaltyCustomerId;
          `);
        customerId = insertCustRes.recordset[0].LoyaltyCustomerId;
      } else {
        const cust = custRes.recordset[0];
        customerId = cust.LoyaltyCustomerId;

        // Fetch current states to calculate global visit count (carried forward balance of the main rule)
        const primaryRule = activeRules[0];
        let newVisitCount = cust.VisitCount;

        if (!isSplitDuplicate && primaryRule) {
          const stateRes = await transaction.request()
            .input("CustomerId", sql.UniqueIdentifier, customerId)
            .input("RuleId", sql.UniqueIdentifier, primaryRule.RuleId)
            .query(`
              SELECT CurrentCount FROM CustomerDishLoyaltyState WITH (UPDLOCK)
              WHERE CustomerId = @CustomerId AND RuleId = @RuleId
            `);
          
          let currentBalance = 0;
          if (stateRes.recordset.length > 0) {
            currentBalance = stateRes.recordset[0].CurrentCount || 0;
          }

          const primaryLoyaltyType = primaryRule.LoyaltyType || "Dish";
          const primaryPurchaseDishIdLower = primaryRule.PurchaseDishId ? String(primaryRule.PurchaseDishId).toLowerCase() : null;
          const primaryPurchaseGroupIdLower = primaryRule.PurchaseDishGroupId ? String(primaryRule.PurchaseDishGroupId).toLowerCase() : null;

          let transactionQty = 0;
          for (const item of itemsList) {
            const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
            if (item.isDishReward) continue;

            if (primaryLoyaltyType === "DishGroup" && primaryPurchaseGroupIdLower) {
              if (itemGroupIdMap[itemDishIdLower] === primaryPurchaseGroupIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            } else if (primaryLoyaltyType === "Dish" && primaryPurchaseDishIdLower) {
              if (itemDishIdLower === primaryPurchaseDishIdLower) {
                transactionQty += (item.Qty || item.qty || 1);
              }
            }
          }

          // Compute new balance
          const blockSize = (primaryRule.RequiredBills || 9) + 1;
          newVisitCount = (currentBalance + transactionQty) % blockSize;
        }

        if (!isSplitDuplicate) {
          let newTotalVisits = cust.TotalVisits + 1;
          let newRewardPending = 0; // We resolve rewards on the fly during payment, no need to hold pending flag

          await transaction.request()
            .input("LoyaltyCustomerId", sql.UniqueIdentifier, customerId)
            .input("Name", sql.NVarChar(255), name ? name.trim() : null)
            .input("VisitCount", sql.Int, newVisitCount)
            .input("TotalVisits", sql.Int, newTotalVisits)
            .input("RewardPending", sql.Bit, newRewardPending)
            .query(`
              UPDATE LoyaltyCustomer 
              SET VisitCount = @VisitCount,
                  TotalVisits = @TotalVisits,
                  RewardPending = @RewardPending,
                  LastVisitDate = GETDATE(),
                  Name = CASE WHEN Name IS NULL OR Name = '' THEN ISNULL(@Name, Name) ELSE Name END
              WHERE LoyaltyCustomerId = @LoyaltyCustomerId
            `);
        }
      }

      // 5. Process Dish-Specific Loyalty Progress & Redemptions
      if (Array.isArray(itemsList) && activeRules.length > 0) {
        const redeemedRewards = itemsList.filter(i => {
          const isReward = i.isDishReward === true || i.isDishReward === 1 || String(i.isDishReward).toLowerCase() === 'true';
          return isReward;
        });

        // A. Process Paid Items (Increments)
        for (const rule of activeRules) {
          const loyaltyType = rule.LoyaltyType || "Dish";
          const rulePurchaseIdLower = rule.PurchaseDishId ? String(rule.PurchaseDishId).toLowerCase() : null;
          const ruleGroupIdLower = rule.PurchaseDishGroupId ? String(rule.PurchaseDishGroupId).toLowerCase() : null;
          
          let purchaseQty = 0;
          for (const item of itemsList) {
            const itemDishIdLower = String(item.DishId || item.dishId || item.id || "").toLowerCase();
            if (item.isDishReward) continue;

            if (loyaltyType === "DishGroup" && ruleGroupIdLower) {
              if (itemGroupIdMap[itemDishIdLower] === ruleGroupIdLower) {
                purchaseQty += (item.Qty || item.qty || 1);
              }
            } else if (loyaltyType === "Dish" && rulePurchaseIdLower) {
              if (itemDishIdLower === rulePurchaseIdLower) {
                purchaseQty += (item.Qty || item.qty || 1);
              }
            }
          }

          if (purchaseQty > 0 && !isSplitDuplicate) {
            // Get current state
            const stateRes = await transaction.request()
              .input("CustomerId", sql.UniqueIdentifier, customerId)
              .input("RuleId", sql.UniqueIdentifier, rule.RuleId)
              .query(`
                SELECT CurrentCount, RewardsAvailable FROM CustomerDishLoyaltyState WITH (UPDLOCK)
                WHERE CustomerId = @CustomerId AND RuleId = @RuleId
              `);

            const blockSize = (rule.RequiredBills || 9) + 1;

            if (stateRes.recordset.length === 0) {
              const totalAccumulated = purchaseQty;
              const newRewards = Math.floor(totalAccumulated / blockSize);
              const finalCount = totalAccumulated % blockSize;

              await transaction.request()
                .input("CustomerId", sql.UniqueIdentifier, customerId)
                .input("RuleId", sql.UniqueIdentifier, rule.RuleId)
                .input("Count", sql.Int, finalCount)
                .input("NewRewards", sql.Int, newRewards)
                .query(`
                  INSERT INTO CustomerDishLoyaltyState (CustomerId, RuleId, CurrentCount, RewardsAvailable, RewardCyclesCompleted)
                  VALUES (@CustomerId, @RuleId, @Count, @NewRewards, 0)
                `);
            } else {
              const state = stateRes.recordset[0];
              const totalAccumulated = (state.CurrentCount || 0) + purchaseQty;
              const newRewards = Math.floor(totalAccumulated / blockSize);
              const finalCount = totalAccumulated % blockSize;

              await transaction.request()
                .input("CustomerId", sql.UniqueIdentifier, customerId)
                .input("RuleId", sql.UniqueIdentifier, rule.RuleId)
                .input("Count", sql.Int, finalCount)
                .input("NewRewards", sql.Int, newRewards)
                .query(`
                  UPDATE CustomerDishLoyaltyState
                  SET CurrentCount = @Count,
                      RewardsAvailable = RewardsAvailable + @NewRewards,
                      ModifiedOn = GETDATE()
                  WHERE CustomerId = @CustomerId AND RuleId = @RuleId
                `);
            }
          }
        }

        // B. Process Redemptions (Decrements / Cycle Counter)
        for (const redeemed of redeemedRewards) {
          const ruleId = redeemed.rewardRuleId || redeemed.RewardRuleId;
          const qty = redeemed.Qty || redeemed.qty || 1;

          if (ruleId) {
            await transaction.request()
              .input("CustomerId", sql.UniqueIdentifier, customerId)
              .input("RuleId", sql.UniqueIdentifier, ruleId)
              .input("Qty", sql.Int, qty)
              .query(`
                UPDATE CustomerDishLoyaltyState
                SET RewardCyclesCompleted = RewardCyclesCompleted + @Qty,
                    RewardsAvailable = CASE WHEN RewardsAvailable >= @Qty THEN RewardsAvailable - @Qty ELSE 0 END,
                    ModifiedOn = GETDATE()
                WHERE CustomerId = @CustomerId AND RuleId = @RuleId
              `);
          }
        }
      }

      // 6. Insert LoyaltyVisit Log
      // Extract if any dish reward was visit
      const firstDishReward = Array.isArray(items) ? items.find(i => i.isDishReward) : null;

      await transaction.request()
        .input("LoyaltyCustomerId", sql.UniqueIdentifier, customerId)
        .input("SettlementId", sql.UniqueIdentifier, settlementId)
        .input("BillNo", sql.NVarChar(50), cleanBillNo)
        .input("IsRewardVisit", sql.Bit, firstDishReward ? 1 : 0)
        .input("RewardDishId", sql.UniqueIdentifier, firstDishReward ? firstDishReward.rewardDishId : null)
        .query(`
          INSERT INTO LoyaltyVisit (LoyaltyVisitId, LoyaltyCustomerId, SettlementId, BillNo, IsRewardVisit, RewardDishId)
          VALUES (NEWID(), @LoyaltyCustomerId, @SettlementId, @BillNo, @IsRewardVisit, @RewardDishId)
        `);

      await transaction.commit();
      res.json({ success: true, splitDuplicate: isSplitDuplicate });
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }
  } catch (err) {
    console.error("[LOYALTY LOG VISIT ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loyalty/register
// Registers a new loyalty customer (or returns existing) without a bill
router.post("/register", async (req, res) => {
  try {
    const { phone, name } = req.body;
    if (!phone || phone.trim() === "") {
      return res.status(400).json({ success: false, error: "Phone number is required" });
    }

    const pool = await poolPromise;
    const cleanPhone = phone.trim();

    // Check if already exists
    const existing = await pool.request()
      .input("Phone", sql.NVarChar(50), cleanPhone)
      .query("SELECT LoyaltyCustomerId, Phone, Name, VisitCount, TotalVisits, RewardsEarned, RewardsRedeemed, RewardPending FROM LoyaltyCustomer WHERE Phone = @Phone");

    if (existing.recordset.length > 0) {
      return res.json({ success: true, exists: true, customer: existing.recordset[0], message: "Customer already registered" });
    }

    // Insert new customer
    const insertRes = await pool.request()
      .input("Phone", sql.NVarChar(50), cleanPhone)
      .input("Name", sql.NVarChar(255), name ? name.trim() : null)
      .query(`
        DECLARE @newId UNIQUEIDENTIFIER = NEWID();
        INSERT INTO LoyaltyCustomer (LoyaltyCustomerId, Phone, Name, VisitCount, TotalVisits, LastVisitDate)
        VALUES (@newId, @Phone, @Name, 0, 0, GETDATE());
        SELECT @newId AS LoyaltyCustomerId;
      `);

    const newId = insertRes.recordset[0].LoyaltyCustomerId;

    const newCust = await pool.request()
      .input("LoyaltyCustomerId", sql.UniqueIdentifier, newId)
      .query("SELECT LoyaltyCustomerId, Phone, Name, VisitCount, TotalVisits, RewardsEarned, RewardsRedeemed, RewardPending FROM LoyaltyCustomer WHERE LoyaltyCustomerId = @LoyaltyCustomerId");

    return res.json({ success: true, exists: false, customer: newCust.recordset[0], message: "Customer registered successfully" });
  } catch (err) {
    console.error("[LOYALTY REGISTER ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/loyalty/customer/:phone
router.delete("/customer/:phone", async (req, res) => {
  try {
    const { phone } = req.params;
    if (!phone || phone.trim() === "") {
      return res.status(400).json({ success: false, error: "Phone number is required" });
    }
    const pool = await poolPromise;
    
    const custRes = await pool.request()
      .input("Phone", sql.NVarChar(50), phone.trim())
      .query("SELECT LoyaltyCustomerId FROM LoyaltyCustomer WHERE Phone = @Phone");
       
    if (custRes.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Loyalty customer not found" });
    }
    
    const customerId = custRes.recordset[0].LoyaltyCustomerId;
    
    await pool.request()
      .input("CustomerId", sql.UniqueIdentifier, customerId)
      .query("DELETE FROM CustomerDishLoyaltyState WHERE CustomerId = @CustomerId");

    await pool.request()
      .input("LoyaltyCustomerId", sql.UniqueIdentifier, customerId)
      .query("DELETE FROM LoyaltyVisit WHERE LoyaltyCustomerId = @LoyaltyCustomerId");
       
    await pool.request()
      .input("Phone", sql.NVarChar(50), phone.trim())
      .query("DELETE FROM LoyaltyCustomer WHERE Phone = @Phone");
       
    res.json({ success: true, message: "Loyalty visitor deleted successfully" });
  } catch (err) {
    console.error("[LOYALTY DELETE ERROR]", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/loyalty/customer/:phone/orders
router.get("/customer/:phone/orders", async (req, res) => {
  try {
    const { phone } = req.params;
    const { tableNo } = req.query;
    const pool = await poolPromise;
    
    const phoneValue = (phone && phone !== "guest" && phone !== "undefined") ? phone.trim() : "";
    const cleanDigits = phoneValue.replace(/\D/g, "");
    const last8Digits = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;
    const tableVal = (tableNo || "").toString().trim();

    if (!phoneValue && !tableVal) {
      return res.json([]);
    }

    const query = `
      SELECT DISTINCT
        SettlementID,
        BillNo,
        OrderDateTime,
        TotalAmount,
        IsCancelled,
        PayMode
      FROM (
        -- 1. Settled Orders (Cash, Card, PayNow closed at POS)
        SELECT 
          sh.SettlementID,
          sh.BillNo,
          ISNULL(sh.LastSettlementDate, sh.CreatedOn) AS OrderDateTime,
          sh.SysAmount AS TotalAmount,
          sh.IsCancelled,
          ISNULL(
            (
              SELECT TOP 1 UPPER(LTRIM(RTRIM(sts.PayMode)))
              FROM SettlementTotalSales sts
              WHERE sts.SettlementID = sh.SettlementID
            ), 'CASH'
          ) AS PayMode
        FROM SettlementHeader sh
        WHERE (@Phone <> '' AND REPLACE(REPLACE(sh.MobileNo, ' ', ''), '+', '') = @Phone)
           OR (@Last8 <> '' AND RIGHT(REPLACE(REPLACE(sh.MobileNo, ' ', ''), '+', ''), 8) = @Last8)

        UNION ALL

        -- 2. Open / Current Session QR Orders (Only if NOT already settled)
        SELECT 
          CAST(ro.OrderId AS NVARCHAR(100)) AS SettlementID,
          ro.OrderNumber AS BillNo,
          ro.CreatedOn AS OrderDateTime,
          ISNULL(ro.TotalAmount, 0) AS TotalAmount,
          CASE WHEN ro.StatusCode = 4 THEN 1 ELSE 0 END AS IsCancelled,
          'QR Order' AS PayMode
        FROM RestaurantOrderCur ro
        WHERE (@Phone <> '' AND REPLACE(REPLACE(ro.MobileNo, ' ', ''), '+', '') = @Phone)
           OR (@Last8 <> '' AND RIGHT(REPLACE(REPLACE(ro.MobileNo, ' ', ''), '+', ''), 8) = @Last8)
          AND NOT EXISTS (
            SELECT 1 FROM SettlementHeader sh_check 
            WHERE sh_check.BillNo = ro.OrderNumber OR CAST(sh_check.OrderId AS NVARCHAR(100)) = CAST(ro.OrderId AS NVARCHAR(100))
          )
      ) combined
      ORDER BY OrderDateTime DESC
    `;

    const result = await pool.request()
      .input("Phone", sql.NVarChar(50), phoneValue)
      .input("Last8", sql.NVarChar(50), last8Digits)
      .input("TableNo", sql.NVarChar(50), tableVal)
      .query(query);

    res.json(result.recordset || []);
  } catch (err) {
    console.error("[LOYALTY CUSTOMER ORDERS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loyalty/order/:settlementId
router.get("/order/:settlementId", async (req, res) => {
  try {
    const { settlementId } = req.params;
    if (!settlementId || settlementId.trim() === "") {
      return res.status(400).json({ error: "Settlement ID is required" });
    }
    const pool = await poolPromise;
    
    const headerRes = await pool.request()
      .input("Id", sql.UniqueIdentifier, settlementId)
      .query(`
        SELECT 
          sh.SettlementID,
          sh.BillNo,
          sh.CreatedOn AS OrderDateTime,
          sh.SysAmount AS TotalAmount,
          sh.SubTotal,
          sh.TotalTax,
          sh.DiscountAmount,
          sh.ServiceCharge,
          sh.IsCancelled
        FROM SettlementHeader sh
        WHERE sh.SettlementID = @Id
      `);
      
    if (headerRes.recordset.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }
    
    const itemsRes = await pool.request()
      .input("Id", sql.UniqueIdentifier, settlementId)
      .query(`
        SELECT 
          DishId,
          DishName,
          Qty,
          Price,
          DiscountAmount
        FROM SettlementItemDetail
        WHERE SettlementID = @Id
      `);
      
    res.json({
      order: headerRes.recordset[0],
      items: itemsRes.recordset || []
    });
  } catch (err) {
    console.error("[LOYALTY ORDER DETAILS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
