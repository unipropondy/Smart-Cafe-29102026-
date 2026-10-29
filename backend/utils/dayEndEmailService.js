/**
 * dayEndEmailService.js
 * Handles automatic Daily Sales Report generation and email delivery upon Day End settlement.
 * Features:
 * - Dynamic recipient email from Shop Settings (CompanySettings.ReportEmail)
 * - Strict multi-tenant isolation (uses request tenant pool directly)
 * - Safe idempotency & duplicate prevention (database log + memory lock)
 * - Non-blocking delivery (settlement succeeds even if mail server fails)
 * - Full HTML executive summary + attached high-resolution PDF report
 * - Displays both Date and Time for Day End Settlement and Report Generation
 * - Safe retry capability
 */

"use strict";

const { sql } = require("../config/db");
const { createMailTransporter } = require("./mailTransporter");
const { fetchFullReportData } = require("./reportDataFetcher");
const { generateSalesReportPdf, createPdfBinary } = require("./pdfReportGenerator");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// In-memory set to prevent concurrent race conditions on double-click
const activeSendingLocks = new Set();

/**
 * Ensures the DayEndEmailLog table exists with all required columns in the target tenant database.
 */
async function ensureDayEndEmailLogTable(pool) {
  try {
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DayEndEmailLog')
      BEGIN
        CREATE TABLE DayEndEmailLog (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          BusinessDate DATE NOT NULL,
          RecipientEmail NVARCHAR(255) NOT NULL,
          Status NVARCHAR(50) NOT NULL, -- 'SENDING', 'SENT', 'FAILED', 'SKIPPED_NO_EMAIL'
          SentAt DATETIME NULL,
          AttemptCount INT DEFAULT 1,
          ErrorMessage NVARCHAR(MAX) NULL,
          MessageId NVARCHAR(255) NULL,
          CreatedAt DATETIME DEFAULT GETDATE(),
          UpdatedAt DATETIME DEFAULT GETDATE(),
          CONSTRAINT UQ_DayEndEmail_BusinessDate UNIQUE (BusinessDate)
        );
      END
      ELSE
      BEGIN
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DayEndEmailLog') AND name = 'UpdatedAt')
          ALTER TABLE DayEndEmailLog ADD UpdatedAt DATETIME DEFAULT GETDATE();
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DayEndEmailLog') AND name = 'AttemptCount')
          ALTER TABLE DayEndEmailLog ADD AttemptCount INT DEFAULT 1;
        IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('DayEndEmailLog') AND name = 'MessageId')
          ALTER TABLE DayEndEmailLog ADD MessageId NVARCHAR(255) NULL;
      END
    `);
  } catch (err) {
    console.warn("⚠️ [DayEndEmail] Failed to check/create DayEndEmailLog table:", err.message);
  }
}

/**
 * Fallback date formatter: 'YYYY-MM-DD' -> '29-Oct-2026'
 */
function formatCustomDate(d) {
  if (!d) return "";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    const [y, m, day] = d.trim().split("-");
    const monthName = MONTH_NAMES[parseInt(m, 10) - 1] || m;
    return `${parseInt(day, 10).toString().padStart(2, "0")}-${monthName}-${y}`;
  }
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const day = String(date.getDate()).padStart(2, "0");
  const monthName = MONTH_NAMES[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${monthName}-${year}`;
}

/**
 * Fallback date-time formatter: Date -> '29-Oct-2026 11:30 AM'
 */
