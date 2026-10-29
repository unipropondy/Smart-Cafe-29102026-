const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { authenticateToken } = require("../middleware/auth");


// ─────────────────────────────────────────────────────────────────
// SIMPLE IN-MEMORY CACHE (same pattern as menu.js)
// ─────────────────────────────────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes

function getCached(key) {
  const item = cache.get(key);
  if (item && Date.now() - item.time < CACHE_TTL) return item.data;
  return null;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}
function invalidateComboCache(dishId) {
  cache.delete("combo_list");
  if (dishId) {
    for (const key of cache.keys()) {
      if (key.startsWith(`combo_config_${dishId}`)) {
        cache.delete(key);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// GET /api/combo/list
// Returns all active combo dishes from DishMaster (IsCombo = 1).
// Used by the POS menu screen to decide whether to open wizard.
// ─────────────────────────────────────────────────────────────────
router.get("/list", async (req, res) => {
  try {
    const cached = getCached("combo_list");
    if (cached) return res.json({ success: true, data: cached });

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT
        d.DishId,
        d.Name,
        d.currentcost AS BasePrice,
        d.Description,
        d.DishGroupId,
        d.IsActive,
        ISNULL(d.isServiceCharge, 1) AS IsServiceCharge,
        ISNULL(d.SordCode, 0) AS SordCode
      FROM DishMaster d WITH (NOLOCK)
      WHERE d.IsCombo = 1
        AND d.IsActive = 1
      ORDER BY ISNULL(d.SordCode, 0) ASC, d.Name ASC
    `);

    setCache("combo_list", result.recordset);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("❌ [Combo] GET /list error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/combo/config/:DishId
// Returns full group + option configuration for a specific combo.
// Called when the POS wizard opens after the user selects a combo.
// ─────────────────────────────────────────────────────────────────
router.get("/config/:DishId", async (req, res) => {
  try {
    const { DishId } = req.params;
    const storeId = req.query.storeId || null; // Optional store filter

    const cacheKey = `combo_config_${DishId}_${storeId || "all"}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const pool = await poolPromise;

    // Step 1: Verify this DishId is actually a combo
    const dishCheck = await pool
      .request()
      .input("DishId", sql.UniqueIdentifier, DishId)
      .query(`
        SELECT DishId, Name, currentcost AS BasePrice, Description
        FROM DishMaster WITH (NOLOCK)
        WHERE DishId = @DishId AND IsCombo = 1 AND IsActive = 1
      `);

    if (!dishCheck.recordset.length) {
      return res.status(404).json({ success: false, error: "Combo dish not found or inactive." });
    }

    const comboDish = dishCheck.recordset[0];

    // Step 2: Fetch groups ordered by DisplayOrder
    const groupsResult = await pool
      .request()
      .input("DishId", sql.UniqueIdentifier, DishId)
      .query(`
        SELECT
          cgm.ComboGroupId,
          cgm.GroupName,
          cgm.DisplayOrder,
          cgm.MinSelection,
          cgm.MaxSelection,
          cgm.IsMultiSelect
        FROM ComboGroupMaster cgm WITH (NOLOCK)
        WHERE (
          cgm.ParentComboDishId = @DishId
          OR cgm.ComboGroupId IN (
            SELECT pdcgm.ComboGroupId
            FROM ParentDishComboGroupMapping pdcgm WITH (NOLOCK)
            WHERE pdcgm.ParentDishId = @DishId
          )
        )
        AND cgm.IsActive = 1
        ORDER BY cgm.DisplayOrder ASC
      `);

    const groups = groupsResult.recordset;
    if (!groups.length) {
      return res.json({ success: true, data: { ...comboDish, groups: [] } });
    }

    // Step 3: Fetch all options for all groups in one query
    const groupIds = groups.map(g => `'${g.ComboGroupId}'`).join(",");

    let storeFilter = "";
    const optionsRequest = pool.request();

    if (storeId) {
      storeFilter = "AND (m.StoreId = @StoreId OR m.StoreId IS NULL)";
      optionsRequest.input("StoreId", sql.UniqueIdentifier, storeId);
    }

    const optionsResult = await optionsRequest.query(`
      SELECT
        m.MappingId,
        m.ComboGroupId,
        m.DishId,
        d.Name AS DishName,
        d.Description AS DishDescription,
        d.Imageid AS Image,
        m.Surcharge,
        d.currentcost AS DishPrice,
        m.IsDefault,
        m.SortOrder,
        CASE 
          WHEN ISNULL(ckt.KitchenTypeName, cat.CategoryName) IN ('Add Ons', 'ADD ONS') THEN '8'
          ELSE ISNULL(ckt.KitchenTypeCode, '2')
        END as KitchenTypeCode,
        CASE 
          WHEN ISNULL(ckt.KitchenTypeName, cat.CategoryName) IN ('Add Ons', 'ADD ONS') THEN 'Beverages'
          ELSE ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN')
        END as KitchenTypeName,
        CASE 
          WHEN ISNULL(ckt.KitchenTypeName, cat.CategoryName) IN ('Add Ons', 'ADD ONS') 
            THEN COALESCE(
              (SELECT TOP 1 PrinterPath FROM PrintMaster WHERE PrinterType = 1 AND IsActive = 1),
              (SELECT TOP 1 PrinterIP FROM PrintMaster WHERE PrinterType = 1 AND IsActive = 1),
              '127.0.0.1'
            )
          ELSE pm.PrinterPath
        END AS PrinterIP
      FROM ComboGroupDishMapping m WITH (NOLOCK)
      INNER JOIN DishMaster d WITH (NOLOCK) ON m.DishId = d.DishId AND d.IsActive = 1
      OUTER APPLY (
        SELECT TOP 1 d2.DishGroupId
        FROM DishMaster d2 WITH (NOLOCK)
        INNER JOIN DishGroupMaster dgm2 WITH (NOLOCK) ON d2.DishGroupId = dgm2.DishGroupId
        INNER JOIN CategoryMaster cat2 WITH (NOLOCK) ON dgm2.CategoryId = cat2.CategoryId
        WHERE d2.Name = d.Name
          AND cat2.CategoryName NOT IN ('Add Ons', 'ADD ONS')
          AND d2.IsActive = 1
      ) real_d
      LEFT JOIN DishGroupMaster dgm WITH (NOLOCK) ON COALESCE(real_d.DishGroupId, d.DishGroupId) = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat WITH (NOLOCK) ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt WITH (NOLOCK) ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY LOWER(TRIM(KitchenTypeName)) ORDER BY PrinterId) as rn 
        FROM PrintMaster WITH (NOLOCK) WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
      ) pm ON LOWER(TRIM(ISNULL(ckt.KitchenTypeName, cat.CategoryName))) = LOWER(TRIM(pm.KitchenTypeName)) AND pm.rn = 1
      WHERE m.ComboGroupId IN (${groupIds})
        AND m.IsActive = 1
        ${storeFilter}
      ORDER BY m.ComboGroupId, m.SortOrder ASC
    `);

    const optionsMap = {};
    optionsResult.recordset.forEach(opt => {
      if (!optionsMap[opt.ComboGroupId]) optionsMap[opt.ComboGroupId] = [];
      optionsMap[opt.ComboGroupId].push({
        mappingId:       opt.MappingId,
        dishId:          opt.DishId,
        name:            opt.DishName,
        description:     opt.DishDescription,
        image:           opt.Image,
        surcharge:       parseFloat(opt.Surcharge || 0),
        dishPrice:       parseFloat(opt.DishPrice || 0),
        isDefault:       !!opt.IsDefault,
        sortOrder:       opt.SortOrder,
        KitchenTypeCode: opt.KitchenTypeCode,
        KitchenTypeName: opt.KitchenTypeName,
        PrinterIP:       opt.PrinterIP,
      });
    });

    const payload = {
      dishId:      comboDish.DishId,
      name:        comboDish.Name,
      basePrice:   parseFloat(comboDish.BasePrice || 0),
      description: comboDish.Description,
      groups: groups.map(g => ({
        comboGroupId:  g.ComboGroupId,
        groupName:     g.GroupName,
        displayOrder:  g.DisplayOrder,
        minSelection:  g.MinSelection,
        maxSelection:  g.MaxSelection,
        isMultiSelect: !!g.IsMultiSelect,
        options:       optionsMap[g.ComboGroupId] || [],
      })),
    };

    setCache(cacheKey, payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    console.error("❌ [Combo] GET /config error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// All write combo routes require authentication
router.use(authenticateToken);

// ─────────────────────────────────────────────────────────────────
// POST /api/combo
// Creates a new combo configuration.
// Body: { dishId, groups: [{ groupName, displayOrder, minSelection, maxSelection, isMultiSelect, dishes: [{ dishId, surcharge, isDefault, sortOrder }] }] }
// ─────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { dishId, groups } = req.body;

  if (!dishId || !Array.isArray(groups) || groups.length === 0) {
    return res.status(400).json({ success: false, error: "dishId and at least one group are required." });
  }

  const pool = await poolPromise;
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    // Mark the dish as a combo in DishMaster
    await transaction
      .request()
      .input("DishId", sql.UniqueIdentifier, dishId)
      .query("UPDATE DishMaster SET IsCombo = 1 WHERE DishId = @DishId");

    // Remove any stale groups/mappings for this dish before inserting fresh
    const existingGroups = await transaction
      .request()
      .input("DishId", sql.UniqueIdentifier, dishId)
      .query("SELECT ComboGroupId FROM ComboGroupMaster WHERE ParentComboDishId = @DishId");

    if (existingGroups.recordset.length > 0) {
      const existingGroupIds = existingGroups.recordset.map(g => `'${g.ComboGroupId}'`).join(",");
      await transaction
        .request()
        .query(`DELETE FROM ComboGroupDishMapping WHERE ComboGroupId IN (${existingGroupIds})`);
      await transaction
        .request()
        .input("DishId", sql.UniqueIdentifier, dishId)
        .query("DELETE FROM ComboGroupMaster WHERE ParentComboDishId = @DishId");
    }

    // Insert groups and their dish mappings
    for (const group of groups) {
      const { groupName, displayOrder = 0, minSelection = 1, maxSelection = 1, isMultiSelect = false, dishes = [] } = group;

      if (!groupName) continue;

      const groupInsert = await transaction
        .request()
        .input("ParentComboDishId", sql.UniqueIdentifier, dishId)
        .input("GroupName", sql.NVarChar(100), groupName)
        .input("DisplayOrder", sql.Int, displayOrder)
        .input("MinSelection", sql.Int, minSelection)
        .input("MaxSelection", sql.Int, maxSelection)
        .input("IsMultiSelect", sql.Bit, isMultiSelect ? 1 : 0)
        .query(`
          INSERT INTO ComboGroupMaster
            (ParentComboDishId, GroupName, DisplayOrder, MinSelection, MaxSelection, IsMultiSelect, IsActive)
          OUTPUT INSERTED.ComboGroupId
          VALUES (@ParentComboDishId, @GroupName, @DisplayOrder, @MinSelection, @MaxSelection, @IsMultiSelect, 1)
        `);

      const newGroupId = groupInsert.recordset[0].ComboGroupId;

      for (const dish of dishes) {
        const { dishId: optDishId, surcharge = 0, isDefault = false, sortOrder = 0, storeId = null } = dish;
        if (!optDishId) continue;

        const mappingRequest = transaction.request()
          .input("ComboGroupId", sql.UniqueIdentifier, newGroupId)
          .input("DishId", sql.UniqueIdentifier, optDishId)
          .input("Surcharge", sql.Decimal(18, 2), surcharge)
          .input("IsDefault", sql.Bit, isDefault ? 1 : 0)
          .input("SortOrder", sql.Int, sortOrder);

        if (storeId) {
          mappingRequest.input("StoreId", sql.UniqueIdentifier, storeId);
        }

        await mappingRequest.query(`
          INSERT INTO ComboGroupDishMapping
            (ComboGroupId, DishId, Surcharge, IsDefault, SortOrder, StoreId, IsActive)
          VALUES (
            @ComboGroupId, @DishId, @Surcharge, @IsDefault, @SortOrder,
            ${storeId ? "@StoreId" : "NULL"},
            1
          )
        `);
      }
    }

    await transaction.commit();
    invalidateComboCache(dishId);
    res.status(201).json({ success: true, message: "Combo configuration saved successfully." });
  } catch (err) {
    await transaction.rollback();
    console.error("❌ [Combo] POST / error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/combo/:DishId
// Updates an existing combo configuration. Full replace of groups/options.
// ─────────────────────────────────────────────────────────────────
router.put("/:DishId", async (req, res) => {
  const { DishId } = req.params;
  const { groups } = req.body;

  if (!Array.isArray(groups) || groups.length === 0) {
    return res.status(400).json({ success: false, error: "groups array is required." });
  }

  // Re-use POST logic with same dishId — it clears and rebuilds groups
  req.body.dishId = DishId;
  return router.handle({ ...req, method: "POST", url: "/" }, res, () => {});
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/combo/:DishId
// Soft-deletes the combo by setting IsCombo = 0 on the dish.
// Groups/mappings remain for historical reference but are no longer served.
// ─────────────────────────────────────────────────────────────────
router.delete("/:DishId", async (req, res) => {
  try {
    const { DishId } = req.params;
    const pool = await poolPromise;

    await pool
      .request()
      .input("DishId", sql.UniqueIdentifier, DishId)
      .query("UPDATE DishMaster SET IsCombo = 0 WHERE DishId = @DishId");

    invalidateComboCache(DishId);
    res.json({ success: true, message: "Combo deactivated successfully." });
  } catch (err) {
    console.error("❌ [Combo] DELETE error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.clearCache = () => {
  cache.clear();
  console.log("⚡ [ComboCache] Cache INVALIDATION: All combo cache cleared");
};

module.exports = router;
