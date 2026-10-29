const sql = require("mssql");

// Human-readable labels and category mappings for tracked settings fields
const FIELD_DEFINITIONS = {
  // Company / Shop Settings
  CompanyName: { category: "STORE_INFO", label: "Shop Name" },
  Address: { category: "STORE_INFO", label: "Address" },
  Phone: { category: "STORE_INFO", label: "Phone" },
  Email: { category: "STORE_INFO", label: "Email" },
  CashierName: { category: "STORE_INFO", label: "Cashier Name" },
  HoldOvertimeMinutes: { category: "STORE_INFO", label: "Hold Overtime (Mins)" },
  WaiterRequired: { category: "STORE_INFO", label: "Waiter Required" },
  
  // Tax & Currency Settings
  GSTNo: { category: "TAX_CURRENCY", label: "GST Number" },
  GSTPercentage: { category: "TAX_CURRENCY", label: "GST (%)" },
  ServiceChargePercentage: { category: "TAX_CURRENCY", label: "Service Charge (%)" },
  TWServiceChargePercentage: { category: "TAX_CURRENCY", label: "TW Service Charge (%)" },
  TakeawayCharges: { category: "TAX_CURRENCY", label: "Takeaway Charge" },
  Currency: { category: "TAX_CURRENCY", label: "Currency Code" },
  CurrencySymbol: { category: "TAX_CURRENCY", label: "Currency Symbol" },
  TaxMode: { category: "TAX_CURRENCY", label: "Tax Mode" },
  SVCIdentification: { category: "TAX_CURRENCY", label: "Service Charge ID" },
  UpiId: { category: "TAX_CURRENCY", label: "PayNow / UPI ID" },
  UPI_ID: { category: "TAX_CURRENCY", label: "PayNow / UPI ID" },
  
  // Branding
  CompanyLogoUrl: { category: "BRANDING", label: "Company Logo" },
  HalalLogoUrl: { category: "BRANDING", label: "Halal Logo" },
  ShowCompanyLogo: { category: "BRANDING", label: "Show Company Logo on Bill" },
  ShowHalalLogo: { category: "BRANDING", label: "Show Halal Logo on Bill" },

  // General App Settings & Feature Toggles
  ShopName: { category: "STORE_INFO", label: "Shop Name" },
  PayNow_QR_Url: { category: "BRANDING", label: "PayNow QR Image" },
  EnableKOT: { category: "GENERAL_SETTINGS", label: "Enable KOT" },
  EnableKDS: { category: "GENERAL_SETTINGS", label: "Enable KDS" },
  EnableCheckoutBill: { category: "GENERAL_SETTINGS", label: "Enable Checkout Bill" },
  EnableCheckoutFlow: { category: "GENERAL_SETTINGS", label: "Enable Checkout Flow" },
  EnableDirectProcessToPay: { category: "GENERAL_SETTINGS", label: "Enable Direct Process To Pay" },
  CustomerSideDisplay: { category: "GENERAL_SETTINGS", label: "Customer Display" },
  EnableGuestDetailsPopup: { category: "GENERAL_SETTINGS", label: "Enable Guest Popup" },
  EnableCashDrawer: { category: "GENERAL_SETTINGS", label: "Enable Cash Drawer" },
  EnableKDSPrint: { category: "GENERAL_SETTINGS", label: "Enable KDS Print" },
  EnableCombo: { category: "GENERAL_SETTINGS", label: "Enable Combo Dishes" },
  EnableQuickServe: { category: "GENERAL_SETTINGS", label: "Quick Serve Feature" },
  ShowLoyalty: { category: "GENERAL_SETTINGS", label: "Show Loyalty" },
  ShowRewardPoints: { category: "GENERAL_SETTINGS", label: "Show Reward Points" },
  ShowPromoCode: { category: "GENERAL_SETTINGS", label: "Show Promo Code" },
  EnableOnlinePayment: { category: "GENERAL_SETTINGS", label: "Enable Online Payment" },
  EnableQROrderAutoPrint: { category: "GENERAL_SETTINGS", label: "Enable QR Auto Print" },
  EnableComboPrint: { category: "GENERAL_SETTINGS", label: "Enable Combo Print" },
  EnableRequestService: { category: "GENERAL_SETTINGS", label: "Enable Request Service" },
  EnableCookingInstructions: { category: "GENERAL_SETTINGS", label: "Enable Cooking Notes" },
  EnableDirectPaymentToProcess: { category: "GENERAL_SETTINGS", label: "Direct Payment to Process" },
  EnableSkipSummaryScreen: { category: "GENERAL_SETTINGS", label: "Skip Summary Screen" },
  EnableReceiptPrint: { category: "GENERAL_SETTINGS", label: "Enable Receipt Print" },
  EnableVoiceSuccess: { category: "GENERAL_SETTINGS", label: "Enable Voice Announcement" },
  EnableNotificationSound: { category: "GENERAL_SETTINGS", label: "Enable Notification Sound" }
};

// Fields explicitly excluded from audit logging (e.g. Printer IPs)
const EXCLUDED_FIELDS = new Set([
  "PrinterIP",
  "printerIp",
  "cashierIp",
  "takeawayIp",
  "kdsIp",
  "printers",
  "UpdatedOn",
  "Id"
]);

/**
 * Ensures SettingsAuditLog table exists in SQL database.
 */
