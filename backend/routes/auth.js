const express = require("express");
const router = express.Router();
const {
  poolPromise,
  sql,
  getBranchDatabaseList,
  lookupBranchDatabase,
  getPoolForDatabase,
} = require("../config/db");
const jwt = require("jsonwebtoken");
const { createMailTransporter } = require("../utils/mailTransporter");
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set!");
}
const bcrypt = require("bcryptjs");

async function sendWelcomeEmail({
  email,
  name,
  phone,
  promoCode,
  promoAmount,
}) {
  const callMsg = `✉️ [Mail] sendWelcomeEmail called at ${new Date().toISOString()} → email="${email}", name="${name}"\n`;
  require("fs").appendFileSync("mail_debug.log", callMsg);
  console.log(callMsg);
  if (!email || !email.includes("@")) {
    const skipMsg = `⚠️ [Mail] Skipped welcome email — email is empty or invalid: "${email}"\n`;
    require("fs").appendFileSync("mail_debug.log", skipMsg);
    console.warn(skipMsg);
    return;
  }
  try {
    const { transporter, from } = createMailTransporter();

    // Plain text fallback version for email deliverability
    const textContent = `
Welcome to SITARA'S RESTAURANT, ${name}.

Thank you for registering as a member with SITARA'S RESTAURANT. Your account has been configured.

Your Member Profile:
Name: ${name}
Mobile: ${phone}
Email: ${email}
${promoCode ? `Welcome Wallet Credit: Code ${promoCode} (Value: $${promoAmount})` : ""}

Start ordering here: https://smart-cafe.up.railway.app/customer

SITARA'S RESTAURANT
Support: support@unipro.com.sg
Unsubscribe: https://smart-cafe.up.railway.app/customer/unsubscribe
    `.trim();

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to SITARA'S RESTAURANT</title>
      <!--[if mso]>
      <noscript>
        <xml>
          <o:OfficeDocumentSettings>
            <o:AllowPNG/>
            <o:PixelsPerInch>96</o:PixelsPerInch>
          </o:OfficeDocumentSettings>
        </xml>
      </noscript>
      <![endif]-->
      <style>
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; }
        img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
        table { border-collapse: collapse !important; }
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
        a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
        @media screen and (max-width: 600px) {
          .wrapper { width: 100% !important; max-width: 100% !important; }
          .responsive-padding { padding: 24px !important; }
          .hero-heading { font-size: 26px !important; }
          .grid-cell { display: block !important; width: 100% !important; padding-right: 0 !important; padding-left: 0 !important; margin-bottom: 16px !important; }
          .benefits-table { padding: 0 !important; }
        }
      </style>
    </head>
    <body style="margin: 0 !important; padding: 0 !important; background-color: #F8FAFC; font-family: Arial, Helvetica, sans-serif;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #F8FAFC;">
        <tr>
          <td align="center" style="padding: 24px 10px 48px 10px;">
            <!--[if (gte mso 9)|(IE)]>
            <table align="center" border="0" cellspacing="0" cellpadding="0" width="580">
            <tr>
            <td>
            <![endif]-->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" class="wrapper" style="max-width: 580px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04); border: 1px solid #E2E8F0;">
              
              <!-- 👑 PREMIUM HERO BANNER -->
              <tr>
                <td align="center" style="background: linear-gradient(135deg, #FF6A00 0%, #E04D10 100%); padding: 48px 40px; text-align: center;">
                  <table border="0" cellpadding="0" cellspacing="0" role="presentation">
                    <tr>
                      <td align="center" style="background-color: rgba(255, 255, 255, 0.15); border-radius: 30px; padding: 6px 16px; display: inline-block; margin-bottom: 16px;">
                        <span style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; font-weight: bold; color: #FFFFFF; letter-spacing: 1px; text-transform: uppercase;">Welcome to SITARA'S RESTAURANT</span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <h1 class="hero-heading" style="margin: 0 0 12px 0; font-family: Arial, Helvetica, sans-serif; font-size: 30px; font-weight: bold; color: #FFFFFF; letter-spacing: -0.5px; line-height: 1.2;">Your Table-side Dining Experience Just Got Better.</h1>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 0 20px;">
                        <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: rgba(255, 255, 255, 0.9); line-height: 1.5; font-weight: normal;">Enjoy effortless QR code ordering, real-time receipts, rewards, and exclusive dining privileges.</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- ✉️ WELCOME AND ACCOUNT CONFIRMATION -->
              <tr>
                <td class="responsive-padding" style="padding: 40px 40px 24px 40px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                    <tr>
                      <td>
                        <h2 style="margin: 0 0 12px 0; font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: bold; color: #1E293B;">Hi ${name}</h2>
                        <p style="margin: 0 0 24px 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #475569; line-height: 1.6;">
                          Welcome to SITARA'S RESTAURANT! You can now enjoy faster QR ordering, instant digital receipts, exclusive member-only offers, reward points, birthday surprises, cashback, and a seamless dining experience.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- 💳 GLASSMORPHISM MEMBER CARD -->
              <tr>
                <td class="responsive-padding" style="padding: 0 40px 32px 40px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 24px;">
                    <tr>
                      <td style="padding-bottom: 16px; border-bottom: 1px solid #E2E8F0;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                          <tr>
                            <td valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: bold; color: #FF6A00; text-transform: uppercase; letter-spacing: 1px;">MEMBER CARD</span>
                            </td>
                            <td align="right" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: bold; color: #1E293B; background-color: #F59E0B; padding: 3px 8px; border-radius: 4px;">MEMBER</span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top: 16px;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                          <tr>
                            <td style="padding: 6px 0; width: 120px;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748B;">Member Name</span>
                            </td>
                            <td align="right" style="padding: 6px 0;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1E293B; font-weight: bold;">${name}</span>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 6px 0; width: 120px;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748B;">Mobile Number</span>
                            </td>
                            <td align="right" style="padding: 6px 0;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1E293B; font-weight: bold;">${phone}</span>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 6px 0; width: 120px;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748B;">Email</span>
                            </td>
                            <td align="right" style="padding: 6px 0;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1E293B; font-weight: bold;">${email}</span>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 6px 0; width: 120px;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #64748B;">Member Since</span>
                            </td>
                            <td align="right" style="padding: 6px 0;" valign="middle">
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1E293B; font-weight: bold;">${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long" })}</span>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    ${
                      promoCode
                        ? `
                    <tr>
                      <td style="padding-top: 16px;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 8px; padding: 12px; text-align: center;">
                          <tr>
                            <td>
                              <span style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #065F46; font-weight: bold;">Welcome Wallet Credit</span>
                              <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #047857; font-weight: bold; margin-top: 2px;">Code: ${promoCode} (Amount: $${promoAmount})</div>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    `
                        : ""
                    }
                  </table>
                </td>
              </tr>

              <!-- 🛡️ VIP BENEFITS SECTION -->
              <tr>
                <td class="responsive-padding" style="padding: 0 40px 32px 40px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                    <tr>
                      <td style="padding-bottom: 18px;">
                        <h3 style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: bold; color: #FF6A00; text-transform: uppercase; letter-spacing: 1px;">VIP Privileges</h3>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <table class="benefits-table" border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                          <!-- Grid Row 1 -->
                          <tr>
                            <td class="grid-cell" width="50%" valign="top" style="padding-right: 10px; padding-bottom: 20px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #F1F5F9; border-radius: 12px; padding: 16px;">
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #1E293B; padding-bottom: 4px;">Fast QR Ordering</td>
                                </tr>
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748B; line-height: 1.4;">Scan, browse, and place your order instantly.</td>
                                </tr>
                              </table>
                            </td>
                            <td class="grid-cell" width="50%" valign="top" style="padding-left: 10px; padding-bottom: 20px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #F1F5F9; border-radius: 12px; padding: 16px;">
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #1E293B; padding-bottom: 4px;">Exclusive Offers</td>
                                </tr>
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748B; line-height: 1.4;">Access specialized member discounts.</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          <!-- Grid Row 2 -->
                          <tr>
                            <td class="grid-cell" width="50%" valign="top" style="padding-right: 10px; padding-bottom: 20px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #F1F5F9; border-radius: 12px; padding: 16px;">
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #1E293B; padding-bottom: 4px;">Birthday Rewards</td>
                                </tr>
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748B; line-height: 1.4;">Receive extra surprises on your birthday.</td>
                                </tr>
                              </table>
                            </td>
                            <td class="grid-cell" width="50%" valign="top" style="padding-left: 10px; padding-bottom: 20px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #F1F5F9; border-radius: 12px; padding: 16px;">
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #1E293B; padding-bottom: 4px;">Earn Reward Points</td>
                                </tr>
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748B; line-height: 1.4;">Accumulate points for every meal ordered.</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          <!-- Grid Row 3 -->
                          <tr>
                            <td class="grid-cell" width="50%" valign="top" style="padding-right: 10px; padding-bottom: 20px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #F1F5F9; border-radius: 12px; padding: 16px;">
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #1E293B; padding-bottom: 4px;">Digital Receipts</td>
                                </tr>
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748B; line-height: 1.4;">Your billing details are saved digitally.</td>
                                </tr>
                              </table>
                            </td>
                            <td class="grid-cell" width="50%" valign="top" style="padding-left: 10px; padding-bottom: 20px;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #F1F5F9; border-radius: 12px; padding: 16px;">
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #1E293B; padding-bottom: 4px;">Order History</td>
                                </tr>
                                <tr>
                                  <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748B; line-height: 1.4;">View all your past purchases easily.</td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- 📲 CALL TO ACTION -->
              <tr>
                <td class="responsive-padding" style="padding: 0 40px 48px 40px; text-align: center;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                    <tr>
                      <td align="center">
                        <!--[if mso]>
                        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://smart-cafe.up.railway.app/customer" style="height:50px;v-text-anchor:middle;width:240px;" arcsize="10%" stroke="f" fillcolor="#FF6A00">
                          <w:anchorlock/>
                          <center>
                            <span style="color:#ffffff;font-family:Arial, sans-serif;font-size:15px;font-weight:bold;">Start Ordering →</span>
                          </center>
                        </v:roundrect>
                        <![endif]-->
                        <!--[if !mso]><!-->
                        <a href="https://smart-cafe.up.railway.app/customer" style="background-color: #FF6A00; color: #FFFFFF; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: bold; text-decoration: none; padding: 15px 36px; border-radius: 8px; display: inline-block; box-shadow: 0 6px 12px rgba(255, 106, 0, 0.15);">Start Ordering</a>
                        <!--<![endif]-->
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- 🛡️ FOOTER -->
              <tr>
                <td style="background-color: #F8FAFC; padding: 32px 40px; text-align: center; border-top: 1px solid #E2E8F0;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation">
                    <tr>
                      <td style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #1E293B; padding-bottom: 6px;">
                        SITARA'S RESTAURANT
                      </td>
                    </tr>
                    <tr>
                      <td style="font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #64748B; padding-bottom: 16px;">
                        Support: <a href="mailto:support@unipro.com.sg" style="color: #FF6A00; text-decoration: none;">support@unipro.com.sg</a>
                      </td>
                    </tr>
                    <tr>
                      <td style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #94A3B8; padding-bottom: 8px;">
                        &copy; 2026 SITARA'S RESTAURANT. All rights reserved.
                      </td>
                    </tr>
                    <tr>
                      <td style="font-family: Arial, Helvetica, sans-serif; font-size: 11px;">
                        <a href="https://smart-cafe.up.railway.app/customer/privacy" style="color: #94A3B8; text-decoration: underline;">Privacy Policy</a>
                        &nbsp;&bull;&nbsp;
                        <a href="https://smart-cafe.up.railway.app/customer/unsubscribe" style="color: #94A3B8; text-decoration: underline;">Unsubscribe</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
            <!--[if (gte mso 9)|(IE)]>
            </td>
            </tr>
            </table>
            <![endif]-->
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

    await transporter.sendMail({
      from: `"SITARA'S RESTAURANT" <${from}>`,
      to: email,
      subject: `Welcome to SITARA'S RESTAURANT, ${name}!`,
      text: textContent,
      html: htmlContent,
    });
    const successMsg = `✉️ [Mail] Welcome email sent successfully to ${email} at ${new Date().toISOString()}\n`;
    console.log(successMsg);
    require("fs").appendFileSync("mail_debug.log", successMsg);
  } catch (err) {
    const errMsg = `⚠️ [Mail] Failed for ${email} at ${new Date().toISOString()}: [${err.code || "NO_CODE"}] ${err.message}. Response: ${err.response ? JSON.stringify(err.response) : "none"}\n`;
    console.warn(errMsg);
    require("fs").appendFileSync("mail_debug.log", errMsg);
  }
}

