const express = require("express");
const router = express.Router();
const { poolPromise, sql } = require("../config/db");

// 🔹 GET
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT s.*, u.FullName AS CreatorName 
      FROM [server] s
      LEFT JOIN [dbo].[UserMaster] u ON s.CreatedBy = u.UserId
      ORDER BY s.CreatedDate DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET SERVERS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 POST (ADD)
router.post("/add", async (req, res) => {
  try {
    console.log("📥 POST /api/servers/add | Body:", JSON.stringify(req.body, null, 2));
    const { SER_NAME } = req.body;
    // Extract userId with casing resilience
    const userId = req.body.userId || req.body.UserId || req.body.USERID;
    
    console.log("➕ Attempting to add server:", { SER_NAME, userId });

    const pool = await poolPromise;

    await pool.request()
      .input("SER_NAME", sql.VarChar, SER_NAME)
      .input("CreatedBy", sql.UniqueIdentifier, userId || null)
      .query(`
        INSERT INTO [server] (SER_NAME, CreatedBy, CreatedDate)
        VALUES (@SER_NAME, @CreatedBy, GETDATE())
      `);

    res.json({ success: true, message: "Created successfully" });
  } catch (err) {
    console.error("ADD SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 UPDATE
router.post("/update", async (req, res) => {
  try {
    console.log("📥 POST /api/servers/update | Body:", JSON.stringify(req.body, null, 2));
    const { SER_ID, SER_NAME } = req.body;
    const userId = req.body.userId || req.body.UserId || req.body.USERID;
    
    console.log("📝 Attempting to update server:", { SER_ID, SER_NAME, userId });

    const pool = await poolPromise;

    await pool.request()
      .input("SER_ID", sql.Int, SER_ID)
      .input("SER_NAME", sql.VarChar, SER_NAME)
      .input("ModifiedBy", sql.UniqueIdentifier, userId || null)
      .query(`
        UPDATE [server]
        SET 
          SER_NAME = @SER_NAME,
          ModifiedBy = @ModifiedBy,
          ModifiedDate = GETDATE()
        WHERE SER_ID = @SER_ID
      `);

    res.json({ success: true, message: "Updated successfully" });
  } catch (err) {
    console.error("UPDATE SERVER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 DELETE
router.post("/delete", async (req, res) => {
  try {
    const { SER_ID } = req.body;
    const pool = await poolPromise;

    await pool.request()
      .input("SER_ID", sql.Int, SER_ID)
      .query(`DELETE FROM [server] WHERE SER_ID = @SER_ID`);

    res.json({ success: true, message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 GET HISTORY (from servermaster)
router.get("/history", async (req, res) => {
  try {
    const { name, serId, startDate, endDate, detail } = req.query;
    const pool = await poolPromise;
    const request = pool.request();
    
    let query = "";
    if (detail === "true") {
      query = `SELECT * FROM servermaster WHERE 1=1`;
    } else {
      query = `SELECT SER_ID, SER_NAME, COUNT(*) as OrderCount FROM servermaster WHERE 1=1`;
    }

    if (name) {
      request.input("name", sql.VarChar, `%${name}%`);
      query += ` AND SER_NAME LIKE @name`;
    }
    if (serId) {
      request.input("serId", sql.Int, serId);
      query += ` AND SER_ID = @serId`;
    }
    if (startDate) {
      request.input("startDate", sql.DateTime, startDate);
      query += ` AND CreatedDate >= @startDate`;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      request.input("endDate", sql.DateTime, end);
      query += ` AND CreatedDate <= @endDate`;
    }

    if (detail === "true") {
      query += ` ORDER BY CreatedDate DESC`;
    } else {
      query += ` GROUP BY SER_ID, SER_NAME ORDER BY OrderCount DESC`;
    }

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("GET SERVER HISTORY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;