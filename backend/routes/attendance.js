const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../config/db");
const { getActiveOrganization } = require("../utils/organizationHelper");
const { authenticateToken } = require("../middleware/auth");


// ================= GET USER =================
router.post("/getUser", async (req, res) => {
  try {
    const { userName } = req.body;

    if (!userName) {
      return res.status(400).json({ message: "Username is required" });
    }

    const pool = await poolPromise;
    const result = await pool.request().input("UserName", sql.VarChar, userName)
      .query(`
        SELECT UserId, UserName, FullName, UserPassword, IsDisabled
        FROM Vw_UserMaster
        WHERE UserName = @UserName
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.recordset[0];

    if (user.IsDisabled) {
      return res.status(403).json({ message: "User account is disabled" });
    }

    res.json({
      UserId: user.UserId,
      UserName: user.UserName,
      FullName: user.FullName,
    });
  } catch (err) {
    console.error("GET USER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Unused validatePassword endpoint removed

// ================= GET SUMMARY =================
router.get("/summary/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "UserId is required" });
    }

    const pool = await poolPromise;

    // 1. Get the last entry to determine current status
    const lastEntryRes = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        SELECT TOP 1 status, CreatedOn as ClockinTime
        FROM TimeEntry
        WHERE Userid = @UserId
        ORDER BY CreatedOn DESC
      `);

    const lastEntry = lastEntryRes.recordset[0];
    const lastStatusValue = lastEntry ? parseInt(lastEntry.status) : null;

    if (lastStatusValue === null || lastStatusValue === 0) {
      // User is completely offline (either never clocked in, or clocked out)
      return res.json({
        summary: {
          clockedIn: false,
          shiftCompleted: lastStatusValue === 0,
          lastStatus: lastStatusValue,
          clockInTime: null,
          clockOutTime: lastEntry ? new Date(lastEntry.ClockinTime).toISOString() : null,
          totalHours: 0,
          totalBreakMinutes: 0,
          netHours: 0,
          isOnBreak: false,
          canClockIn: true,
          canClockOut: false,
          canStartBreak: false,
          canEndBreak: false
        }
      });
    }

    // User is clocked in (either active, break in, or break out)
    // 2. Find when the active session started (most recent IN)
    const activeStartRes = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        SELECT TOP 1 CreatedOn as ClockinTime
        FROM TimeEntry
        WHERE Userid = @UserId AND status = 1
        ORDER BY CreatedOn DESC
      `);

    const activeStart = activeStartRes.recordset[0];
    if (!activeStart) {
      return res.json({
        summary: {
          clockedIn: false,
          shiftCompleted: false,
          lastStatus: null,
          clockInTime: null,
          clockOutTime: null,
          totalHours: 0,
          totalBreakMinutes: 0,
          netHours: 0,
          isOnBreak: false,
          canClockIn: true,
          canClockOut: false,
          canStartBreak: false,
          canEndBreak: false
        }
      });
    }

    const firstClockInTime = activeStart.ClockinTime;

    // 3. Fetch all entries since the session started
    const entries = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("StartTime", sql.DateTime, firstClockInTime)
      .query(`
        SELECT status, CreatedOn as ClockinTime, CreatedOn
        FROM TimeEntry
        WHERE Userid = @UserId AND CreatedOn >= @StartTime
        ORDER BY CreatedOn ASC
      `);

    let totalWorkMs = 0;
    let totalBreakMs = 0;
    let lastClockIn = null;
    let lastBreakIn = null;
    let isOnBreak = false;
    let hasClockIn = false;
    let lastClockOutTime = null;

    for (const entry of entries.recordset) {
      const entryTime = new Date(entry.ClockinTime).getTime();
      const status = parseInt(entry.status);

      if (status === 1) {
        lastClockIn = entryTime;
        hasClockIn = true;
        isOnBreak = false;
        lastClockOutTime = null;
      } else if (status === 0 && lastClockIn) {
        totalWorkMs += (entryTime - lastClockIn);
        lastClockIn = null;
        lastClockOutTime = entry.ClockinTime;
      } else if (status === 3) {
        lastBreakIn = entryTime;
        isOnBreak = true;
      } else if (status === 4 && lastBreakIn) {
        totalBreakMs += (entryTime - lastBreakIn);
        lastBreakIn = null;
        isOnBreak = false;
      }
    }

    let activeWorkMs = totalWorkMs;
    if (lastClockIn && !lastClockOutTime) {
      const now = new Date().getTime();
      if (now > lastClockIn) {
        activeWorkMs += (now - lastClockIn);
      }
    }

    const totalHoursResult = activeWorkMs / (1000 * 60 * 60);
    const netHoursResult = (activeWorkMs - totalBreakMs) / (1000 * 60 * 60);

    res.json({
      summary: {
        clockedIn: hasClockIn && !lastClockOutTime,
        shiftCompleted: hasClockIn && !!lastClockOutTime,
        lastStatus: lastStatusValue,
        clockInTime: firstClockInTime ? new Date(firstClockInTime).toISOString() : null,
        clockOutTime: lastClockOutTime ? new Date(lastClockOutTime).toISOString() : null,
        totalHours: parseFloat(totalHoursResult.toFixed(2)),
        totalBreakMinutes: Math.round(totalBreakMs / (1000 * 60)),
        netHours: parseFloat(netHoursResult.toFixed(2)),
        isOnBreak: lastStatusValue === 3,
        canClockIn: false, 
        canClockOut: lastStatusValue !== 3,
        canStartBreak: lastStatusValue !== 3,
        canEndBreak: lastStatusValue === 3
      },
    });
  } catch (err) {
    console.error("GET SUMMARY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= TIME ENTRY SAVE =================
router.post("/save", async (req, res) => {
  try {
    const { userId, status, userName, password, timestamp } = req.body;

    if (!userId || status === undefined) {
      return res.status(400).json({ message: "UserId and status required" });
    }

    const pool = await poolPromise;
    const activeOrg = await getActiveOrganization();
    const businessUnitId = activeOrg.businessUnitId;
    const currentTime = timestamp ? new Date(timestamp) : new Date();

    // Verify user credentials
    const userCheck = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId).query(`
        SELECT UserName, UserPassword, FullName
        FROM Vw_UserMaster
        WHERE UserId = @UserId AND IsDisabled = 0
      `);

    if (userCheck.recordset.length === 0) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    const user = userCheck.recordset[0];

    // Decode base64 password (same as auth.js)
    let storedPassword = user.UserPassword;
    try {
      storedPassword = Buffer.from(user.UserPassword, "base64").toString("utf8");
    } catch (e) {
      storedPassword = user.UserPassword;
    }

    if (storedPassword !== password) {
      return res.status(401).json({ message: "Invalid password" });
    }

    // Get last entry to check current status
    const lastEntryRes = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .query(`
        SELECT TOP 1 status FROM TimeEntry WHERE Userid = @UserId ORDER BY CreatedOn DESC
      `);

    const lastEntry = lastEntryRes.recordset[0];
    const lastStatus = lastEntry ? parseInt(lastEntry.status) : null;

    // Validation based on status transition
    if (status == 1) {
      // IN
      if (lastStatus !== null && lastStatus !== 0) {
        return res.status(400).json({
          message: "Already clocked in. Please clock out first.",
        });
      }
    } else if (status == 0) {
      // OUT
      if (lastStatus === null || lastStatus === 0) {
        return res.status(400).json({ message: "No clock in found. Please clock in first." });
      }
      if (lastStatus === 3) {
        return res.status(400).json({
          message: "Cannot clock out while on break. Please end break first.",
        });
      }
    } else if (status == 3) {
      // BREAK IN
      if (lastStatus === null || lastStatus === 0) {
        return res.status(400).json({ message: "Must be clocked in to take a break." });
      }
      if (lastStatus === 3) {
        return res.status(400).json({ message: "Already on break. Please end break first." });
      }
    } else if (status == 4) {
      // BREAK OUT
      if (lastStatus !== 3) {
        return res.status(400).json({ message: "Not on break. Please start break first." });
      }
    }

    // Insert time entry
    await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("Status", sql.Int, status)
      .input("ClockTime", sql.DateTime, currentTime)
      .input("BusinessUnitId", sql.UniqueIdentifier, businessUnitId)
      .input("CreatedBy", sql.UniqueIdentifier, userId).query(`
        INSERT INTO TimeEntry
        (Userid, ClockinTime, status, BusinessUnitId, CreatedBy, CreatedOn, ModifiedBy, ModifiedOn)
        VALUES
        (@UserId, @ClockTime, @Status, @BusinessUnitId, @CreatedBy, GETDATE(), @CreatedBy, GETDATE())
      `);

    // --- SYNC WITH DailyAttendance ---
    try {
      if (status == 1) {
        // IN: Create or Update DailyAttendance
        await pool.request()
          .input("UserId", sql.UniqueIdentifier, userId)
          .input("Now", sql.DateTime, currentTime)
          .input("BusinessUnitId", sql.UniqueIdentifier, businessUnitId)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM DailyAttendance WHERE DeliveryPersonId = @UserId AND EndDateTime IS NULL)
            BEGIN
              INSERT INTO DailyAttendance (DeliveryPersonId, StartDateTime, BusinessUnitId, CreatedBy, CreatedOn)
              VALUES (@UserId, @Now, @BusinessUnitId, @UserId, GETDATE())
            END
            ELSE
            BEGIN
              UPDATE DailyAttendance SET StartDateTime = @Now WHERE DeliveryPersonId = @UserId AND EndDateTime IS NULL
            END
          `);
      } else if (status == 3) {
        // BREAK IN
        await pool.request()
          .input("UserId", sql.UniqueIdentifier, userId)
          .input("Now", sql.DateTime, currentTime)
          .query(`UPDATE DailyAttendance SET BreakInTime = @Now WHERE DeliveryPersonId = @UserId AND EndDateTime IS NULL`);
      } else if (status == 4) {
        // BREAK OUT
        await pool.request()
          .input("UserId", sql.UniqueIdentifier, userId)
          .input("Now", sql.DateTime, currentTime)
          .query(`UPDATE DailyAttendance SET BreakOutTime = @Now WHERE DeliveryPersonId = @UserId AND EndDateTime IS NULL`);
      } else if (status == 0) {
        // OUT
        await pool.request()
          .input("UserId", sql.UniqueIdentifier, userId)
          .input("Now", sql.DateTime, currentTime)
          .query(`
            UPDATE DailyAttendance 
            SET EndDateTime = @Now,
                NoofHours = DATEDIFF(SECOND, StartDateTime, @Now) / 3600.0
            WHERE DeliveryPersonId = @UserId AND EndDateTime IS NULL
          `);
      }
    } catch (syncErr) {
      console.error("DailyAttendance Sync Error:", syncErr.message);
      // Don't fail the whole request if sync fails
    }

    const actionNames = { 1: "IN", 0: "OUT", 3: "BREAK IN", 4: "BREAK OUT" };
    const actionName = actionNames[status] || "ACTION";

    res.json({
      success: true,
      message: `${actionName} recorded successfully at ${currentTime.toLocaleTimeString()}`,
    });
  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Unused sync offline entries endpoint removed

