const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise } = require("../config/db");
const { getCompanySettings, invalidateCache } = require("../utils/settingsCache");
const { logSettingsDiff } = require("../utils/auditLogger");

// 🔹 GET Settings
router.get("/:id", async (req, res) => {
  try {
    const settings = await getCompanySettings();
    const pool = await poolPromise;
    const licenseRes = await pool.request().query("SELECT MAX(FromDate) AS FromDate, MAX(ToDate) AS ToDate FROM UserMaster");
    const license = licenseRes.recordset[0] || { FromDate: null, ToDate: null };

    if (settings) {
      res.json({ 
        success: true, 
        settings: { 
          ...settings, 
          LicenseFromDate: license.FromDate, 
          LicenseToDate: license.ToDate 
        } 
      });
    } else {
      res.status(404).json({ success: false, message: "Settings not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 POST Settings (Upsert)
router.post("/:id", async (req, res) => {
  try {
    const s = req.body;
    const pool = await poolPromise;

    // Fetch previous settings snapshot for audit comparison
    const oldSettings = (await getCompanySettings()) || {};

    const userInfo = {
      userName: s.userName || s.modifiedBy || s.user?.userName || s.user?.fullName || "",
      userId: s.userId || s.user?.userId || s.user?.id || "",
      role: s.userRole || s.user?.roleName || s.user?.role || ""
    };


    try {
      await pool.request()
        .input("CompanyName", sql.NVarChar, s.CompanyName || "My Restaurant")
        .input("Address", sql.NVarChar, s.Address || "")
        .input("GSTNo", sql.NVarChar, s.GSTNo || "")
        .input("GSTPercentage", sql.Decimal(18, 2), s.GSTPercentage !== undefined && s.GSTPercentage !== null ? s.GSTPercentage : 0)
        .input("Phone", sql.NVarChar, s.Phone || "")
        .input("Email", sql.NVarChar, s.Email || "")
        .input("CashierName", sql.NVarChar, s.CashierName || "")
        .input("Currency", sql.NVarChar, s.Currency || "SGD")
        .input("CurrencySymbol", sql.NVarChar, s.CurrencySymbol || "$")
        .input("CompanyLogoUrl", sql.NVarChar(sql.MAX), s.CompanyLogoUrl || "")
        .input("HalalLogoUrl", sql.NVarChar(sql.MAX), s.HalalLogoUrl || "")
        .input("PrinterIP", sql.NVarChar, s.PrinterIP || "")
        .input("ShowCompanyLogo", sql.Bit, s.ShowCompanyLogo ? 1 : 0)
        .input("ShowHalalLogo", sql.Bit, s.ShowHalalLogo ? 1 : 0)
        .input("TaxMode", sql.NVarChar, s.TaxMode || 'exclusive')
        .input("WaiterRequired", sql.Bit, s.WaiterRequired !== undefined && s.WaiterRequired !== null ? s.WaiterRequired : 0)
        .input("HoldOvertimeMinutes", sql.Int, s.HoldOvertimeMinutes !== undefined && s.HoldOvertimeMinutes !== null ? s.HoldOvertimeMinutes : 30)
        .input("ServiceChargePercentage", sql.Decimal(18, 2), s.ServiceChargePercentage ?? s.serviceChargePercentage ?? 0)
        .input("TWServiceChargePercentage", sql.Decimal(10, 2), s.TWServiceChargePercentage ?? s.twServiceChargePercentage ?? 0)
        .input("SVCIdentification", sql.Bit, s.SVCIdentification !== undefined && s.SVCIdentification !== null ? (s.SVCIdentification ? 1 : 0) : 1)
        .input("TakeawayCharges", sql.Decimal(18, 2), s.TakeawayCharges !== undefined && s.TakeawayCharges !== null ? s.TakeawayCharges : 0)
        .input("UpiId", sql.NVarChar, s.UpiId || "")
        .input("ReportEmail", sql.NVarChar, s.ReportEmail ?? s.reportEmail ?? "")
        .query(`
          IF EXISTS (SELECT 1 FROM CompanySettings WHERE Id = '1')
          BEGIN
            UPDATE CompanySettings SET
              CompanyName = @CompanyName,
              Address = @Address,
              GSTNo = @GSTNo,
              GSTPercentage = @GSTPercentage,
              Phone = @Phone,
              Email = @Email,
              CashierName = @CashierName,
              Currency = @Currency,
              CurrencySymbol = @CurrencySymbol,
              CompanyLogoUrl = @CompanyLogoUrl,
              HalalLogoUrl = @HalalLogoUrl,
              PrinterIP = @PrinterIP,
              ShowCompanyLogo = @ShowCompanyLogo,
              ShowHalalLogo = @ShowHalalLogo,
              TaxMode = @TaxMode,
              WaiterRequired = @WaiterRequired,
              HoldOvertimeMinutes = @HoldOvertimeMinutes,
              ServiceChargePercentage = @ServiceChargePercentage,
              TWServiceChargePercentage = @TWServiceChargePercentage,
              SVCIdentification = @SVCIdentification,
              TakeawayCharges = @TakeawayCharges,
              UpiId = @UpiId,
              ReportEmail = @ReportEmail,
              UpdatedOn = GETDATE()
            WHERE Id = '1'
          END
          ELSE
          BEGIN
            INSERT INTO CompanySettings (Id, CompanyName, Address, GSTNo, GSTPercentage, Phone, Email, CashierName, Currency, CurrencySymbol, CompanyLogoUrl, HalalLogoUrl, PrinterIP, ShowCompanyLogo, ShowHalalLogo, TaxMode, WaiterRequired, HoldOvertimeMinutes, ServiceChargePercentage, TWServiceChargePercentage, SVCIdentification, TakeawayCharges, UpiId, ReportEmail, UpdatedOn)
            VALUES ('1', @CompanyName, @Address, @GSTNo, @GSTPercentage, @Phone, @Email, @CashierName, @Currency, @CurrencySymbol, @CompanyLogoUrl, @HalalLogoUrl, @PrinterIP, @ShowCompanyLogo, @ShowHalalLogo, @TaxMode, @WaiterRequired, @HoldOvertimeMinutes, @ServiceChargePercentage, @TWServiceChargePercentage, @SVCIdentification, @TakeawayCharges, @UpiId, @ReportEmail, GETDATE())
          END
        `);
    } catch (fullQueryErr) {
      console.warn("⚠️ [CompanySettings] Full query failed, attempting basic update fallback:", fullQueryErr.message);
      await pool.request()
        .input("CompanyName", sql.NVarChar, s.CompanyName || "My Restaurant")
        .input("Address", sql.NVarChar, s.Address || "")
        .input("GSTNo", sql.NVarChar, s.GSTNo || "")
        .input("GSTPercentage", sql.Decimal(18, 2), s.GSTPercentage || 0)
        .input("Phone", sql.NVarChar, s.Phone || "")
        .input("Email", sql.NVarChar, s.Email || "")
        .input("Currency", sql.NVarChar, s.Currency || "SGD")
        .input("CurrencySymbol", sql.NVarChar, s.CurrencySymbol || "$")
        .input("CompanyLogoUrl", sql.NVarChar(sql.MAX), s.CompanyLogoUrl || "")
        .input("HalalLogoUrl", sql.NVarChar(sql.MAX), s.HalalLogoUrl || "")
        .input("ShowCompanyLogo", sql.Bit, s.ShowCompanyLogo ? 1 : 0)
        .input("ShowHalalLogo", sql.Bit, s.ShowHalalLogo ? 1 : 0)
        .input("ServiceChargePercentage", sql.Decimal(18, 2), s.ServiceChargePercentage ?? s.serviceChargePercentage ?? 0)
        .input("TWServiceChargePercentage", sql.Decimal(10, 2), s.TWServiceChargePercentage ?? s.twServiceChargePercentage ?? 0)
        .input("TakeawayCharges", sql.Decimal(18, 2), s.TakeawayCharges || 0)
        .input("ReportEmail", sql.NVarChar, s.ReportEmail ?? s.reportEmail ?? "")
        .query(`
          UPDATE CompanySettings SET
            CompanyName = @CompanyName,
            Address = @Address,
            GSTNo = @GSTNo,
            GSTPercentage = @GSTPercentage,
            Phone = @Phone,
            Email = @Email,
            Currency = @Currency,
            CurrencySymbol = @CurrencySymbol,
            CompanyLogoUrl = @CompanyLogoUrl,
            HalalLogoUrl = @HalalLogoUrl,
            ShowCompanyLogo = @ShowCompanyLogo,
            ShowHalalLogo = @ShowHalalLogo,
            ServiceChargePercentage = @ServiceChargePercentage,
            TWServiceChargePercentage = @TWServiceChargePercentage,
            TakeawayCharges = @TakeawayCharges,
            ReportEmail = @ReportEmail
          WHERE Id = '1'
        `);
    }

    // Synchronize to PrintMaster (Receipt Printer where PrinterType = 1)
    if (s.PrinterIP) {
      try {
        await pool.request()
          .input("ip", sql.NVarChar, s.PrinterIP)
          .query("UPDATE PrintMaster SET PrinterPath = @ip, PrinterIP = @ip WHERE PrinterType = 1");
      } catch (pmErr) {
        console.warn("⚠️ PrintMaster sync ignored:", pmErr.message);
      }
    }

    invalidateCache();

    // Log settings audit changes asynchronously
    try {
      await logSettingsDiff(pool, oldSettings, s, userInfo);
    } catch (auditErr) {
      console.warn("⚠️ Audit log error ignored:", auditErr.message);
    }

    res.json({ success: true, message: "Settings saved successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 DELETE Settings
router.delete("/:id", async (req, res) => {
  try {
    const pool = await poolPromise;
    await pool.request()
      .query("DELETE FROM CompanySettings WHERE Id = '1'");
    invalidateCache();
    res.json({ success: true, message: "Settings deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