function formatCustomDateTime(d, timezone = "Asia/Singapore") {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "Asia/Singapore",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);

    const map = {};
    parts.forEach((p) => (map[p.type] = p.value));
    return `${map.day}-${map.month}-${map.year} ${map.hour}:${map.minute} ${map.dayPeriod}`;
  } catch {
    const day = String(date.getDate()).padStart(2, "0");
    const monthName = MONTH_NAMES[date.getMonth()];
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${day}-${monthName}-${year} ${hours}:${minutes} ${ampm}`;
  }
}

/**
 * Formats a currency value with 2 decimals.
 */
function formatCurrency(val, symbol = "$") {
  const num = Number(val || 0);
  return `${symbol}${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Builds a responsive, professional HTML email summary for the business day.
 */
function buildEmailHtml({
  reportData,
  businessDateDisplay,
  dayEndCompletedAt,
  reportGeneratedAt,
  companySettings,
  user,
}) {
  const curr = companySettings?.CurrencySymbol || "$";
  const shopName = companySettings?.CompanyName || reportData.companyName || "My Restaurant";
  const address = companySettings?.Address || reportData.companyAddress || "";
  const phone = companySettings?.Phone || reportData.companyPhone || "";
  const totalSales = formatCurrency(reportData.totalSales, curr);
  const totalCollections = formatCurrency(reportData.totalCollections, curr);
  const totalOrders = reportData.totalOrders || reportData.reconciliation?.totalTransactions || 0;
  const totalItems = reportData.totalItems || 0;
  const voidAmount = formatCurrency(reportData.voidAmount, curr);

  // Active payment breakdown rows
  const paymentRows = Object.entries(reportData.paymentBreakdown || {})
    .filter(([_, amount]) => Number(amount) > 0)
    .map(([mode, amount]) => {
      const count = reportData.paymentCounts?.[mode] || "-";
      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">${mode}</td>
          <td style="padding: 10px 12px; text-align: center; color: #64748b;">${count}</td>
          <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: #0f172a;">${formatCurrency(amount, curr)}</td>
        </tr>
      `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Sales Report - ${dayEndCompletedAt}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 620px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    <!-- Header -->
    <tr>
      <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px 24px; text-align: center; color: #ffffff;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #f97316; font-weight: 700; margin-bottom: 6px;">Day End Settlement</div>
        <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">${shopName}</h1>
        <p style="margin: 6px 0 0 0; font-size: 14px; color: #94a3b8;">Daily Sales Report &bull; <strong style="color: #ffffff;">${businessDateDisplay}</strong></p>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding: 24px;">
        <!-- Settlement Details Card -->
        <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 16px; border-radius: 6px; margin-bottom: 24px;">
          <div style="font-size: 14px; color: #9a3412; font-weight: 700; margin-bottom: 8px;">
            ✅ Settlement Completed Successfully
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 13px; line-height: 1.6; border-collapse: collapse;">
            <tr>
              <td style="padding: 3px 0; color: #7c2d12; font-weight: 600; width: 180px;">Business Date:</td>
              <td style="padding: 3px 0; color: #0f172a; font-weight: 700;">${businessDateDisplay}</td>
            </tr>
            <tr>
              <td style="padding: 3px 0; color: #7c2d12; font-weight: 600;">Day End Completed At:</td>
              <td style="padding: 3px 0; color: #ea580c; font-weight: 700;">${dayEndCompletedAt}</td>
            </tr>
            <tr>
              <td style="padding: 3px 0; color: #7c2d12; font-weight: 600;">Report Generated At:</td>
              <td style="padding: 3px 0; color: #0f172a; font-weight: 600;">${reportGeneratedAt}</td>
            </tr>
            <tr>
              <td style="padding: 3px 0; color: #7c2d12; font-weight: 600;">Settled By:</td>
              <td style="padding: 3px 0; color: #0f172a; font-weight: 600;">${user || "Cashier"}</td>
            </tr>
          </table>
        </div>

        <!-- KPI Grid -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
          <tr>
            <td width="48%" style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600;">Total Sales</div>
              <div style="font-size: 22px; font-weight: 800; color: #ea580c; margin-top: 4px;">${totalSales}</div>
            </td>
            <td width="4%"></td>
            <td width="48%" style="background-color: #f1f5f9; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600;">Total Collections</div>
              <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 4px;">${totalCollections}</div>
            </td>
          </tr>
          <tr><td height="12" colspan="3"></td></tr>
          <tr>
            <td width="48%" style="background-color: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600;">Invoices / Orders</div>
              <div style="font-size: 18px; font-weight: 700; color: #334155; margin-top: 4px;">${totalOrders} <span style="font-size: 12px; font-weight: 400; color: #64748b;">(${totalItems} items)</span></div>
            </td>
            <td width="4%"></td>
            <td width="48%" style="background-color: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600;">Voids & Cancellations</div>
              <div style="font-size: 18px; font-weight: 700; color: #ef4444; margin-top: 4px;">${voidAmount}</div>
            </td>
          </tr>
        </table>

        <!-- Payment Breakdown -->
        <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 700; color: #0f172a;">Payment Method Breakdown</h3>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin-bottom: 24px; font-size: 13px;">
          <thead>
            <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 10px 12px; text-align: left; font-weight: 700; color: #475569;">Payment Mode</th>
              <th style="padding: 10px 12px; text-align: center; font-weight: 700; color: #475569;">Transactions</th>
              <th style="padding: 10px 12px; text-align: right; font-weight: 700; color: #475569;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${paymentRows || '<tr><td colspan="3" style="padding: 12px; text-align: center; color: #94a3b8;">No payment transactions recorded.</td></tr>'}
          </tbody>
        </table>

        <!-- Attachment Notice Banner -->
        <div style="background-color: #f1f5f9; padding: 14px 18px; border-radius: 8px; border: 1px dashed #cbd5e1; text-align: center;">
          <span style="font-size: 18px; vertical-align: middle; margin-right: 6px;">📎</span>
          <span style="font-size: 13px; font-weight: 600; color: #334155;">Comprehensive Sales Report Attached:</span>
          <span style="font-size: 13px; color: #64748b;">Daily_Sales_Report_${businessDateDisplay}.pdf</span>
        </div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
        <p style="margin: 0 0 4px 0; font-weight: 600; color: #475569;">${shopName}</p>
        ${address ? `<p style="margin: 0 0 4px 0;">${address}</p>` : ""}
        ${phone ? `<p style="margin: 0 0 4px 0;">Phone: ${phone}</p>` : ""}
        <p style="margin: 10px 0 0 0; font-size: 11px; color: #94a3b8;">This is an automated sales report generated upon Day End settlement. Please do not reply directly to this email.</p>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Sends the Day End Sales Report email for the given business day.
 *
 * @param {object} params
 * @param {object} params.pool MSSQL Connection Pool for the specific tenant database
 * @param {string} params.businessDateStr Business date formatted as 'YYYY-MM-DD'
 * @param {string} params.user Cashier/admin username who triggered Day End
 * @param {string} [params.databaseName] Tenant database name for lock keying
 * @param {string} [params.companyCode] Optional company code
 * @param {boolean} [params.forceRetry] Whether this is a manual retry bypassing previous status check
 * @returns {Promise<{ sent: boolean, recipient?: string, messageId?: string, skipped?: boolean, reason?: string, error?: string }>}
 */
async function sendDayEndSalesReportEmail({
  pool,
  businessDateStr,
  user = "admin",
  databaseName = "DEFAULT",
  companyCode = "",
  forceRetry = false,
}) {
  if (!pool) {
    throw new Error("[DayEndEmail] Database connection pool is required.");
  }
  if (!businessDateStr || typeof businessDateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(businessDateStr.trim())) {
    throw new Error(`[DayEndEmail] Invalid businessDateStr: "${businessDateStr}". Expected YYYY-MM-DD.`);
  }

  const cleanDateStr = businessDateStr.trim();
  const dbKey = (databaseName || pool?.config?.database || "DEFAULT").toUpperCase();
  const lockKey = `${dbKey}_${cleanDateStr}`;

  // 1. In-memory concurrency guard to prevent race condition on instant double-clicks
  if (activeSendingLocks.has(lockKey) && !forceRetry) {
    console.log(`[DayEndEmail] Email generation already in progress for ${lockKey}. Skipping duplicate.`);
    return {
      sent: false,
      skipped: true,
      reason: "ALREADY_PROCESSING",
      message: "Sales report email is currently being generated and sent.",
    };
  }

  activeSendingLocks.add(lockKey);

  try {
    // 2. Ensure log table exists
    await ensureDayEndEmailLogTable(pool);

    // 3. Database idempotency check: check if already sent
    if (!forceRetry) {
      const existingRes = await pool
        .request()
        .input("businessDate", sql.Date, cleanDateStr)
        .query(`
          SELECT TOP 1 Status, RecipientEmail, SentAt, MessageId 
          FROM DayEndEmailLog 
          WHERE BusinessDate = @businessDate
        `);

      if (existingRes.recordset.length > 0) {
        const row = existingRes.recordset[0];
        if (row.Status === "SENT") {
          console.log(`[DayEndEmail] Report already sent for ${dbKey} on ${cleanDateStr} to ${row.RecipientEmail} at ${row.SentAt}`);
          return {
            sent: false,
            skipped: true,
            reason: "ALREADY_SENT",
            recipient: row.RecipientEmail,
            sentAt: row.SentAt,
            message: `Report was already sent to ${row.RecipientEmail}`,
          };
        }
      }
    }

    // 4. Retrieve Report Email dynamically from CompanySettings in current tenant database
    let settingsResult = await pool.request().query(`
      SELECT TOP 1 
        Id, CompanyName, Address, Phone, Email, ReportEmail, Currency, CurrencySymbol, BusinessTimezone 
      FROM CompanySettings 
      WHERE Id = '1'
    `);

    // Fallback if Id '1' doesn't exist
    if (settingsResult.recordset.length === 0 || !settingsResult.recordset[0].CompanyName) {
      const fallbackRes = await pool.request().query(`
        SELECT TOP 1 
          Id, CompanyName, Address, Phone, Email, ReportEmail, Currency, CurrencySymbol, BusinessTimezone 
        FROM CompanySettings 
        WHERE CompanyName IS NOT NULL AND CompanyName <> '' 
        ORDER BY UpdatedOn DESC
      `);
      if (fallbackRes.recordset.length > 0) {
        settingsResult = fallbackRes;
      }
    }

    const companySettings = settingsResult.recordset[0] || {};
    const rawReportEmail = (companySettings.ReportEmail || "").trim();
    const outletTimezone = companySettings.BusinessTimezone || "Asia/Singapore";

    // 5. Query actual settlement completion timestamp from the database
    let dayEndCompletedAt = null;
    let businessDateDisplay = null;
    try {
      const bDayRes = await pool
        .request()
        .input("businessDate", sql.Date, cleanDateStr)
        .query(`
          SELECT TOP 1 
            BusinessDate,
            FORMAT(CAST(BusinessDate AS DATE), 'dd-MMM-yyyy') AS FormattedBusinessDate,
            EndedAt,
            FORMAT(EndedAt, 'dd-MMM-yyyy hh:mm tt') AS FormattedEndedAt,
            EndedBy
          FROM BusinessDayLog 
          WHERE BusinessDate = @businessDate
        `);

      if (bDayRes.recordset.length > 0) {
        businessDateDisplay = bDayRes.recordset[0].FormattedBusinessDate;
        dayEndCompletedAt = bDayRes.recordset[0].FormattedEndedAt;
      }
    } catch (bErr) {
      console.warn("[DayEndEmail] Could not query BusinessDayLog formatted times:", bErr.message);
    }

    // Fallback for Day End timestamp from BusinessDayAuditLog if not found in BusinessDayLog
    if (!dayEndCompletedAt) {
      try {
        const auditTimeRes = await pool
          .request()
          .input("businessDate", sql.Date, cleanDateStr)
          .query(`
            SELECT TOP 1 
              FORMAT(EventTime, 'dd-MMM-yyyy hh:mm tt') AS FormattedEventTime
            FROM BusinessDayAuditLog
            WHERE BusinessDate = @businessDate AND EventType = 'DAY_END'
            ORDER BY EventTime DESC
          `);
        if (auditTimeRes.recordset.length > 0) {
          dayEndCompletedAt = auditTimeRes.recordset[0].FormattedEventTime;
        }
      } catch (auditErr) {
        console.warn("[DayEndEmail] Could not query BusinessDayAuditLog for Day End timestamp:", auditErr.message);
      }
    }

    // Report generation timestamp from SQL Server matching the database business time
    let reportGeneratedAt = null;
    try {
      const genTimeRes = await pool.request().query(`
        SELECT FORMAT(DATEADD(MINUTE, 480, GETUTCDATE()), 'dd-MMM-yyyy hh:mm tt') AS FormattedGeneratedAt
      `);
      if (genTimeRes.recordset.length > 0) {
        reportGeneratedAt = genTimeRes.recordset[0].FormattedGeneratedAt;
      }
    } catch (genErr) {
      console.warn("[DayEndEmail] Could not query SQL for generated timestamp:", genErr.message);
    }

    // Fallback formatting if SQL Server FORMAT function wasn't available
    if (!businessDateDisplay) {
      businessDateDisplay = formatCustomDate(cleanDateStr);
    }
    if (!reportGeneratedAt) {
      reportGeneratedAt = formatCustomDateTime(new Date(), outletTimezone);
    }
    if (!dayEndCompletedAt) {
      dayEndCompletedAt = reportGeneratedAt;
    }

    // 6. Check if Report Email is configured and valid
    if (!rawReportEmail || !EMAIL_REGEX.test(rawReportEmail.toLowerCase())) {
      console.warn(
        `⚠️ [DayEndEmail] No valid Report Email configured in Shop Settings for ${companySettings.CompanyName || dbKey} (value="${rawReportEmail}"). Settlement remains successful; email skipped.`
      );

      // Record skipped status in DayEndEmailLog
      try {
        await pool
          .request()
          .input("businessDate", sql.Date, cleanDateStr)
          .input("recipient", sql.NVarChar(255), rawReportEmail || "NOT_CONFIGURED")
          .input("status", sql.NVarChar(50), "SKIPPED_NO_EMAIL")
          .input("error", sql.NVarChar(sql.MAX), rawReportEmail ? `Invalid email address format: "${rawReportEmail}"` : "Report Email field is empty in Shop Settings")
          .query(`
            IF EXISTS (SELECT 1 FROM DayEndEmailLog WHERE BusinessDate = @businessDate)
              UPDATE DayEndEmailLog 
              SET RecipientEmail = @recipient, Status = @status, ErrorMessage = @error, UpdatedAt = GETDATE()
              WHERE BusinessDate = @businessDate
            ELSE
              INSERT INTO DayEndEmailLog (BusinessDate, RecipientEmail, Status, ErrorMessage, CreatedAt, UpdatedAt)
              VALUES (@businessDate, @recipient, @status, @error, GETDATE(), GETDATE())
          `);
      } catch (logErr) {
        console.warn("[DayEndEmail] Failed to log skipped status:", logErr.message);
      }

      return {
        sent: false,
        skipped: true,
        reason: "INVALID_OR_MISSING_REPORT_EMAIL",
        message: rawReportEmail
          ? `Report Email "${rawReportEmail}" is not a valid email address.`
          : "Report Email is not configured in Shop Settings.",
      };
    }

    const recipientEmail = rawReportEmail.toLowerCase();
    const companyName = companySettings.CompanyName || "My Restaurant";

    console.log(`[DayEndEmail] Generating report for ${companyName} (${cleanDateStr}) [Settled: ${dayEndCompletedAt}] to send to: ${recipientEmail}`);

    // Mark as SENDING in DayEndEmailLog
    await pool
      .request()
      .input("businessDate", sql.Date, cleanDateStr)
      .input("recipient", sql.NVarChar(255), recipientEmail)
      .query(`
        IF EXISTS (SELECT 1 FROM DayEndEmailLog WHERE BusinessDate = @businessDate)
          UPDATE DayEndEmailLog 
          SET RecipientEmail = @recipient, Status = 'SENDING', AttemptCount = AttemptCount + 1, UpdatedAt = GETDATE()
          WHERE BusinessDate = @businessDate
        ELSE
          INSERT INTO DayEndEmailLog (BusinessDate, RecipientEmail, Status, AttemptCount, CreatedAt, UpdatedAt)
          VALUES (@businessDate, @recipient, 'SENDING', 1, GETDATE(), GETDATE())
      `);

    // 7. Fetch Sales Report data for the exact business date
    const reportData = await fetchFullReportData(cleanDateStr, cleanDateStr, pool, null);
    reportData.companyName = companyName;
    if (companySettings.Address) reportData.companyAddress = companySettings.Address;
    if (companySettings.Phone) reportData.companyPhone = companySettings.Phone;
    reportData.businessDateDisplay = businessDateDisplay;
    reportData.dayEndCompletedAt = dayEndCompletedAt;
    reportData.printedOn = reportGeneratedAt;
    reportData.printedBy = user || "Cashier";

    // 8. Generate PDF attachment with Date and Time included
    console.log(`[DayEndEmail] Building PDF report for ${businessDateDisplay} (Day End: ${dayEndCompletedAt})...`);
    const docDef = await generateSalesReportPdf(reportData);
    const pdfBuffer = await createPdfBinary(docDef);

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      throw new Error("Failed to generate PDF report attachment: Buffer is empty.");
    }

    // 9. Build HTML email body with both Date and Time
    const emailHtml = buildEmailHtml({
      reportData,
      businessDateDisplay,
      dayEndCompletedAt,
      reportGeneratedAt,
      companySettings,
      user,
    });

    // Email Subject formatted with Date and Time: Daily Sales Report - 29-Oct-2026 11:30 AM - [Shop Name]
    const emailSubject = `Daily Sales Report - ${dayEndCompletedAt} - ${companyName}`;
    const sanitizedCompanyName = companyName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const pdfFilename = `Daily_Sales_Report_${sanitizedCompanyName}_${businessDateDisplay}.pdf`;

    // 10. Send via existing Hostinger / configured mail transporter
    const { transporter, from } = createMailTransporter();

    console.log(`[DayEndEmail] Sending email to ${recipientEmail} via ${from} with subject "${emailSubject}"...`);
    const sendResult = await transporter.sendMail({
      from: `"${companyName}" <${from}>`,
      to: recipientEmail,
      subject: emailSubject,
      text: `Daily Sales Report for ${companyName}\nBusiness Date: ${businessDateDisplay}\nDay End Completed At: ${dayEndCompletedAt}\nReport Generated At: ${reportGeneratedAt}\nSettled By: ${user || "Cashier"}\nTotal Sales: ${formatCurrency(reportData.totalSales, companySettings.CurrencySymbol || "$")}\nTotal Collections: ${formatCurrency(reportData.totalCollections, companySettings.CurrencySymbol || "$")}\nPlease find the complete detailed sales report attached as a PDF.`,
      html: emailHtml,
      attachments: [
        {
          filename: pdfFilename,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    const messageId = sendResult?.messageId || "sent";
    console.log(`✅ [DayEndEmail] Successfully sent Sales Report email to ${recipientEmail} (messageId: ${messageId})`);

    // 11. Update DayEndEmailLog to SENT
    await pool
      .request()
      .input("businessDate", sql.Date, cleanDateStr)
      .input("recipient", sql.NVarChar(255), recipientEmail)
      .input("messageId", sql.NVarChar(255), String(messageId))
      .query(`
        UPDATE DayEndEmailLog 
        SET 
          Status = 'SENT', 
          SentAt = GETDATE(), 
          MessageId = @messageId, 
          ErrorMessage = NULL, 
          UpdatedAt = GETDATE()
        WHERE BusinessDate = @businessDate
      `);

    // 12. Append audit log entry
    try {
      await pool
        .request()
        .input("startDate", sql.Date, cleanDateStr)
        .input("username", sql.VarChar(30), String(user || "admin").slice(0, 30))
        .input("remarks", sql.NVarChar(500), `Sales report emailed to ${recipientEmail} (Settled: ${dayEndCompletedAt})`)
        .query(`
          INSERT INTO BusinessDayAuditLog (BusinessDate, EventType, EventTime, ActionBy, Remarks)
          VALUES (@startDate, 'DAY_END_EMAIL_SENT', DATEADD(MINUTE, 480, GETUTCDATE()), @username, @remarks)
        `);
    } catch (auditErr) {
      console.warn("[DayEndEmail] Could not append to BusinessDayAuditLog:", auditErr.message);
    }

    return {
      sent: true,
      recipient: recipientEmail,
      messageId,
      businessDate: cleanDateStr,
      businessDateDisplay,
      dayEndCompletedAt,
      reportGeneratedAt,
      message: `Sales report successfully emailed to ${recipientEmail}`,
    };
  } catch (err) {
    console.error(`❌ [DayEndEmail] Failed to send report email for ${cleanDateStr}:`, err.message);

    // Record failure in DayEndEmailLog so settlement is not corrupted and can be retried safely
    try {
      await pool
        .request()
        .input("businessDate", sql.Date, cleanDateStr)
        .input("error", sql.NVarChar(sql.MAX), err.message || String(err))
        .query(`
          IF EXISTS (SELECT 1 FROM DayEndEmailLog WHERE BusinessDate = @businessDate)
            UPDATE DayEndEmailLog 
            SET Status = 'FAILED', ErrorMessage = @error, UpdatedAt = GETDATE()
            WHERE BusinessDate = @businessDate
          ELSE
            INSERT INTO DayEndEmailLog (BusinessDate, RecipientEmail, Status, ErrorMessage, CreatedAt, UpdatedAt)
            VALUES (@businessDate, 'UNKNOWN', 'FAILED', @error, GETDATE(), GETDATE())
        `);

      await pool
        .request()
        .input("startDate", sql.Date, cleanDateStr)
        .input("username", sql.VarChar(30), String(user || "admin").slice(0, 30))
        .input("remarks", sql.NVarChar(500), `Email failed: ${String(err.message).slice(0, 450)}`)
        .query(`
          INSERT INTO BusinessDayAuditLog (BusinessDate, EventType, EventTime, ActionBy, Remarks)
          VALUES (@startDate, 'DAY_END_EMAIL_FAILED', DATEADD(MINUTE, 480, GETUTCDATE()), @username, @remarks)
        `);
    } catch (logErr) {
      console.warn("[DayEndEmail] Could not update DayEndEmailLog on failure:", logErr.message);
    }

    return {
      sent: false,
      error: err.message,
      canRetry: true,
      businessDate: cleanDateStr,
      message: `Settlement completed, but sales report email failed: ${err.message}`,
    };
  } finally {
    activeSendingLocks.delete(lockKey);
  }
}

module.exports = {
  sendDayEndSalesReportEmail,
  ensureDayEndEmailLogTable,
};
