const express = require('express');
const router = express.Router();
const PdfPrinter = require('pdfmake');
const { createMailTransporter } = require('../utils/mailTransporter');

// Define fonts for pdfmake
const fonts = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};
const printer = new PdfPrinter(fonts);

// Helper to generate professional A4 PDF document definition
const { generateSalesReportPdf, createPdfBinary } = require('../utils/pdfReportGenerator');
const { fetchFullReportData } = require('../utils/reportDataFetcher');
const { poolPromise } = require('../config/db');

router.post('/download-pdf', async (req, res) => {
  try {
    const { reportData } = req.body;
    if (!reportData) return res.status(400).json({ error: 'Report data is required' });

    const pool = await poolPromise;
    let startDateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
    try {
      const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
      if (activeDayRes.recordset.length > 0) {
        const activeStartDate = activeDayRes.recordset[0].StartDate;
        startDateStr = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : activeStartDate;
      }
    } catch (dbErr) {
      console.error("Error reading active business day in export:", dbErr);
    }
    let endDateStr = startDateStr;
    // For multi-day ranges, use the period dates from the frontend.
    // For DAILY, always use the active business date from DateEntry
    // so we don't accidentally query calendar-today (which has no settled data).
    if (reportData.filterType !== 'DAILY' && reportData.period) {
      const dates = reportData.period.match(/\d{4}-\d{2}-\d{2}/g);
      if (dates && dates.length > 0) {
        startDateStr = dates[0];
        endDateStr = dates[1] || dates[0];
      }
    }

    const cashierFilter = reportData.selectedCashierId || reportData.cashierId || (reportData.cashierName !== 'Whole Sales (All Users)' ? reportData.cashierName : undefined);
    const enrichedData = await fetchFullReportData(startDateStr, endDateStr, pool, cashierFilter);

    if (reportData.cashierName) {
      enrichedData.cashierName = reportData.cashierName;
    }

    const docDef = await generateSalesReportPdf(enrichedData);
    const pdfBuffer = await createPdfBinary(docDef);

    const filename = `Sales_Report_${reportData.filterType || 'Report'}_${startDateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF Generation Error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// 🔹 DEBUG EMAIL CONNECTION
router.get('/debug-email', async (req, res) => {
  try {
    console.log("[export/debug] Testing email configuration...");
    const { transporter, from } = createMailTransporter();
    
    // Attempt to verify the connection
    await transporter.verify();
    
    console.log("[export/debug] SMTP verification successful for:", from);
    res.json({
      success: true,
      message: "SMTP Connection is working correctly!",
      user: from,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("[export/debug] SMTP verification failed:", err);
    res.status(500).json({
      success: false,
      message: "SMTP Connection Failed",
      error: err.message,
      code: err.code,
      hint: "Ensure EMAIL_USER and EMAIL_PASS are set correctly in Railway and that you are using an App Password for Gmail."
    });
  }
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "protonmail.com",
];
const KNOWN_DOMAIN_TYPOS = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "yaho.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "hotnail.com": "hotmail.com",
};

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function suggestEmailTypos(normalizedEmail) {
  const atIndex = normalizedEmail.indexOf("@");
  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) return null;
  const local = normalizedEmail.slice(0, atIndex);
  const domain = normalizedEmail.slice(atIndex + 1);
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return null;
  if (KNOWN_DOMAIN_TYPOS[domain]) {
    return `${local}@${KNOWN_DOMAIN_TYPOS[domain]}`;
  }
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const distance = levenshteinDistance(domain, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (!best || bestDistance > 2) return null;
  return `${local}@${best}`;
}

function normalizeAndValidateRecipient(email) {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalized) {
    return { ok: false, error: "Recipient email is required" };
  }
  const atIndex = normalized.indexOf("@");
  const domain = atIndex > 0 ? normalized.slice(atIndex + 1) : "";
  if (KNOWN_DOMAIN_TYPOS[domain]) {
    return {
      ok: false,
      error: "Recipient email domain looks misspelled",
      suggestion: `${normalized.slice(0, atIndex)}@${KNOWN_DOMAIN_TYPOS[domain]}`,
    };
  }
  if (!EMAIL_REGEX.test(normalized)) {
    return {
      ok: false,
      error: "A valid recipient email address is required",
      suggestion: suggestEmailTypos(normalized),
    };
  }
  return { ok: true, email: normalized, suggestion: suggestEmailTypos(normalized) };
}

function isInvalidRecipientError(mailErr) {
  const smtpCode = Number(mailErr?.responseCode);
  const raw = `${mailErr?.response || ""} ${mailErr?.message || ""}`.toLowerCase();
  return (
    smtpCode === 511 ||
    smtpCode === 550 ||
    smtpCode === 551 ||
    raw.includes("5.1.1") ||
    raw.includes("mailbox not found") ||
    raw.includes("no mailbox here by that name") ||
    raw.includes("user unknown") ||
    raw.includes("recipient address rejected")
  );
}

router.post('/email-pdf', async (req, res) => {
  let pdfBuffer;
  const pool = await poolPromise;
  let startDateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' });
  try {
    const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
    if (activeDayRes.recordset.length > 0) {
      const activeStartDate = activeDayRes.recordset[0].StartDate;
      startDateStr = activeStartDate instanceof Date ? activeStartDate.toISOString().split("T")[0] : activeStartDate;
    }
  } catch (dbErr) {
    console.error("Error reading active business day in export:", dbErr);
  }
  let endDateStr = startDateStr;
  try {
    const { reportData, email } = req.body;
    if (!reportData) {
      return res.status(400).json({ success: false, error: 'Report data is required' });
    }
    if (reportData.filterType !== 'DAILY' && reportData.period) {
      const dates = reportData.period.match(/\d{4}-\d{2}-\d{2}/g);
      if (dates && dates.length > 0) {
        startDateStr = dates[0];
        endDateStr = dates[1] || dates[0];
      }
    }

    const cashierFilter = reportData.selectedCashierId || reportData.cashierId || (reportData.cashierName !== 'Whole Sales (All Users)' ? reportData.cashierName : undefined);
    const enrichedData = await fetchFullReportData(startDateStr, endDateStr, pool, cashierFilter);

    if (reportData.cashierName) {
      enrichedData.cashierName = reportData.cashierName;
    }

    const recipientCheck = normalizeAndValidateRecipient(email);
    if (!recipientCheck.ok) {
      return res.status(400).json({
        success: false,
        error: recipientCheck.error,
        suggestion: recipientCheck.suggestion,
      });
    }
    const to = recipientCheck.email;
    console.log("[export/email-pdf] Recipient:", to);

    console.log('[export/email-pdf] Generating PDF attachment…');
    const docDef = await generateSalesReportPdf(enrichedData);
    pdfBuffer = await createPdfBinary(docDef);

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      console.error('[export/email-pdf] PDF buffer is empty or invalid');
      return res.status(500).json({
        success: false,
        error: 'PDF generation produced an empty file',
      });
    }

    const filename = `Sales_Report_${reportData.filterType || 'Report'}_${startDateStr}.pdf`;
    console.log(`[export/email-pdf] PDF ready: ${filename} (${pdfBuffer.length} bytes)`);

    let transporter;
    let from;
    try {
      ({ transporter, from } = createMailTransporter());
    } catch (cfgErr) {
      console.error('[export/email-pdf] Mail configuration error:', cfgErr.message, cfgErr.hint || '');
      const status = cfgErr.code === 'MAIL_NOT_CONFIGURED' ? 503 : 500;
      return res.status(status).json({
        success: false,
        error: cfgErr.message,
        details: cfgErr.hint || cfgErr.message,
        code: cfgErr.code || 'MAIL_CONFIG',
      });
    }

    if (process.env.MAIL_SKIP_VERIFY !== '1') {
      try {
        console.log('[export/email-pdf] Verifying SMTP connection (set MAIL_SKIP_VERIFY=1 to skip)…');
        await transporter.verify();
        console.log('[export/email-pdf] SMTP verify OK');
      } catch (verifyErr) {
        console.error('[export/email-pdf] SMTP verify failed:', verifyErr);
        return res.status(502).json({
          success: false,
          error: 'Could not connect to the mail server or authentication failed',
          details: verifyErr.message || String(verifyErr),
        });
      }
    }

    const mailOptions = {
      from,
      to,
      subject: `Sales Report - ${reportData.period || 'Report'}`,
      text: `Please find the attached sales report for the period: ${reportData.period || 'N/A'}.`,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log('[export/email-pdf] sendMail accepted:', {
        recipient: to,
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected,
      });
      return res.status(200).json({
        success: true,
        message: 'Sales report sent successfully',
        email: to,
        status: 'sent',
      });
    } catch (mailErr) {
      const smtpCode = Number(mailErr?.responseCode) || null;
      const smtpResponse = mailErr?.response || "";
      console.error('[export/email-pdf] sendMail failed:', {
        recipient: to,
        smtpCode,
        smtpResponse,
        message: mailErr?.message || String(mailErr),
      });
      if (isInvalidRecipientError(mailErr)) {
        return res.status(400).json({
          success: false,
          error: 'Recipient email address does not exist',
          details: smtpResponse || mailErr?.message || 'Mailbox not found or rejected by SMTP server',
          code: 'INVALID_RECIPIENT',
          recipient: to,
          smtpCode,
        });
      }
      return res.status(502).json({
        success: false,
        error: 'The mail server rejected the message or the send failed',
        details: smtpResponse || mailErr?.message || String(mailErr),
        code: 'SMTP_SEND_FAILED',
        recipient: to,
        smtpCode,
      });
    }
  } catch (err) {
    console.error('[export/email-pdf] Unexpected error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate or send the sales report email',
      details: err.message || String(err),
    });
  }
});

module.exports = router;
