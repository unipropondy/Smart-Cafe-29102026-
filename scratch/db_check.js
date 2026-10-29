const { poolPromise } = require("c:/Users/UNIPRO/Desktop/POS/backend/config/db.js");

async function check() {
  try {
    const pool = await poolPromise;
    const orderNo = "20260808-0069";
    console.log("Checking database state for Order:", orderNo);

    // 1. Get the order details
    const orderRes = await pool.request()
      .input("orderNo", orderNo)
      .query("SELECT * FROM RestaurantOrderCur WHERE OrderNumber = @orderNo");
    
    console.log("Order Header:", orderRes.recordset);

    if (orderRes.recordset.length > 0) {
      const orderId = orderRes.recordset[0].OrderId;
      
      // 2. Get line items
      const itemsRes = await pool.request()
        .input("orderId", orderId)
        .query("SELECT * FROM RestaurantOrderDetailCur WHERE OrderId = @orderId");
      
      console.log("Order Line Items (RestaurantOrderDetailCur):", itemsRes.recordset.map(i => ({
        OrderDetailId: i.OrderDetailId,
        DishName: i.DishName,
        StatusCode: i.StatusCode,
        Quantity: i.Quantity
      })));

      // 3. Check what counts as pending
      const pendingRes = await pool.request()
        .input("orderId", orderId)
        .query("SELECT StatusCode, COUNT(*) as count FROM RestaurantOrderDetailCur WHERE OrderId = @orderId GROUP BY StatusCode");
      
      console.log("Pending stats (Grouped by StatusCode):", pendingRes.recordset);
    } else {
      console.log("No order header found in RestaurantOrderCur for OrderNumber:", orderNo);
    }
  } catch (err) {
    console.error("Error checking db:", err);
  }
  process.exit(0);
}

check();
