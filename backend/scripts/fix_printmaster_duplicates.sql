-- ============================================================
-- PrintMaster Deduplication Script
-- Run this in SSMS to immediately clean up duplicate printer rows
-- ============================================================

-- Step 1: Preview what will be deleted (run this first to check)
SELECT PrinterId, PrinterName, PrinterType, KitchenTypeName, KitchenTypeValue, PrinterIP,
       ROW_NUMBER() OVER (
         PARTITION BY PrinterType, KitchenTypeName
         ORDER BY
           CASE WHEN ISNULL(PrinterIP,'') <> '' THEN 0 ELSE 1 END,
           KitchenTypeValue ASC,
           PrinterId
       ) AS rn
FROM PrintMaster
ORDER BY KitchenTypeName, PrinterType, KitchenTypeValue;

-- ============================================================
-- Step 2: DELETE duplicates (keep best row per KitchenTypeName)
-- ============================================================
WITH Ranked AS (
  SELECT PrinterId,
         ROW_NUMBER() OVER (
           PARTITION BY PrinterType, KitchenTypeName
           ORDER BY
             CASE WHEN ISNULL(PrinterIP,'') <> '' THEN 0 ELSE 1 END,
             KitchenTypeValue ASC,
             PrinterId
         ) AS rn
  FROM PrintMaster
)
DELETE FROM PrintMaster
WHERE PrinterId IN (SELECT PrinterId FROM Ranked WHERE rn > 1);

-- ============================================================
-- Step 3: Realign CategoryKitchenType to match surviving rows
-- (Prevents the sync from re-creating duplicates on restart)
-- ============================================================
UPDATE ckt
SET ckt.KitchenTypeCode = CAST(pm.KitchenTypeValue AS NVARCHAR(50))
FROM CategoryKitchenType ckt
JOIN CategoryMaster cm ON ckt.CategoryId = cm.CategoryId
JOIN PrintMaster pm ON pm.KitchenTypeName = cm.CategoryName AND pm.PrinterType = 2
WHERE ckt.KitchenTypeCode IS NOT NULL
  AND CAST(ckt.KitchenTypeCode AS INT) <> pm.KitchenTypeValue;

-- ============================================================
-- Step 4: Verify - should now show ONE row per KitchenTypeName
-- ============================================================
SELECT PrinterType, KitchenTypeName, KitchenTypeValue, PrinterIP, IsActive, IsEnabled
FROM PrintMaster
ORDER BY PrinterType, KitchenTypeName;