// ================= GET TODAY'S ENTRIES =================
router.get("/today/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "UserId is required" });
    }

    const pool = await poolPromise;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = await pool
      .request()
      .input("UserId", sql.UniqueIdentifier, userId)
      .input("StartDate", sql.DateTime, today)
      .input("EndDate", sql.DateTime, tomorrow).query(`
        SELECT 
          status,
          CreatedOn as ClockinTime,
          CreatedOn,
          CASE 
            WHEN status = 1 THEN 'IN'
            WHEN status = 0 THEN 'OUT'
            WHEN status = 3 THEN 'BREAK IN'
            WHEN status = 4 THEN 'BREAK OUT'
          END as ActionName
        FROM TimeEntry
        WHERE Userid = @UserId 
        AND CreatedOn >= @StartDate 
        AND CreatedOn < @EndDate
        ORDER BY CreatedOn DESC
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error("GET TODAY ENTRIES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ================= GET ALL TIME LOGS (ADMIN ONLY) =================
router.get("/logs", authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Access denied. Admin role required." });
    }

    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        a.Userid,
        u.FullName AS StaffName,
        a.status,
        a.CreatedOn as ClockinTime,
        a.CreatedOn
      FROM TimeEntry a
      INNER JOIN Vw_UserMaster u ON a.Userid = u.UserId
      ORDER BY a.Userid, a.CreatedOn ASC
    `);

    const rows = result.recordset;

    // Group entries by user
    const userGroups = {};
    for (const r of rows) {
      if (!userGroups[r.Userid]) {
        userGroups[r.Userid] = {
          name: r.StaffName,
          entries: []
        };
      }
      userGroups[r.Userid].entries.push(r);
    }

    const finalLogs = [];
    for (const userId in userGroups) {
      const group = userGroups[userId];
      const name = group.name;
      const entries = group.entries;

      let currentIn = null;
      let breakInTime = null;
      let totalBreakMs = 0;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const status = parseInt(entry.status);
        const entryTime = new Date(entry.ClockinTime).getTime();

        if (status === 1) { // IN
          if (currentIn) {
            // Push previous incomplete shift
            finalLogs.push({
              UserId: userId,
              StaffName: name,
              LoginTime: currentIn,
              LogoutTime: null,
              TotalDuration: null
            });
          }
          currentIn = entry.ClockinTime;
          breakInTime = null;
          totalBreakMs = 0;
        } else if (status === 3) { // BREAK IN
          if (currentIn) {
            breakInTime = entryTime;
          }
        } else if (status === 4) { // BREAK OUT
          if (currentIn && breakInTime) {
            totalBreakMs += (entryTime - breakInTime);
            breakInTime = null;
          }
        } else if (status === 0) { // OUT
          if (currentIn) {
            const loginTimeMs = new Date(currentIn).getTime();
            const workMs = entryTime - loginTimeMs - totalBreakMs;
            const hours = workMs > 0 ? parseFloat((workMs / (1000 * 60 * 60)).toFixed(2)) : 0;
            
            finalLogs.push({
              UserId: userId,
              StaffName: name,
              LoginTime: currentIn,
              LogoutTime: entry.ClockinTime,
              TotalDuration: hours
            });
            currentIn = null;
            breakInTime = null;
            totalBreakMs = 0;
          }
        }
      }

      // If finished scanning and user is still clocked in
      if (currentIn) {
        finalLogs.push({
          UserId: userId,
          StaffName: name,
          LoginTime: currentIn,
          LogoutTime: null,
          TotalDuration: null
        });
      }
    }

    // Sort final logs descending by LoginTime
    finalLogs.sort((a, b) => new Date(b.LoginTime).getTime() - new Date(a.LoginTime).getTime());

    res.json(finalLogs);
  } catch (err) {
    console.error("GET ALL TIME LOGS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Unused check current status endpoint removed

module.exports = router;
