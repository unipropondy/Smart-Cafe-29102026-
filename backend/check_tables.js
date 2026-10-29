const { poolPromise } = require("./config/db");

async function check() {
  const pool = await poolPromise;
  const query = `
    SELECT 
      d.Name AS OptionName,
      d.DishId AS OptionDishId,
      cat.CategoryName AS OptionCategory,
      ckt.KitchenTypeName AS OptionKitchen,
      -- Find matching dish with same name in other category
      real_d.DishId AS RealDishId,
      real_d.CategoryName AS RealCategory,
      real_d.KitchenTypeName AS RealKitchen,
      real_d.PrinterIP AS RealPrinterIP
    FROM DishMaster d WITH (NOLOCK)
    LEFT JOIN DishGroupMaster dgm WITH (NOLOCK) ON d.DishGroupId = dgm.DishGroupId
    LEFT JOIN CategoryMaster cat WITH (NOLOCK) ON dgm.CategoryId = cat.CategoryId
    LEFT JOIN CategoryKitchenType ckt WITH (NOLOCK) ON dgm.CategoryId = ckt.CategoryId
    
    -- Subquery/Join to find a dish of the same name in a non-Add-Ons category
    OUTER APPLY (
      SELECT TOP 1 
        d2.DishId,
        cat2.CategoryName,
        ckt2.KitchenTypeCode,
        ckt2.KitchenTypeName,
        pm2.PrinterIP
      FROM DishMaster d2 WITH (NOLOCK)
      LEFT JOIN DishGroupMaster dgm2 WITH (NOLOCK) ON d2.DishGroupId = dgm2.DishGroupId
      LEFT JOIN CategoryMaster cat2 WITH (NOLOCK) ON dgm2.CategoryId = cat2.CategoryId
      LEFT JOIN CategoryKitchenType ckt2 WITH (NOLOCK) ON dgm2.CategoryId = ckt2.CategoryId
      LEFT JOIN PrintMaster pm2 WITH (NOLOCK) ON CAST(ckt2.KitchenTypeCode AS VARCHAR(50)) = CAST(pm2.KitchenTypeValue AS VARCHAR(50)) AND pm2.IsActive = 1 AND pm2.PrinterType = 2
      WHERE d2.Name = d.Name
        AND cat2.CategoryName NOT IN ('Add Ons', 'ADD ONS')
        AND d2.IsActive = 1
    ) real_d

    WHERE cat.CategoryName IN ('Add Ons', 'ADD ONS')
      AND d.IsActive = 1
  `;
  const res = await pool.request().query(query);
  console.log("Resolution results:");
  console.table(res.recordset);
  process.exit(0);
}

check();
