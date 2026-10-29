require('dotenv').config({ path: '.env' });
const { poolPromise } = require('./config/db');

async function run() {
  const pool = await poolPromise;

  // Test the exact SQL from our new barcode endpoint using a known barcode
  const barcode = '9011177'; // Red Sauce Pasta from our earlier sample

  const result = await pool.request()
    .input("BarCode", barcode)
    .query(`
      SELECT TOP 1
        d.DishId,
        d.Name,
        d.currentcost AS Price,
        ISNULL(d.IsOpenItem, 0) AS IsOpenItem,
        ISNULL(d.IsCombo, 0) AS IsCombo,
        ISNULL(d.IsSoldOut, 0) AS IsSoldOut,
        ISNULL(d.isServiceCharge, 1) AS isServiceCharge,
        ISNULL(ckt.KitchenTypeCode, '2') AS KitchenTypeCode,
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') AS KitchenTypeName,
        pm.PrinterPath AS PrinterIP,
        b.BarCode,
        b.Description AS BarcodeDescription
      FROM BarCodeMaster b
      JOIN DishMaster d ON b.DishId = d.DishId
      LEFT JOIN DishGroupMaster dgm ON d.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
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
    console.log('❌ Barcode not found:', barcode);
  } else {
    console.log('✅ Barcode lookup SUCCESS:');
    console.table(result.recordset);
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