async function initSettingsAuditTable(pool) {
  try {
    await pool.query(`
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SettingsAuditLog]') AND type in (N'U'))
      BEGIN
        CREATE TABLE dbo.SettingsAuditLog (
          AuditId UNIQUEIDENTIFIER DEFAULT NEWID() PRIMARY KEY,
          Category NVARCHAR(50) NOT NULL,
          FieldName NVARCHAR(100) NOT NULL,
          FieldLabel NVARCHAR(100) NOT NULL,
          OldValue NVARCHAR(MAX) NULL,
          NewValue NVARCHAR(MAX) NULL,
          ModifiedBy NVARCHAR(100) NOT NULL,
          UserId NVARCHAR(50) NULL,
          UserRole NVARCHAR(50) NULL,
          CreatedAt DATETIME DEFAULT DATEADD(MINUTE, 480, GETUTCDATE())
        );
        CREATE INDEX IX_SettingsAuditLog_CreatedAt ON dbo.SettingsAuditLog(CreatedAt DESC);
        CREATE INDEX IX_SettingsAuditLog_Category ON dbo.SettingsAuditLog(Category);
      END

      -- Auto-purge legacy false-diff records and test 'Admin' records
      DELETE FROM dbo.SettingsAuditLog
      WHERE OldValue = NewValue
         OR OldValue IS NULL OR NewValue IS NULL OR OldValue = '' OR NewValue = ''
         OR (OldValue = 'Disabled' AND NewValue = 'Disabled')
         OR (OldValue = 'Enabled' AND NewValue = 'Enabled')
         OR ModifiedBy IS NULL OR ModifiedBy = '' OR ModifiedBy = 'Admin' OR ModifiedBy = 'ADMIN';
    `);
  } catch (err) {
    console.warn("⚠️ [AuditLogger] Self-healing table check warning:", err.message);
  }
}

/**
 * Formats values for display (converts null/undefined/boolean/numbers to clean string).
 */
function formatValue(val) {
  if (val === null || val === undefined) return "Disabled";
  if (typeof val === "boolean" || val === 1 || val === 0) {
    return (val === true || val === 1) ? "Enabled" : "Disabled";
  }
  const strVal = String(val).trim();
  if (strVal.toLowerCase() === "true" || strVal === "1") return "Enabled";
  if (strVal.toLowerCase() === "false" || strVal === "0") return "Disabled";
  if (!strVal) return "Disabled";
  return strVal;
}

/**
 * Compares oldRecord vs newRecord and inserts audit entries for changed fields.
 */
async function logSettingsDiff(pool, oldRecord = {}, newRecord = {}, userInfo = {}) {
  try {
    await initSettingsAuditTable(pool);

    let modifiedBy = userInfo.userName || userInfo.modifiedBy || userInfo.name || userInfo.fullName || "";
    let userId = userInfo.userId || userInfo.id || "";
    let userRole = userInfo.role || userInfo.userRole || "";

    // Fail-safe: If user info was missing from request payload, resolve from UserMaster
    if (!modifiedBy || !userId) {
      try {
        const lastUserRes = await pool.request().query(`
          SELECT TOP 1 u.UserName, u.UserId, u.FullName, g.UserGroupName AS RoleName
          FROM [dbo].[UserMaster] u
          LEFT JOIN [dbo].[UserGroupMaster] g ON u.UserGroupid = g.UserGroupId
          WHERE u.LastLogInDate IS NOT NULL AND (u.IsDisabled IS NULL OR u.IsDisabled = 0)
          ORDER BY u.LastLogInDate DESC
        `);
        if (lastUserRes.recordset.length > 0) {
          const lu = lastUserRes.recordset[0];
          modifiedBy = modifiedBy || lu.UserName || lu.FullName || "";
          userId = userId || String(lu.UserId || "");
          userRole = userRole || lu.RoleName || "";
        }
      } catch (dbUserErr) {
        console.warn("⚠️ Could not fetch last logged-in user fallback:", dbUserErr.message);
      }
    }

    const auditEntries = [];

    for (const key of Object.keys(newRecord)) {
      if (EXCLUDED_FIELDS.has(key)) continue;

      const def = FIELD_DEFINITIONS[key];
      if (!def) continue; // Only log defined settings fields

      const oldValRaw = oldRecord[key];
      const newValRaw = newRecord[key];

      const oldFormatted = formatValue(oldValRaw);
      const newFormatted = formatValue(newValRaw);

      // Check if value changed
      if (oldFormatted !== newFormatted) {
        auditEntries.push({
          category: def.category,
          fieldName: key,
          fieldLabel: def.label,
          oldValue: oldFormatted,
          newValue: newFormatted
        });
      }
    }

    if (auditEntries.length === 0) return;

    for (const entry of auditEntries) {
      await pool.request()
        .input("Category", sql.NVarChar, entry.category)
        .input("FieldName", sql.NVarChar, entry.fieldName)
        .input("FieldLabel", sql.NVarChar, entry.fieldLabel)
        .input("OldValue", sql.NVarChar(sql.MAX), entry.oldValue)
        .input("NewValue", sql.NVarChar(sql.MAX), entry.newValue)
        .input("ModifiedBy", sql.NVarChar, modifiedBy)
        .input("UserId", sql.NVarChar, String(userId))
        .input("UserRole", sql.NVarChar, userRole)
        .query(`
          INSERT INTO dbo.SettingsAuditLog (Category, FieldName, FieldLabel, OldValue, NewValue, ModifiedBy, UserId, UserRole, CreatedAt)
          VALUES (@Category, @FieldName, @FieldLabel, @OldValue, @NewValue, @ModifiedBy, @UserId, @UserRole, DATEADD(MINUTE, 480, GETUTCDATE()))
        `);
    }

    console.log(`✅ [AuditLogger] Inserted ${auditEntries.length} settings audit log entry(s) by user '${modifiedBy}'`);
  } catch (err) {
    console.error("❌ [AuditLogger] Error writing settings audit log:", err);
  }
}

module.exports = {
  initSettingsAuditTable,
  logSettingsDiff,
  FIELD_DEFINITIONS
};