/* ================= AUTH - GET COMPANY CODES ================= */
router.get(["/companies", "/company-codes"], async (req, res) => {
  try {
    const list = await getBranchDatabaseList();
    const companies = list.map((item) => ({
      companyCode: item.branchCode,
      branchCode: item.branchCode,
    }));
    return res.json({
      success: true,
      companies,
      data: companies,
    });
  } catch (err) {
    console.error("❌ [AUTH] Error fetching company codes from SQL Server:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company codes. Please try again.",
    });
  }
});

/* ================= AUTH - LOGIN ================= */
router.post("/login", async (req, res) => {
  try {
    const {
      companyCode: rawCompanyCode,
      userName: rawUserName,
      password: rawPassword,
    } = req.body;
    const companyCode = (rawCompanyCode || "").trim();
    const userName = (rawUserName || "").trim();
    const password = (rawPassword || "").trim();

    // 1. Validate empty company code
    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: "Please enter Company Code",
      });
    }

    // 2. Validate empty credentials
    if (!userName || !password) {
      return res.status(400).json({
        success: false,
        message: "Please enter both User ID and Password.",
      });
    }

    // 3. Validate company code against UNIPRO.dbo.BranchDatabaseMaster
    let branchMapping = null;
    try {
      branchMapping = await lookupBranchDatabase(companyCode);
    } catch (e) {
      console.error("[AUTH] Error looking up company code:", e.message);
      return res.status(503).json({
        success: false,
        message: "Database connection busy or unavailable.",
      });
    }

    if (!branchMapping || !branchMapping.databaseName) {
      return res.status(400).json({
        success: false,
        message: "Invalid Company Code",
      });
    }

    const targetDb = branchMapping.databaseName.trim();
    console.log(`[AUTH] Attempting login for Company "${companyCode}" (DB: "${targetDb}"), UserName: "${userName}"`);

    // 4. Obtain connection pool for the resolved company database
    let pool = null;
    try {
      pool = await getPoolForDatabase(targetDb);
    } catch (e) {
      console.error(`[AUTH] Failed to connect to company database "${targetDb}":`, e.message);
      return res.status(503).json({
        success: false,
        message: "Database connection busy or unavailable.",
      });
    }

    if (!pool || !pool.connected) {
      return res.status(503).json({
        success: false,
        message: "Database connection busy or unavailable.",
      });
    }

    const result = await pool.request().input("UserName", userName).query(`
        SELECT 
          u.UserId, u.UserCode, u.UserName, u.UserPassword, u.FullName,
          u.FirstName, u.LastName, u.IsDisabled, u.UserGroupid,
          u.FromDate, u.ToDate,
          g.UserGroupCode AS RoleCode, g.UserGroupName AS RoleName,
          g.isActive AS IsGroupActive
        FROM [dbo].[UserMaster] u
        LEFT JOIN [dbo].[UserGroupMaster] g ON u.UserGroupid = g.UserGroupId
        WHERE u.UserName = @UserName
      `);

    if (result.recordset.length === 0) {
      // Check if they are a registered member in MemberMaster
      const encodedPassword = Buffer.from(password).toString("base64");
      const memberResult = await pool
        .request()
        .input("username", sql.VarChar, userName)
        .input("password", sql.VarChar, encodedPassword).query(`
          SELECT
              M.MemberId,
              M.Name AS UserName,
              M.Email,
              M.Phone AS Phone,
              M.Promocode,
              M.Promoamount,
              (
                  CASE
                      WHEN M.CreditLimit > 0
                          THEN M.CreditLimit - M.CurrentBalance + ISNULL(M.Promoamount, 0)
                      ELSE
                          M.CurrentBalance + ISNULL(M.Promoamount, 0)
                  END
              ) AS AvailableCredit
          FROM MemberMaster M
          WHERE (
            M.Email = @username 
            OR M.Phone = @username 
            OR REPLACE(REPLACE(M.Phone, ' ', ''), '-', '') = REPLACE(REPLACE(@username, ' ', ''), '-', '')
            OR (LEN(REPLACE(REPLACE(@username, ' ', ''), '-', '')) >= 8 AND REPLACE(REPLACE(M.Phone, ' ', ''), '-', '') LIKE '%' + REPLACE(REPLACE(@username, ' ', ''), '-', ''))
          )
            AND M.Password = @password
            AND M.IsActive = 1
        `);

      if (memberResult.recordset.length > 0) {
        const memberUser = memberResult.recordset[0];
        console.log(`[AUTH] Member Login Success: "${memberUser.UserName}" for company ${companyCode}`);

        // Generate JWT token for member using MemberId, embedding company context
        const token = jwt.sign(
          {
            userId: memberUser.MemberId,
            username: memberUser.UserName,
            memberId: memberUser.MemberId,
            role: "MEMBER",
            companyCode: branchMapping.branchCode,
            databaseName: targetDb,
          },
          JWT_SECRET,
          { expiresIn: "24h" },
        );

        return res.json({
          success: true,
          token,
          user: {
            userId: memberUser.MemberId,
            id: memberUser.MemberId,
            userName: memberUser.UserName,
            fullName: memberUser.UserName,
            email: memberUser.Email,
            phone: memberUser.Phone,
            role: "MEMBER",
            MemberId: memberUser.MemberId,
            Promocode: memberUser.Promocode,
            Promoamount: memberUser.Promoamount,
            AvailableCredit: memberUser.AvailableCredit,
            companyCode: branchMapping.branchCode,
          },
        });
      }

      console.log(
        `[AUTH] Login failed: UserName "${userName}" not found in UserMaster or MemberMaster in DB "${targetDb}".`,
      );
      return res
        .status(401)
        .json({ success: false, message: "Invalid User ID or Password." });
    }

    const user = result.recordset[0];

    // ✅ VALIDATE USER STATUS
    if (user.IsDisabled === true || user.IsDisabled === 1) {
      console.log(
        `[AUTH] Login failed: Account disabled for user "${user.UserName}".`,
      );
      return res
        .status(403)
        .json({ success: false, message: "Your account is disabled." });
    }

    // ✅ VALIDATE USER GROUP (STRICT CHECK)
    if (
      !user.UserGroupid ||
      String(user.UserGroupid).trim() === "" ||
      String(user.UserGroupid).trim().toUpperCase() === "NULL" ||
      !user.RoleCode
    ) {
      console.log(
        `[AUTH] Login failed: No valid group assigned to user "${user.UserName}".`,
      );
      return res
        .status(403)
        .json({ success: false, message: "User has no valid group assigned." });
    }

    if (user.IsGroupActive === false || user.IsGroupActive === 0) {
      console.log(
        `[AUTH] Login failed: User group is inactive for user "${user.UserName}".`,
      );
      return res
        .status(403)
        .json({
          success: false,
          message: "Your user group is currently inactive.",
        });
    }

    const dbPassword = (user.UserPassword || "").trim();
    let isValid = false;

    // 1. Try bcrypt check
    try {
      if (dbPassword.startsWith("$2a$") || dbPassword.startsWith("$2b$")) {
        isValid = await bcrypt.compare(password, dbPassword);
      }
    } catch (e) {
      console.error("Bcrypt compare error:", e);
    }

    // 2. Legacy check fallback
    if (!isValid) {
      const parts = dbPassword.split("-");
      const candidates = [dbPassword, parts[0]].filter((c) => c.length > 0);

      for (const cand of candidates) {
        if (cand === password) {
          isValid = true;
          break;
        }
        try {
          const decoded = Buffer.from(cand, "base64").toString("utf-8").trim();
          if (decoded === password) {
            isValid = true;
            break;
          }
        } catch (e) {}
      }
    }

    if (!isValid) {
      console.log(
        `[AUTH] Login failed: Password mismatch for user "${user.UserName}".`,
      );
      return res
        .status(401)
        .json({ success: false, message: "Invalid User ID or Password." });
    }

    // ✅ VALIDATE USER-SPECIFIC LICENSE WINDOW
    if (user.ToDate) {
      const today = new Date();
      const expDate = new Date(user.ToDate);
      today.setHours(0, 0, 0, 0);
      expDate.setHours(0, 0, 0, 0);
      if (today > expDate) {
        console.log(
          `[AUTH] Login failed: User "${user.UserName}" license expired on ${expDate.toISOString().split("T")[0]}`,
        );
        return res
          .status(403)
          .json({
            success: false,
            message: "License expired. Please contact administrator.",
          });
      }
    }
    if (user.FromDate) {
      const today = new Date();
      const fromDate = new Date(user.FromDate);
      today.setHours(0, 0, 0, 0);
      fromDate.setHours(0, 0, 0, 0);
      if (today < fromDate) {
        console.log(
          `[AUTH] Login failed: User "${user.UserName}" license not active until ${fromDate.toISOString().split("T")[0]}`,
        );
        return res
          .status(403)
          .json({
            success: false,
            message: "License not active yet. Please contact administrator.",
          });
      }
    }

    // Update Last Login
    await pool
      .request()
      .input("UserId", user.UserId)
      .query(
        "UPDATE [dbo].[UserMaster] SET LastLogInDate = GETDATE() WHERE UserId = @UserId",
      );

    const finalUserId = String(user.UserId).trim();
    const roleCode = (user.RoleCode || "CASHIER").toUpperCase().trim();

    // 1. Generate Security Token (JWT) with authenticated company and database context
    const token = jwt.sign(
      {
        userId: finalUserId,
        role: roleCode,
        companyCode: branchMapping.branchCode,
        databaseName: targetDb,
      },
      JWT_SECRET,
      { expiresIn: "24h" },
    );

    console.log(`✅ Login Success: ${user.FullName} | Role: ${roleCode} | Company: ${branchMapping.branchCode} (DB: ${targetDb})`);

    // 2. Return Comprehensive Auth Response
    return res.json({
      success: true,
      token,
      user: {
        userId: finalUserId,
        id: finalUserId,
        userCode: user.UserCode,
        userName: user.UserName,
        fullName: user.FullName || user.FirstName,
        role: roleCode, // ADMIN, CASHIER, WAITER, etc.
        roleName: user.RoleName,
        userGroupId: user.UserGroupid,
        licenseFromDate: user.FromDate,
        licenseToDate: user.ToDate,
        companyCode: branchMapping.branchCode,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/* ================= AUTH - VERIFY PASSWORD (ROLE-BASED) ================= */
router.post("/verify", async (req, res) => {
  try {
    const { password, role } = req.body;

    if (!password) {
      return res
        .status(400)
        .json({ success: false, message: "Missing password" });
    }

    const pool = await poolPromise;
    const base64Password = Buffer.from(password).toString("base64");

    let query = `
      SELECT u.UserId, u.UserPassword, u.UserName 
      FROM [dbo].[UserMaster] u
      INNER JOIN [dbo].[UserGroupMaster] g ON u.UserGroupid = g.UserGroupId
      WHERE (u.IsDisabled IS NULL OR u.IsDisabled = 0)
        AND g.isActive = 1
    `;

    const request = pool.request();

    if (role) {
      let roleList = [];
      if (Array.isArray(role)) {
        roleList = role.map((r) => String(r).toUpperCase().trim());
      } else if (typeof role === "string") {
        roleList = role.split(",").map((r) => r.toUpperCase().trim());
      }

      if (roleList.length > 0) {
        const conditions = [];
        roleList.forEach((r, idx) => {
          const paramName = `role_${idx}`;
          request.input(paramName, sql.VarChar, r);
          conditions.push(
            `UPPER(g.UserGroupCode) = @${paramName} OR UPPER(g.UserGroupName) = @${paramName}`,
          );
        });
        query += ` AND (${conditions.join(" OR ")})`;
      }
    }

    const result = await request.query(query);

    let isValid = false;
    let matchedUser = null;

    for (const u of result.recordset) {
      const dbPassword = (u.UserPassword || "").trim();

      // Try bcrypt check
      if (dbPassword.startsWith("$2a$") || dbPassword.startsWith("$2b$")) {
        try {
          if (await bcrypt.compare(password, dbPassword)) {
            isValid = true;
            matchedUser = u;
            break;
          }
        } catch (e) {}
      } else {
        // Try legacy check
        const parts = dbPassword.split("-");
        const candidates = [dbPassword, parts[0]].filter((c) => c.length > 0);

        for (const cand of candidates) {
          if (
            cand === password ||
            Buffer.from(cand, "base64").toString("utf-8").trim() === password
          ) {
            isValid = true;
            matchedUser = u;
            break;
          }
        }
        if (isValid) break;
      }
    }

    return res.json({ success: isValid });
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).json({ success: false });
  }
});

// 🚀 PERMISSIONS CACHE (5-minute TTL)
const permissionCache = new Map();
const PERM_CACHE_TTL = 5 * 60 * 1000;

/* ================= AUTH - PERMISSIONS ================= */
router.get("/permissions/:userGroupCode", async (req, res) => {
  try {
    const { userGroupCode } = req.params;
    const cacheKey = (userGroupCode || "").trim().toUpperCase();

    if (!cacheKey) {
      return res.status(400).json({ error: "Invalid user group code" });
    }

    // Check memory cache
    const cached = permissionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PERM_CACHE_TTL) {
      console.log(`⚡ [Permissions Cache] Hit for group: ${cacheKey}`);
      return res.json(cached.data);
    }

    console.log(
      `🔎 [Permissions Cache] Miss for group: ${cacheKey}. Fetching from DB...`,
    );
    const pool = await poolPromise;
    const result = await pool.request().input("UserGroupCode", cacheKey).query(`
        SELECT 
          LTRIM(RTRIM(FormCode)) AS FormCode,
          LTRIM(RTRIM(AllowAdd))    AS AllowAdd,
          LTRIM(RTRIM(AllowUpdate)) AS AllowUpdate,
          LTRIM(RTRIM(AllowDelete)) AS AllowDelete,
          LTRIM(RTRIM(AllowRead))   AS AllowRead
        FROM [dbo].[UserPermission]
        WHERE UserGroupCode = @UserGroupCode
      `);

    const permMap = {};
    for (const row of result.recordset) {
      if (row.FormCode) {
        permMap[row.FormCode] = {
          canAdd: row.AllowAdd === "A",
          canUpdate: row.AllowUpdate === "U",
          canDelete: row.AllowDelete === "D",
          canRead: row.AllowRead === "R",
        };
      }
    }

    // Save to cache
    permissionCache.set(cacheKey, {
      data: permMap,
      timestamp: Date.now(),
    });

    res.json(permMap);
  } catch (err) {
    console.error("PERMISSIONS FETCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ SIGNUP API
router.post("/signup", async (req, res) => {
  try {
    const username = req.body.username?.trim() || req.body.customerName?.trim();
    const password = req.body.password?.trim();
    const phone = req.body.phone?.trim() || req.body.mobileNumber?.trim();
    const email = req.body.email?.trim() || "";
    const encodedPassword = Buffer.from(password).toString("base64");

    if (!username || !password) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Username and password are required",
        });
    }

    const pool = await poolPromise;
    let promoAmount = 0;
    // Promo Code Validation
    if (req.body.promoCode && req.body.promoCode.trim() !== "") {
      const promoResult = await pool
        .request()
        .input("PromoCode", sql.NVarChar, req.body.promoCode.trim()).query(`
      SELECT *
      FROM PromoCodeMaster
      WHERE PromoCode = @PromoCode
        AND IsActive = 1
    `);

      if (promoResult.recordset.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid Promo Code",
        });
      }

      const promo = promoResult.recordset[0];

      if (promo) {
        promoAmount = promo.DiscountValue;
      }

      if (promo.MaxUsage !== null && promo.UsedCount >= promo.MaxUsage) {
        return res.status(400).json({
          success: false,
          message: "This Promo Code has already been used.",
        });
      }
    }

    // Check MemberMaster for unique username, phone, and email
    const userResult = await pool
      .request()
      .input("username", sql.VarChar, username)
      .input("phone", sql.VarChar, phone || "")
      .input("email", sql.VarChar, email || "").query(`
        SELECT Name, Phone, Email
        FROM MemberMaster
        WHERE Name = @username
           OR (Phone = @phone AND @phone <> '')
           OR (Email = @email AND @email <> '')
      `);

    if (userResult.recordset.length > 0) {
      const match = userResult.recordset[0];
      if (match.Name.toLowerCase() === username.toLowerCase()) {
        return res
          .status(409)
          .json({ success: false, message: "Username already exists" });
      }
      if (match.Phone === phone) {
        return res
          .status(409)
          .json({ success: false, message: "Phone number already registered" });
      }
      if (email && match.Email === email) {
        return res
          .status(409)
          .json({ success: false, message: "Email ID already registered" });
      }
    }

    const memberId = require("crypto").randomUUID();
    await pool
      .request()
      .input("memberId", sql.UniqueIdentifier, memberId)
      .input("name", sql.NVarChar, username)
      .input("phone", sql.NVarChar, phone || "")
      .input("email", sql.NVarChar, email)
      .input("creditLimit", sql.Decimal, 0)
      .input("createdAt", sql.DateTime, new Date())
      .input("address", sql.VarChar, "")
      .input("isActive", sql.Bit, 1)
      .input("balance", sql.Decimal, 0)
      .input("currentBalance", sql.Decimal, 0)
      .input("lowBalanceAlertSent", sql.Bit, 0)
      .input("promoCode", sql.VarChar, req.body.promoCode || "")
      .input("promoAmount", sql.Decimal(18, 2), promoAmount)
      .input("password", sql.VarChar, encodedPassword).query(`
        INSERT INTO MemberMaster (MemberId, Name, Phone, Email, CreditLimit, CreatedAt, Address, IsActive, Balance, CurrentBalance, LowBalanceAlertSent, Promocode, Promoamount, Password)
        VALUES (@memberId, @name, @phone, @email, @creditLimit, @createdAt, @address, @isActive, @balance, @currentBalance, @lowBalanceAlertSent, @promoCode, @promoAmount, @password)
      `);

    if (req.body.promoCode && req.body.promoCode.trim() !== "") {
      await pool
        .request()
        .input("PromoCode", sql.NVarChar, req.body.promoCode.trim()).query(`
      UPDATE PromoCodeMaster
      SET UsedCount = UsedCount + 1
      WHERE PromoCode = @PromoCode
    `);
    }

    const newUser = await pool
      .request()
      .input("username", sql.VarChar, username).query(`
      SELECT
          M.MemberId,
          M.Name AS UserName,
          M.Promocode,
          M.Promoamount,
          (
              CASE
                  WHEN M.CreditLimit > 0
                      THEN M.CreditLimit - M.CurrentBalance + ISNULL(M.Promoamount, 0)
                  ELSE
                      M.CurrentBalance + ISNULL(M.Promoamount, 0)
              END
          ) AS AvailableCredit
      FROM MemberMaster M
      WHERE M.Name = @username
  `);

    // ✉️ Send Welcome Email to newly registered QR customer member
    sendWelcomeEmail({
      email,
      name: username,
      phone,
      promoCode: req.body.promoCode || "",
      promoAmount,
    }).catch((mailErr) => {
      console.warn("⚠️ [Mail] Async Welcome email failed:", mailErr.message);
    });

    res.json({
      success: true,
      user: newUser.recordset[0],
    });
  } catch (err) {
    console.log(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;
