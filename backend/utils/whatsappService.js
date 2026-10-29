/**
 * whatsappService.js
 * ─────────────────
 * Thin WhatsApp notification helper.
 *
 * Currently uses a simple HTTP gateway approach (CallMeBot / WA Business API).
 * Swap `sendRaw()` for your live gateway when available.
 *
 * Exports:
 *   sendLowBalanceAlert(memberId, newBalance, pool)
 */

const sql = require("mssql");

// ── Low-balance threshold config ───────────────────────────────────────────
const LOW_BALANCE_THRESHOLD_PCT = 0.10; // 10 % of CreditLimit (fallback)
const LOW_BALANCE_THRESHOLD_FIXED = 100; // fixed amount used when CreditLimit = 0

/**
 * Compute the low-balance threshold for a member.
 * @param {number} creditLimit
 * @returns {number}
 */
function computeThreshold(creditLimit) {
  return creditLimit > 0
    ? creditLimit * LOW_BALANCE_THRESHOLD_PCT
    : LOW_BALANCE_THRESHOLD_FIXED;
}

/**
 * sendRaw – fire-and-forget wrapper.
 * Replace the body of this function with your actual WhatsApp gateway call
 * (e.g., Twilio, CallMeBot, WABA Cloud API, etc.)
 *
 * @param {string} phone  – E.164-ish number, digits only
 * @param {string} message
 */
async function sendRaw(phone, message) {
  // ── STUB: log to console until a real gateway is configured ──────────────
  console.log(`[WhatsApp] TO: ${phone} | MSG: ${message}`);

  // ── Example: CallMeBot (uncomment and set CALLMEBOT_API_KEY in .env) ────
  // const apiKey = process.env.CALLMEBOT_API_KEY;
  // if (!apiKey) return;
  // const encoded = encodeURIComponent(message);
  // const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=${apiKey}`;
  // const fetch = (await import("node-fetch")).default;
  // await fetch(url);
}

/**
 * sendBalanceNotification
 * ───────────────────────
 * Looks up the member's Name, Phone, CreditLimit, and CurrentBalance,
 * calculates AvailableBalance, selects the correct template, and sends WhatsApp.
 *
 * @param {string} memberId - GUID
 * @param {object} pool     - mssql connection pool
 */
async function sendBalanceNotification(memberId, pool) {
  try {
    const result = await pool
      .request()
      .input("Id", sql.UniqueIdentifier, memberId)
      .query("SELECT Name, Phone, CreditLimit, CurrentBalance FROM MemberMaster WHERE MemberId = @Id");

    if (!result.recordset || result.recordset.length === 0) {
      console.warn(`[WhatsApp] Member ${memberId} not found – notification skipped.`);
      return;
    }

    const { Name, Phone, CreditLimit, CurrentBalance } = result.recordset[0];
    if (!Phone || Phone.trim() === "") {
      console.warn(`[WHATSAPP] Notification skipped - phone number missing`);
      return;
    }

    const creditLimit = Number(CreditLimit) || 0;
    const currentBalance = Number(CurrentBalance) || 0;
    const availableBalance = creditLimit > 0 ? (creditLimit - currentBalance) : currentBalance;

    const formattedAvailable = availableBalance.toFixed(2);
    const formattedCreditLimit = creditLimit.toFixed(2);
    const formattedConsumed = currentBalance.toFixed(2);

    let message = "";
    if (availableBalance < 50) {
      message = `Hi ${Name},\n\nYour available balance is $${formattedAvailable}, which is below the minimum threshold of $50.\n\nPlease top up your account to continue enjoying uninterrupted service.\n\nThank you.`;
      await sendRaw(Phone, message);
      console.log(`[WHATSAPP] Low balance notification sent to Member ${Name}`);
    } else {
      message = `Hi ${Name},\n\nYour current available balance is $${formattedAvailable}.\n\nPrepaid Amount: $${formattedCreditLimit}\nConsumed Amount: $${formattedConsumed}\n\nThank you for being a valued member.`;
      await sendRaw(Phone, message);
      console.log(`[WHATSAPP] Balance information notification sent to Member ${Name}`);
    }
  } catch (err) {
    console.error("[WhatsApp] sendBalanceNotification error:", err.message);
  }
}

module.exports = { computeThreshold, sendBalanceNotification };

