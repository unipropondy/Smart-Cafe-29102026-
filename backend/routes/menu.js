const express = require("express");
const router = express.Router();
const { poolPromise } = require("../config/db");
const sharp = require("sharp");

// 🚀 PERFORMANCE CACHE
const cache = new Map();
const CACHE_TTL = 300000; // 5 minutes

function getCached(key, req) {
  const scope = req?.databaseName || "default";
  const fullKey = `${scope}:${key}`;
  const item = cache.get(fullKey);
  if (item && (Date.now() - item.time < CACHE_TTL)) {
    console.log(`⚡ [MenuCache] Cache HIT: ${fullKey}`);
    return item.data;
  }
  console.log(`⚡ [MenuCache] Cache MISS: ${fullKey}`);
  return null;
}

function setCache(key, data, req) {
  const scope = req?.databaseName || "default";
  const fullKey = `${scope}:${key}`;
  cache.set(fullKey, { data, time: Date.now() });
  console.log(`⚡ [MenuCache] Cache STORED: ${fullKey}`);
}

/* ================= KITCHENS / CATEGORIES ================= */
router.get("/kitchens", async (req, res) => {
  try {
    const cached = getCached("kitchens");
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT cm.CategoryId, cm.CategoryName AS KitchenTypeName, ckt.KitchenTypeCode, cm.SortCode, ISNULL(cm.IsPublished, 0) AS IsPublished
      FROM CategoryMaster cm
      LEFT JOIN CategoryKitchenType ckt ON cm.CategoryId = ckt.CategoryId
      WHERE cm.IsActive = 1
      ORDER BY cm.SortCode ASC, cm.CategoryName ASC
    `);
    setCache("kitchens", result.recordset);
    res.json(result.recordset);
  } catch (err) {
    console.error("KITCHEN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/dishgroups/all", async (req, res) => {
  try {
    const cacheKey = "dishgroups_all";
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        DishGroupId,
        DishGroupName,
        ISNULL(IsPublished, 0) AS IsPublished
      FROM DishGroupMaster
      WHERE IsActive = 1
      ORDER BY DishGroupName ASC
    `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/dishgroups/:CategoryId", async (req, res) => {
  try {
    const categoryId = req.params.CategoryId;
    const cacheKey = `dishgroups_${categoryId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("CategoryId", categoryId).query(`
        SELECT DISTINCT
              a.DishGroupId,
              a.DishGroupName,
              a.SortCode,
              ISNULL(a.IsPublished, 0) AS IsPublished
          FROM DishGroupMaster a
          LEFT JOIN DishGroupKitchentype dkt
              ON a.DishGroupId = dkt.DishGroupId
          LEFT JOIN CategoryMaster cm
              ON cm.CategoryId = @CategoryId
          WHERE a.IsActive = 1
          AND (
                a.CategoryId = @CategoryId
                OR dkt.KitchenTypeName = cm.CategoryName
          )
          ORDER BY a.SortCode ASC, a.DishGroupName ASC
      `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ================= DISHES ================= */
router.get("/dishes/all", async (req, res) => {
  try {
    const cacheKey = "dishes_all";
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        d.DishId, d.Name, d.DishGroupId, d.currentcost AS Price,
        d.DishCode, d.Description, d.AvailableTimeFrom, d.AvailableTimeTo,
        d.Imageid AS Image, CASE WHEN d.Imageid IS NOT NULL THEN 1 ELSE 0 END AS HasImage,
        ISNULL(d.IsOpenItem, 0) AS IsOpenItem,
        ISNULL(d.isServiceCharge, 1) AS isServiceCharge,
        ISNULL(d.IsCombo, 0) AS IsCombo,
        ISNULL(d.IsSoldOut, 0) AS IsSoldOut,
        ISNULL(d.IsPublished, 0) AS IsPublished,
        ISNULL(d.isFavourite, 0) AS isFavourite,
        ISNULL(d.TakeawayCharge, 0) AS TakeawayCharge,
        ISNULL(d.TakeawayCharge, 0) AS takeawayCharge,
        ISNULL(cat.IsPublished, 0) AS CategoryPublished,
        ISNULL(dgm.IsPublished, 0) AS GroupPublished,
        ISNULL((
          SELECT CAST(dmap.DishGroupId AS VARCHAR(50)) + ','
          FROM DishGroupMapping dmap
          WHERE dmap.DishId = d.DishId
          FOR XML PATH('')
        ), '') AS MappedGroupIds,
        (SELECT COUNT(1) FROM DishModifier dm WHERE dm.DishId = d.DishId) AS HasModifiers,
        CAST(ISNULL(d.IsDiscountAllowed, 1) AS INT) AS IsDiscountAllowed,
        ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode,
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
        pm.PrinterPath AS PrinterIP,
        ISNULL(d.SordCode, 0) AS SordCode
      FROM DishMaster d
      LEFT JOIN DishGroupMaster dgm ON d.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY LOWER(TRIM(KitchenTypeName)) ORDER BY PrinterId) as rn 
        FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
      ) pm ON LOWER(TRIM(ISNULL(ckt.KitchenTypeName, cat.CategoryName))) = LOWER(TRIM(pm.KitchenTypeName)) AND pm.rn = 1
      WHERE d.IsActive = 1 ORDER BY ISNULL(d.SordCode, 0) ASC, d.Name ASC
    `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get("/dishes/favourites", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        d.DishId, d.Name, d.DishGroupId, d.currentcost AS Price,
        d.DishCode, d.Description, d.AvailableTimeFrom, d.AvailableTimeTo,
        d.Imageid AS Image, CASE WHEN d.Imageid IS NOT NULL THEN 1 ELSE 0 END AS HasImage,
        ISNULL(d.IsOpenItem, 0) AS IsOpenItem,
        ISNULL(d.isServiceCharge, 1) AS isServiceCharge,
        ISNULL(d.IsCombo, 0) AS IsCombo,
        ISNULL(d.IsSoldOut, 0) AS IsSoldOut,
        ISNULL(d.IsPublished, 0) AS IsPublished,
        ISNULL(d.isFavourite, 0) AS isFavourite,
        ISNULL(d.TakeawayCharge, 0) AS TakeawayCharge,
        ISNULL(d.TakeawayCharge, 0) AS takeawayCharge,
        ISNULL(cat.IsPublished, 0) AS CategoryPublished,
        ISNULL(dgm.IsPublished, 0) AS GroupPublished,
        ISNULL((
          SELECT CAST(dmap.DishGroupId AS VARCHAR(50)) + ','
          FROM DishGroupMapping dmap
          WHERE dmap.DishId = d.DishId
          FOR XML PATH('')
        ), '') AS MappedGroupIds,
        (SELECT COUNT(1) FROM DishModifier dm WHERE dm.DishId = d.DishId) AS HasModifiers,
        CAST(ISNULL(d.IsDiscountAllowed, 1) AS INT) AS IsDiscountAllowed,
        ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode,
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
        pm.PrinterPath AS PrinterIP,
        ISNULL(d.SordCode, 0) AS SordCode
      FROM DishMaster d
      LEFT JOIN DishGroupMaster dgm ON d.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY LOWER(TRIM(KitchenTypeName)) ORDER BY PrinterId) as rn 
        FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
      ) pm ON LOWER(TRIM(ISNULL(ckt.KitchenTypeName, cat.CategoryName))) = LOWER(TRIM(pm.KitchenTypeName)) AND pm.rn = 1
      WHERE d.IsActive = 1 AND d.isFavourite = 1
      ORDER BY ISNULL(d.SordCode, 0) ASC, d.Name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post("/dishes/:DishId/toggle-favourite", async (req, res) => {
  try {
    const dishId = req.params.DishId;
    const pool = await poolPromise;
    await pool.request()
      .input("DishId", dishId)
      .query(`
        UPDATE DishMaster 
        SET isFavourite = CASE WHEN isFavourite = 1 THEN 0 ELSE 1 END 
        WHERE DishId = @DishId
      `);
    setCache("dishes_all", null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/dishes/group/:DishGroupId", async (req, res) => {
  try {
    const dishGroupId = req.params.DishGroupId;
    const cacheKey = `dishes_group_${dishGroupId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("DishGroupId", dishGroupId).query(`
      SELECT DISTINCT
              d.DishId,
              d.Name,
              d.DishGroupId,
              d.currentcost AS Price,
              d.DishCode,
              d.Description,
              d.AvailableTimeFrom,
              d.AvailableTimeTo,
              d.Imageid AS Image,
              CASE WHEN d.Imageid IS NOT NULL THEN 1 ELSE 0 END AS HasImage,
              ISNULL(d.isServiceCharge, 1) AS isServiceCharge,
              ISNULL(d.IsOpenItem, 0) AS IsOpenItem,
              ISNULL(d.IsCombo, 0) AS IsCombo,
              ISNULL(d.IsSoldOut, 0) AS IsSoldOut,
              ISNULL(d.IsPublished, 0) AS IsPublished,
              ISNULL(d.isFavourite, 0) AS isFavourite,
              ISNULL(d.TakeawayCharge, 0) AS TakeawayCharge,
              ISNULL(d.TakeawayCharge, 0) AS takeawayCharge,
              ISNULL(cat.IsPublished, 0) AS CategoryPublished,
              ISNULL(dgm.IsPublished, 0) AS GroupPublished,
              (SELECT COUNT(1) FROM DishModifier dm WHERE dm.DishId = d.DishId) AS HasModifiers,
              CAST(ISNULL(d.IsDiscountAllowed, 1) AS INT) AS IsDiscountAllowed,
              ISNULL(ckt.KitchenTypeCode, '2') AS KitchenTypeCode,
              ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') AS KitchenTypeName,
              pm.PrinterPath AS PrinterIP,
              ISNULL(d.SordCode, 0) AS SordCode
          FROM DishMaster d
 
          LEFT JOIN DishGroupMaster dgm
              ON d.DishGroupId = dgm.DishGroupId
 
          LEFT JOIN CategoryMaster cat
              ON dgm.CategoryId = cat.CategoryId
 
          LEFT JOIN CategoryKitchenType ckt
              ON dgm.CategoryId = ckt.CategoryId
 
          LEFT JOIN DishGroupMapping dmap
              ON d.DishId = dmap.DishId
 
          LEFT JOIN (
              SELECT *,
                    ROW_NUMBER() OVER(
                        PARTITION BY LOWER(TRIM(KitchenTypeName))
                        ORDER BY PrinterId
                    ) AS rn
              FROM PrintMaster
              WHERE IsActive = 1
                AND IsEnabled = 1
                AND PrinterType = 2
          ) pm
          ON LOWER(TRIM(ISNULL(ckt.KitchenTypeName, cat.CategoryName))) = LOWER(TRIM(pm.KitchenTypeName))
          AND pm.rn = 1
 
          WHERE d.IsActive = 1
          AND (
                d.DishGroupId = @DishGroupId
                OR dmap.DishGroupId = @DishGroupId
              )
 
          ORDER BY ISNULL(d.SordCode, 0) ASC, d.Name ASC
      `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.get("/dishes/:DishId/validate-discount", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input("DishId", sql.VarChar(50), req.params.DishId)
      .query("SELECT IsDiscountAllowed FROM DishMaster WHERE DishId = @DishId");
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Dish not found" });
    }
    const isAllowed = result.recordset[0].IsDiscountAllowed === true || parseInt(result.recordset[0].IsDiscountAllowed) === 1;
    res.json({ isDiscountAllowed: isAllowed ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ================= IMAGES ================= */
class LRUImageCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.estimatedMemoryBytes = 0;
  }

  has(key) {
    const exists = this.cache.has(key);
    return exists;
  }

  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      return null;
    }
    this.hits++;
    const value = this.cache.get(key);
    // Move key to the end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      const oldVal = this.cache.get(key);
      this.estimatedMemoryBytes -= oldVal.length || 0;
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first item in insertion order)
      const oldestKey = this.cache.keys().next().value;
      const oldestValue = this.cache.get(oldestKey);
      this.estimatedMemoryBytes -= oldestValue.length || 0;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, value);
    this.estimatedMemoryBytes += value.length || 0;
  }

  clear() {
    this.cache.clear();
    this.estimatedMemoryBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? ((this.hits / totalRequests) * 100).toFixed(2) + "%" : "0.00%";
    const missRate = totalRequests > 0 ? ((this.misses / totalRequests) * 100).toFixed(2) + "%" : "0.00%";

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      estimatedMemoryMb: (this.estimatedMemoryBytes / 1024 / 1024).toFixed(2) + " MB",
      hits: this.hits,
      misses: this.misses,
      hitRate,
      missRate
    };
  }
}

const imageCache = new LRUImageCache(100);
router.imageCache = imageCache;

router.get("/image/:imageId", async (req, res) => {
  try {
    const imageId = req.params.imageId;

    // Serve from cache if available
    const cachedBuffer = imageCache.get(imageId);
    if (cachedBuffer) {
      console.log(`⚡ [ImageCache] Cache HIT: ${imageId}`);
      res.set("Cache-Control", "public, max-age=86400");
      return res.type("image/jpeg").send(cachedBuffer);
    }

    console.log(`⚡ [ImageCache] Cache MISS: ${imageId}`);
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("Imageid", imageId)
      .query(`SELECT ImageData FROM ImageList WHERE Imageid = @Imageid`);

    if (result.recordset.length > 0 && result.recordset[0].ImageData) {
      let buffer = result.recordset[0].ImageData;

      // Compress large images (> 100KB) dynamically to prevent event loop bottlenecks
      if (buffer.length > 100 * 1024) {
        try {
          const startTime = Date.now();
          buffer = await sharp(buffer)
            .resize(400, 400, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          console.log(`⚡ [ImageCache] Compressed image ${imageId} from ${(result.recordset[0].ImageData.length / 1024).toFixed(1)}KB to ${(buffer.length / 1024).toFixed(1)}KB in ${Date.now() - startTime}ms`);
        } catch (compressErr) {
          console.error("⚠️ [ImageCache] Sharp compression failed, serving original image:", compressErr.message);
        }
      }

      imageCache.set(imageId, buffer);
      res.set("Cache-Control", "public, max-age=86400");
      res.type("image/jpeg").send(buffer);
    } else {
      res.status(404).send("Image not found");
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= MODIFIERS ================= */
router.get("/modifiers/:dishId", async (req, res) => {
  try {
    const cacheKey = `modifiers_${req.params.dishId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().input("dishId", req.params.dishId)
      .query(`
        WITH DishModifiersCTE AS (
          -- Direct Dish Modifiers from Modifier Tab
          SELECT dm.DishId, dm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
                 CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
                 ISNULL(m.isOpenModifier, 0) AS isOpenModifier,
                 ISNULL(m.SortCode, 0) AS SortCode
          FROM DishModifier dm 
          INNER JOIN ModifierMaster m ON dm.ModifierId = m.ModifierId
          WHERE dm.DishId = @dishId
        )
        SELECT DISTINCT
          dm.DishId,
          dm.ModifierID,
          dm.ModifierCode,
          dm.ModifierName,
          dm.Price,
          dm.isOpenModifier,
          dm.SortCode,
          dg.DishGroupId AS ModifierGroupId,
          dg.DishGroupName AS ModifierGroupName,
          ISNULL(dmg.MinSelectionCount, 0) AS MinSelectionCount,
          ISNULL(dmg.MaxSelectionCount, 0) AS MaxSelectionCount,
          ISNULL(dmg.MultiselectAllow, 0) AS MultiselectAllow
        FROM DishModifiersCTE dm
        -- Join with DishGroupModifier to find the group(s) this modifier belongs to
        LEFT JOIN DishGroupModifier dgm ON dm.ModifierID = dgm.ModifierId
        LEFT JOIN DishGroupMaster dg ON COALESCE(
          (SELECT TOP 1 ModifierGroupId FROM DishModifierGroup WHERE DishId = dm.DishId AND ModifierGroupId = dgm.DishGroupId),
          (SELECT DishGroupId FROM DishMaster WHERE DishId = dm.DishId)
        ) = dg.DishGroupId
        LEFT JOIN DishModifierGroup dmg ON dmg.DishId = dm.DishId AND dmg.ModifierGroupId = dg.DishGroupId
        ORDER BY dm.SortCode ASC, dm.ModifierName ASC
      `);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/modifiers/group/:DishGroupId", async (req, res) => {
  try {
    const cacheKey = `modifiers_group_${req.params.DishGroupId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const pool = await poolPromise;
    const result = await pool.request().input("DishGroupId", req.params.DishGroupId)
      .query(`
        WITH GroupDishModifiersCTE AS (
          -- Direct Dish Modifiers for dishes in this group
          SELECT dm.DishId, dm.ModifierId AS ModifierID, m.ModifierCode, m.ModifierName, 
                 CASE WHEN m.isPriceAffect = 1 AND m.isDishPrice = 1 THEN ISNULL(m.DishCost, 0) ELSE 0 END AS Price,
                 ISNULL(m.isOpenModifier, 0) AS isOpenModifier,
                 ISNULL(m.SortCode, 0) AS SortCode
          FROM DishModifier dm 
          INNER JOIN ModifierMaster m ON dm.ModifierId = m.ModifierId
          INNER JOIN DishMaster d ON dm.DishId = d.DishId
          WHERE d.DishGroupId = @DishGroupId
        )
        SELECT DISTINCT
          dm.DishId,
          dm.ModifierID,
          dm.ModifierCode,
          dm.ModifierName,
          dm.Price,
          dm.isOpenModifier,
          dm.SortCode,
          dg.DishGroupId AS ModifierGroupId,
          dg.DishGroupName AS ModifierGroupName,
          ISNULL(dmg.MinSelectionCount, 0) AS MinSelectionCount,
          ISNULL(dmg.MaxSelectionCount, 0) AS MaxSelectionCount,
          ISNULL(dmg.MultiselectAllow, 0) AS MultiselectAllow
        FROM GroupDishModifiersCTE dm
        -- Join with DishGroupModifier to find the group(s) this modifier belongs to
        LEFT JOIN DishGroupModifier dgm ON dm.ModifierID = dgm.ModifierId
        LEFT JOIN DishGroupMaster dg ON COALESCE(
          (SELECT TOP 1 ModifierGroupId FROM DishModifierGroup WHERE DishId = dm.DishId AND ModifierGroupId = dgm.DishGroupId),
          (SELECT DishGroupId FROM DishMaster WHERE DishId = dm.DishId)
        ) = dg.DishGroupId
        LEFT JOIN DishModifierGroup dmg ON dmg.DishId = dm.DishId AND dmg.ModifierGroupId = dg.DishGroupId
        ORDER BY dm.SortCode ASC, dm.ModifierName ASC`);
    setCache(cacheKey, result.recordset);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/checksplitdish/:DishId", async (req, res) => {
  try {

    const pool = await poolPromise;

    const result = await pool.request()
      .input("DishId", req.params.DishId)
      .query(`
        SELECT
          DishId,
          ISNULL(IsSplitDish,0) AS IsSplitDish,
            ISNULL(IsGroupDish,0) AS IsGroupDish
        FROM DishMaster
        WHERE DishId = @DishId
      `);

    res.json(result.recordset[0]);

  } catch (err) {
    console.log(err);
    res.status(500).send(err.message);
  }
});

router.get("/splitdishes", async (req, res) => {
  try {

    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        DishId,
        Name,
        CurrentCost as Price,
        songName
      FROM DishMaster
      WHERE IsSplitDish = 1
      AND IsActive = 1
      AND ISNULL(IsGroupDish,0) =0
      ORDER BY Name
    `);

    res.json(result.recordset);

  } catch (err) {
    console.log(err);
    res.status(500).send(err.message);
  }
});

/* ================= BARCODE LOOKUP ================= */
router.get("/barcode/:code", async (req, res) => {
  try {
    const barcode = String(req.params.code || "").trim();
    if (!barcode || barcode.length > 50) {
      return res.status(400).json({ error: "Invalid barcode" });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("BarCode", barcode)
      .query(`
        SELECT TOP 1
          d.DishId,
          d.Name,
          d.DishGroupId,
          d.currentcost                              AS Price,
          d.DishCode,
          d.Description,
          ISNULL(d.IsOpenItem, 0)                    AS IsOpenItem,
          ISNULL(d.isServiceCharge, 1)               AS isServiceCharge,
          ISNULL(d.IsCombo, 0)                       AS IsCombo,
          ISNULL(d.IsSoldOut, 0)                     AS IsSoldOut,
          ISNULL(d.IsPublished, 0)                   AS IsPublished,
          ISNULL(d.TakeawayCharge, 0)                AS TakeawayCharge,
          ISNULL(d.TakeawayCharge, 0)                AS takeawayCharge,
          CAST(ISNULL(d.IsDiscountAllowed, 1) AS INT) AS IsDiscountAllowed,
          ISNULL(ckt.KitchenTypeCode, '2')           AS KitchenTypeCode,
          ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') AS KitchenTypeName,
          pm.PrinterPath                             AS PrinterIP,
          b.BarCode,
          b.Description                              AS BarcodeDescription
        FROM BarCodeMaster b
        JOIN DishMaster d          ON b.DishId = d.DishId
        LEFT JOIN DishGroupMaster dgm ON d.DishGroupId = dgm.DishGroupId
        LEFT JOIN CategoryMaster cat  ON dgm.CategoryId = cat.CategoryId
        LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
        LEFT JOIN (
          SELECT *, ROW_NUMBER() OVER(
            PARTITION BY LOWER(TRIM(KitchenTypeName)) ORDER BY PrinterId
          ) AS rn
          FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
        ) pm ON LOWER(TRIM(ISNULL(ckt.KitchenTypeName, cat.CategoryName))) = LOWER(TRIM(pm.KitchenTypeName)) AND pm.rn = 1
        WHERE b.BarCode = @BarCode
          AND d.IsActive = 1
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Barcode not found", code: barcode });
    }

    const dish = result.recordset[0];

    if (Number(dish.IsSoldOut) === 1) {
      return res.status(409).json({ error: "Item is sold out", dish });
    }

    res.json({ success: true, dish });
  } catch (err) {
    console.error("[Barcode Lookup] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.clearMenuCache = (io) => {
  cache.clear();
  console.log("⚡ [MenuCache] Cache INVALIDATION: All menu cache cleared dynamically");
  if (typeof imageCache !== 'undefined') {
    try { imageCache.clear(); } catch(e){}
  }
  try {
    const comboRoutes = require("./combo");
    if (comboRoutes && typeof comboRoutes.clearCache === "function") {
      comboRoutes.clearCache();
    }
  } catch (err) {
    console.error("Failed to clear combo cache:", err.message);
  }
  if (io) {
    console.log("📡 [MenuCache] Emitting menu_updated socket event...");
    io.emit("menu_updated", { timestamp: Date.now() });
  }
};

/* ================= PUBLISH STATUS TOGGLE ================= */
router.post("/publish-status", async (req, res) => {
  try {
    const { dishId, categoryId, dishGroupId, isPublished } = req.body;
    const pool = await poolPromise;
    const pubVal = (isPublished === 1 || isPublished === true || String(isPublished) === "1") ? 1 : 0;
    
    if (dishId) {
      await pool.request()
        .input("DishId", dishId)
        .input("IsPublished", pubVal)
        .query(`UPDATE DishMaster SET IsPublished = @IsPublished WHERE DishId = @DishId`);
    } else if (categoryId) {
      await pool.request()
        .input("CategoryId", categoryId)
        .input("IsPublished", pubVal)
        .query(`UPDATE CategoryMaster SET IsPublished = @IsPublished WHERE CategoryId = @CategoryId`);
    } else if (dishGroupId) {
      await pool.request()
        .input("DishGroupId", dishGroupId)
        .input("IsPublished", pubVal)
        .query(`UPDATE DishGroupMaster SET IsPublished = @IsPublished WHERE DishGroupId = @DishGroupId`);
    } else {
      return res.status(400).json({ error: "dishId, categoryId, or dishGroupId required" });
    }

    const io = req.app.get("io");
    router.clearMenuCache(io);

    res.json({ success: true, isPublished: pubVal, dishId, categoryId, dishGroupId });
  } catch (err) {
    console.error("Error updating publish status:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/clear-cache", (req, res) => {
  const io = req.app.get("io");
  router.clearMenuCache(io);
  res.json({ success: true, message: "Menu and image cache cleared successfully" });
});

module.exports = router;
