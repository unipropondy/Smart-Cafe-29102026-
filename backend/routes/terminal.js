const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");

// Helper to sanitize row values
const sanitizeRow = (row) => ({
  TerminalCode: (row.TerminalCode || "").trim(),
  TerminalName: (row.TerminalName || "").trim(),
  LocationCode: (row.LocationCode || "").trim(),
  ComputerName: (row.ComputerName || "").trim(),
  TillAmount: row.TillAmount || 0,
  TerminalType: (row.TerminalType || "").trim(),
  PrintType: (row.PrintType || "").trim(),
  ImagePath: (row.ImagePath || "").trim(),
  IdleTime: row.IdleTime || 0,
  isCustDisplayAttached: !!row.isCustDisplayAttached,
  isSecondDisplayAttached: !!row.isSecondDisplayAttached,
  SecondDisplayPort: (row.SecondDisplayPort || "").trim(),
  DisplayType: (row.DisplayType || "").trim(),
  PrinterRequired: !!row.PrinterRequired
});

// 🔹 GET ALL Terminals
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        TerminalCode, 
        TerminalName, 
        LocationCode,
        ComputerName,
        TillAmount,
        TerminalType,
        PrintType,
        ImagePath,
        IdleTime,
        isCustDisplayAttached, 
        isSecondDisplayAttached, 
        SecondDisplayPort, 
        DisplayType, 
        PrinterRequired
      FROM TerminalMaster
    `);
    
    const cleaned = (result.recordset || []).map(sanitizeRow);
    res.json(cleaned);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 POST Create a new Terminal
router.post("/", async (req, res) => {
  try {
    const { 
      TerminalCode,
      TerminalName, 
      LocationCode,
      ComputerName,
      TillAmount,
      TerminalType,
      PrintType,
      ImagePath,
      IdleTime,
      isCustDisplayAttached, 
      isSecondDisplayAttached, 
      DisplayType,
      SecondDisplayPort, 
      PrinterRequired 
    } = req.body;

    if (!TerminalCode || !TerminalName) {
      return res.status(400).json({ error: "TerminalCode and TerminalName are required." });
    }
    
    const pool = await poolPromise;

    // Check duplicate first
    const checkDup = await pool.request()
      .input("TerminalCode", sql.VarChar, TerminalCode.trim())
      .query("SELECT COUNT(*) as count FROM TerminalMaster WHERE TerminalCode = @TerminalCode");
    
    if (checkDup.recordset[0].count > 0) {
      return res.status(400).json({ error: `Terminal Code "${TerminalCode}" already exists.` });
    }

    // Default admin UserId/Guid for auditing fields
    const defaultGuid = "00000000-0000-0000-0000-000000000000";

    await pool.request()
      .input("TerminalCode", sql.VarChar, TerminalCode.trim())
      .input("TerminalName", sql.NVarChar, TerminalName.trim())
      .input("LocationCode", sql.VarChar, LocationCode || "")
      .input("ComputerName", sql.VarChar, ComputerName || TerminalCode.trim())
      .input("TillAmount", sql.Decimal(18, 2), TillAmount || 0)
      .input("TerminalType", sql.VarChar, TerminalType || "")
      .input("PrintType", sql.Char(1), PrintType || "")
      .input("ImagePath", sql.VarChar, ImagePath || "")
      .input("IdleTime", sql.Int, IdleTime || 0)
      .input("isCustDisplayAttached", sql.Bit, isCustDisplayAttached ? 1 : 0)
      .input("isSecondDisplayAttached", sql.Bit, isSecondDisplayAttached ? 1 : 0)
      .input("DisplayType", sql.NVarChar, DisplayType || "SOCKET")
      .input("SecondDisplayPort", sql.NVarChar, SecondDisplayPort || "")
      .input("PrinterRequired", sql.Bit, PrinterRequired ? 1 : 0)
      .input("CreateUser", sql.UniqueIdentifier, defaultGuid)
      .query(`
        INSERT INTO TerminalMaster
        (
            TerminalId,
            TerminalCode,
            TerminalName,
            LocationCode,
            ComputerName,
            TillAmount,
            TerminalType,
            PrintType,
            ImagePath,
            IdleTime,
            isCustDisplayAttached,
            isSecondDisplayAttached,
            DisplayType,
            SecondDisplayPort,
            PrinterRequired,
            CreateUser,
            CreateDate
        )
        VALUES
        (
            NEWID(),
            @TerminalCode,
            @TerminalName,
            @LocationCode,
            @ComputerName,
            @TillAmount,
            @TerminalType,
            @PrintType,
            @ImagePath,
            @IdleTime,
            @isCustDisplayAttached,
            @isSecondDisplayAttached,
            @DisplayType,
            @SecondDisplayPort,
            @PrinterRequired,
            @CreateUser,
            GETDATE()
        )
      `);

    res.json({ success: true, message: "Terminal created successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 GET Terminal settings by TerminalCode
router.get("/:terminalCode", async (req, res) => {
  try {
    const { terminalCode } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input("TerminalCode", sql.VarChar, terminalCode)
      .query(`
        SELECT TOP 1 
          TerminalCode, 
          TerminalName, 
          LocationCode,
          ComputerName,
          TillAmount,
          TerminalType,
          PrintType,
          ImagePath,
          IdleTime,
          isCustDisplayAttached, 
          isSecondDisplayAttached, 
          SecondDisplayPort, 
          DisplayType, 
          PrinterRequired 
        FROM TerminalMaster 
        WHERE TerminalCode = @TerminalCode
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Terminal not found" });
    }

    res.json(sanitizeRow(result.recordset[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 UPDATE Terminal settings by TerminalCode
router.put("/:terminalCode", async (req, res) => {
  try {
    const { terminalCode } = req.params;
    const { 
      TerminalName, 
      LocationCode,
      ComputerName,
      TillAmount,
      TerminalType,
      PrintType,
      ImagePath,
      IdleTime,
      isCustDisplayAttached, 
      isSecondDisplayAttached, 
      SecondDisplayPort, 
      DisplayType, 
      PrinterRequired 
    } = req.body;
    
    const pool = await poolPromise;
    await pool.request()
      .input("TerminalCode", sql.VarChar, terminalCode)
      .input("TerminalName", sql.NVarChar, TerminalName || "")
      .input("LocationCode", sql.VarChar, LocationCode || "")
      .input("ComputerName", sql.VarChar, ComputerName || "")
      .input("TillAmount", sql.Decimal(18, 2), TillAmount || 0)
      .input("TerminalType", sql.VarChar, TerminalType || "")
      .input("PrintType", sql.Char(1), PrintType || "")
      .input("ImagePath", sql.VarChar, ImagePath || "")
      .input("IdleTime", sql.Int, IdleTime || 0)
      .input("isCustDisplayAttached", sql.Bit, isCustDisplayAttached ? 1 : 0)
      .input("isSecondDisplayAttached", sql.Bit, isSecondDisplayAttached ? 1 : 0)
      .input("SecondDisplayPort", sql.NVarChar, SecondDisplayPort || "")
      .input("DisplayType", sql.NVarChar, DisplayType || "")
      .input("PrinterRequired", sql.Bit, PrinterRequired ? 1 : 0)
      .query(`
        UPDATE TerminalMaster
        SET
          TerminalName = @TerminalName,
          LocationCode = @LocationCode,
          ComputerName = @ComputerName,
          TillAmount = @TillAmount,
          TerminalType = @TerminalType,
          PrintType = @PrintType,
          ImagePath = @ImagePath,
          IdleTime = @IdleTime,
          isCustDisplayAttached = @isCustDisplayAttached,
          isSecondDisplayAttached = @isSecondDisplayAttached,
          SecondDisplayPort = @SecondDisplayPort,
          DisplayType = @DisplayType,
          PrinterRequired = @PrinterRequired
        WHERE TerminalCode = @TerminalCode
      `);

    res.json({ success: true, message: "Terminal updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
