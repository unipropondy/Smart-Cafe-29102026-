const { poolPromise } = require('../backend/config/db');
const sql = require('../backend/node_modules/mssql');

async function test() {
  const pool = await poolPromise;
  
  const cleanId = '718077AA-1DE4-45AD-B807-5DCC701C9917';
  console.log("1. Testing sentCountCheck...");
  try {
    const res = await pool.request()
      .input('tidForCheck', sql.VarChar(50), cleanId)
      .query(`
        DECLARE @TableNoCheck VARCHAR(20);
        SELECT TOP 1 @TableNoCheck = TableNumber FROM TableMaster WHERE TableNumber = @tidForCheck OR (TRY_CAST(@tidForCheck AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tidForCheck AS UNIQUEIDENTIFIER));

        SELECT COUNT(*) AS SentCount
        FROM RestaurantOrderDetailCur d
        JOIN RestaurantOrderCur h ON h.OrderId = d.OrderId
        WHERE (RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@TableNoCheck)) OR RTRIM(LTRIM(h.Tableno)) = RTRIM(LTRIM(@tidForCheck)))
          AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL)
          AND d.StatusCode >= 2
      `);
    console.log("SentCountCheck passed, count:", res.recordset[0]?.SentCount);
  } catch (err) {
    console.error("SentCountCheck failed:", err.message);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    console.log("\n3. Testing initRes in syncToProfessionalTables...");
    const initRes = await transaction.request()
      .input("orderNo", sql.NVarChar(50), "20261015-9999")
      .input("tableId", sql.VarChar(50), cleanId)
      .query(`
        DECLARE @ActualTableNo VARCHAR(20) = 'TAKEAWAY';
        DECLARE @Section INT = 4;
        DECLARE @Pax INT = NULL;
        DECLARE @CustomerName NVARCHAR(150) = NULL;
        IF @tableId IS NOT NULL 
          SELECT TOP 1 @ActualTableNo = TableNumber, @Section = ISNULL(DiningSection, 4), @Pax = Pax, @CustomerName = CustomerName FROM TableMaster WHERE TableId = @tableId;

        DECLARE @PriorityCode INT = NULL;
        IF @Section = 1 SET @PriorityCode = 1
        ELSE IF @Section = 2 SET @PriorityCode = 2
        ELSE IF @Section = 3 SET @PriorityCode = 3
        ELSE IF @Section = 4 SET @PriorityCode = 4

        SELECT TOP 1 OrderId, Tableno, BusinessUnitId, OrderNumber
        FROM RestaurantOrderCur WITH (UPDLOCK)
        WHERE OrderNumber = @orderNo 
        OR (RTRIM(LTRIM(Tableno)) = RTRIM(LTRIM(@ActualTableNo)) AND (isOrderClosed = 0 OR isOrderClosed IS NULL)) 
        ORDER BY 
          CASE WHEN OrderNumber = @orderNo THEN 0 ELSE 1 END,
          CreatedOn DESC;
        
        SELECT @ActualTableNo as ActualTableNo, @PriorityCode as PriorityCode, @Pax as Pax, @CustomerName as CustomerName;
      `);
    console.log("initRes passed");

    console.log("\n4. Testing insert RestaurantOrderCur...");
    const orderGuid = require('crypto').randomUUID();
    const finalUserId = "00000000-0000-0000-0000-000000000000";
    const bizId = "00000000-0000-0000-0000-000000000000";
    const startDate = new Date();
    await transaction.request()
      .input("orderId", sql.UniqueIdentifier, orderGuid)
      .input("orderNo", sql.NVarChar(50), "20261015-9999")
      .input("tableNo", sql.VarChar(20), "TW7")
      .input("userId", sql.UniqueIdentifier, finalUserId)
      .input("bizId", sql.UniqueIdentifier, bizId)
      .input("priority", sql.Int, 4)
      .input("isTakeaway", sql.Bit, 1)
      .input("pax", sql.Int, 1)
      .input("customerName", sql.NVarChar(150), "Test Cust")
      .input("takeawayCharge", sql.Decimal(18, 2), 0)
      .input("startDate", sql.Date, startDate)
      .input("discAmt", sql.Decimal(18, 2), 0)
      .input("discRemarks", sql.NVarChar(250), null)
      .input("entryStatus", sql.NVarChar(10), "q")
      .input("mobileNo", sql.NVarChar(50), null)
      .query(`
        INSERT INTO RestaurantOrderCur (
          OrderId, OrderNumber, Tableno, Status, CreatedBy, CreatedOn, BusinessUnitId,
          PriorityCode, IsTakeAway, Pax, CustomerName, TakeawayCharge, start_date,
          DiscountAmount, DiscountRemarks, entry_status, MobileNo
        ) VALUES (
          @orderId, @orderNo, @tableNo, 1, @userId, GETDATE(), @bizId,
          @priority, @isTakeaway, @pax, @customerName, @takeawayCharge, @startDate,
          @discAmt, @discRemarks, @entryStatus, @mobileNo
        )
      `);
    console.log("insert RestaurantOrderCur passed");

    console.log("\n5. Testing item insert...");
    const itemReq = transaction.request();
    itemReq.input("orderId", sql.UniqueIdentifier, orderGuid);
    itemReq.input("userId", sql.UniqueIdentifier, finalUserId);
    itemReq.input("bizId", sql.UniqueIdentifier, bizId);
    itemReq.input("orderNo", sql.NVarChar(100), "20261015-9999");
    itemReq.input("startDate", sql.Date, startDate);

    const dishId = 'D50B97D3-FD16-4AD9-97BD-ACC6AB91DD1E';
    const lineItemId = require('crypto').randomUUID();
    itemReq.input("id0", sql.UniqueIdentifier, lineItemId);
    itemReq.input("dish0", sql.UniqueIdentifier, dishId);
    itemReq.input("qty0", sql.Decimal(18, 3), 1);
    itemReq.input("cost0", sql.Decimal(18, 2), 1.00);
    itemReq.input("status0", sql.Int, 2);
    itemReq.input("name0", sql.NVarChar(200), "100plus");
    itemReq.input("song0", sql.NVarChar(200), "");
    itemReq.input("note0", sql.NVarChar(sql.MAX), "");
    itemReq.input("mods0", sql.NVarChar(sql.MAX), null);
    itemReq.input("tw0", sql.Bit, 1);
    itemReq.input("combo0", sql.NVarChar(sql.MAX), null);
    itemReq.input("disc0", sql.Decimal(18, 2), 0);
    itemReq.input("disctype0", sql.NVarChar(50), "fixed");
    itemReq.input("sc0", sql.Decimal(18, 2), null);
    itemReq.input("created0", sql.DateTime, new Date());

    await itemReq.query(`
      INSERT INTO RestaurantOrderDetailCur (OrderDetailId, OrderId, DishId, Description, DishName,SongName, Quantity, PricePerUnit, ActualAmount, TotalDetailLineAmount, BaseAmount, StatusCode, CreatedBy, CreatedOn, ModifiersJSON, ComboDetailsJSON, OrderNumber, Remarks, isTakeAway, BusinessUnitId, OrderDateTime, DiscountAmount, DiscountType, ServiceCharge, start_date)
      VALUES (@id0, @orderId, @dish0, @name0, @name0, @song0, @qty0, @cost0, @cost0 * @qty0, @cost0 * @qty0, @cost0 * @qty0, @status0, @userId, GETDATE(), @mods0, @combo0, @orderNo, @note0, @tw0, @bizId, GETDATE(), @disc0, @disctype0, @sc0, @startDate);
    `);
    console.log("item insert passed");

    console.log("\n6. Testing table lock update...");
    await transaction.request()
      .input("tid", sql.VarChar(50), cleanId)
      .input("oid", sql.NVarChar(50), "20261015-9999")
      .input("status", sql.Int, 1)
      .input("paymentStatus", sql.Int, 0)
      .input("entryStatus", sql.NVarChar(10), "q")
      .query(`
        UPDATE TableMaster 
        SET Status = CASE WHEN Status = 2 THEN 2 ELSE @status END, 
            entry_status = @entryStatus,
            PAYMENT_STATUS = @paymentStatus,
            CurrentOrderId = @oid,
            StartTime = CASE WHEN StartTime IS NULL OR StartTime < '2000-01-01' THEN GETDATE() ELSE StartTime END,
            ModifiedOn = GETDATE()
        WHERE TableNumber = @tid OR (TRY_CAST(@tid AS UNIQUEIDENTIFIER) IS NOT NULL AND TableId = TRY_CAST(@tid AS UNIQUEIDENTIFIER))
      `);
    console.log("table lock update passed");

  } catch (err) {
    console.error("Step failed with error:", err);
  } finally {
    await transaction.rollback();
    process.exit(0);
  }
}

test();
