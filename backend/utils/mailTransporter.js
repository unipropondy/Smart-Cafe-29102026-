const nodemailer = require("nodemailer");
const https = require("https");

/** @param {string} [u] */
function maskUser(u) {
  if (!u || u.length < 4) return "(hidden)";
  return `${u.slice(0, 2)}***${u.slice(-2)}`;
}

/**
 * Hostinger Mail API client conforming to Nodemailer transporter interface.
 * Uses https://api.mail.hostinger.com to send emails directly via REST API.
 */
class HostingerMailApiTransporter {
  constructor(apiKey, mailboxResourceId, fromEmail) {
    this.apiKey = apiKey;
    this.mailboxResourceId = mailboxResourceId || null;
    this.fromEmail = fromEmail || "reports@uniprosg.com";
  }

  async _resolveMailboxId() {
    if (this.mailboxResourceId) return this.mailboxResourceId;
    const me = await this._request("GET", "/api/v1/me");
    const mailboxes = me?.data?.mailboxes || [];
    const match =
      mailboxes.find(
        (m) => m.address?.toLowerCase() === this.fromEmail.toLowerCase()
      ) || mailboxes[0];
    if (!match?.resourceId) {
      throw new Error(
        `No Hostinger mailbox found for address: ${this.fromEmail}`
      );
    }
    this.mailboxResourceId = match.resourceId;
    return this.mailboxResourceId;
  }

  _request(method, path, body = null, retries = 2) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const headers = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      };
      if (payload) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(payload);
      }

      const req = https.request(
        {
          hostname: "api.mail.hostinger.com",
          path,
          method,
          headers,
          timeout: 25000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", async () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(data ? JSON.parse(data) : { success: true });
              } catch {
                resolve({ success: true, raw: data });
              }
            } else if ([502, 503, 504].includes(res.statusCode) && retries > 0) {
              console.warn(
                `[HostingerMail] Transient ${res.statusCode} from ${path}, retrying in 1s (${retries} attempts left)...`
              );
              setTimeout(() => {
                this._request(method, path, body, retries - 1)
                  .then(resolve)
                  .catch(reject);
              }, 1000);
            } else {
              let errorMsg = `Hostinger Mail API error (${res.statusCode}): ${data}`;
              try {
                const parsed = JSON.parse(data);
                if (parsed.message) errorMsg = `Hostinger Mail API: ${parsed.message}`;
              } catch {}
              const err = new Error(errorMsg);
              err.statusCode = res.statusCode;
              err.responseBody = data;
              reject(err);
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error("Hostinger Mail API request timed out"));
      });

      req.on("error", (err) => {
        if (retries > 0) {
          console.warn(
            `[HostingerMail] Network error, retrying in 1s (${retries} attempts left)...`,
            err.message
          );
          setTimeout(() => {
            this._request(method, path, body, retries - 1)
              .then(resolve)
              .catch(reject);
          }, 1000);
        } else {
          reject(err);
        }
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  async verify() {
    const me = await this._request("GET", "/api/v1/me");
    const mailboxes = me?.data?.mailboxes || [];
    const found =
      mailboxes.find(
        (m) => m.address?.toLowerCase() === this.fromEmail.toLowerCase()
      ) || mailboxes[0];
    if (!found) {
      throw new Error(
        `Hostinger Mail API authenticated, but no mailbox found for ${this.fromEmail}`
      );
    }
    this.mailboxResourceId = found.resourceId;
    console.log(
      `[mail] Hostinger Mail API verified: mailbox=${found.address} resourceId=${found.resourceId}`
    );
    return true;
  }

  async sendMail(options) {
    const mailboxId = await this._resolveMailboxId();

    // Parse recipients (support string "a@b.com, c@d.com" or array)
    let toList = [];
    if (Array.isArray(options.to)) {
      toList = options.to
        .map((t) => (typeof t === "string" ? t.trim() : t?.address || ""))
        .filter(Boolean);
    } else if (typeof options.to === "string") {
      toList = options.to.split(",").map((s) => s.trim()).filter(Boolean);
    }

    if (toList.length === 0) {
      throw new Error("At least one recipient email address is required");
    }

    // Parse display name from `from` if present (e.g. '"Smart Cafe" <reports@uniprosg.com>')
    let displayName = undefined;
    if (options.from && typeof options.from === "string") {
      const match = options.from.match(/^["']?([^"'<>]+)["']?\s*<.+>$/);
      if (match) displayName = match[1].trim();
    }

    // Parse attachments
    const attachments = [];
    if (Array.isArray(options.attachments)) {
      for (const att of options.attachments) {
        if (!att) continue;
        let base64Content = "";
        if (Buffer.isBuffer(att.content)) {
          base64Content = att.content.toString("base64");
        } else if (typeof att.content === "string") {
          base64Content = att.content;
        }
        attachments.push({
          filename: att.filename || "attachment",
          content: base64Content,
          contentType: att.contentType || "application/octet-stream",
        });
      }
    }

    const payload = {
      to: toList,
      subject: options.subject || "(No Subject)",
      text: options.text || undefined,
      html: options.html || undefined,
      displayName: displayName || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    // Clean undefined keys
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    console.log(
      `[mail] Sending via Hostinger Mail API to ${toList.join(", ")} (mailbox=${mailboxId})...`
    );
    await this._request("POST", `/api/v1/mailboxes/${mailboxId}/send`, payload);

    return {
      messageId: `hostinger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      accepted: toList,
      rejected: [],
      response: "204 Message sent via Hostinger Mail API",
    };
  }
}

/**
 * Builds an email transport from environment variables.
 *
 * Option A — Hostinger Mail API: set `HOSTINGER_MAIL_API_KEY`.
 * Optional: `HOSTINGER_MAILBOX_RESOURCE_ID`, `EMAIL_FROM`.
 *
 * Option B — Gmail (app password): set `EMAIL_USER` and `EMAIL_PASS`.
 * Optional: `EMAIL_SERVICE` (default `gmail`), `EMAIL_FROM`.
 *
 * Option C — Custom SMTP: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
 * Optional: `SMTP_SECURE` (`true` / `1` for TLS on connect, e.g. port 465), `EMAIL_FROM`.
 *
 * @returns {{ transporter: { verify: () => Promise<any>, sendMail: (opts: any) => Promise<any> }, from: string }}
 */
function createMailTransporter() {
  const hostingerApiKey = (
    process.env.HOSTINGER_MAIL_API_KEY ||
    process.env.HOSTINGER_API_KEY ||
    process.env.MAIL_API_KEY ||
    ""
  ).trim();

  const from =
    (process.env.EMAIL_FROM || "").trim() ||
    (process.env.EMAIL_USER || "").trim() ||
    "reports@uniprosg.com";

  if (hostingerApiKey) {
    const mailboxId =
      (process.env.HOSTINGER_MAILBOX_RESOURCE_ID || "").trim() || null;
    const transporter = new HostingerMailApiTransporter(
      hostingerApiKey,
      mailboxId,
      from
    );
    console.log(
      `[mail] Hostinger Mail API transport: from=${from} key=${maskUser(hostingerApiKey)}`
    );
    return { transporter, from };
  }

  const smtpHost = (process.env.SMTP_HOST || "").trim();
  const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || "").trim();

  if (!smtpUser || !smtpPass) {
    const err = new Error("Email is not enabled on this server.");
    err.code = "MAIL_NOT_CONFIGURED";
    err.hint =
      "Set HOSTINGER_MAIL_API_KEY (Hostinger Mail API), or EMAIL_USER and EMAIL_PASS (Gmail: use an App Password), or set SMTP_HOST, SMTP_USER, and SMTP_PASS for custom SMTP. On Railway: Project → your service → Variables → add the keys → redeploy.";
    throw err;
  }

  let transporter;
  if (smtpHost) {
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const secureEnv = process.env.SMTP_SECURE;
    const secure =
      secureEnv === "true" ||
      secureEnv === "1" ||
      port === 465;
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
    });
    console.log(
      `[mail] SMTP transport: host=${smtpHost} port=${port} secure=${secure} user=${maskUser(smtpUser)}`
    );
  } else {
    const service = (process.env.EMAIL_SERVICE || "gmail").trim();
    transporter = nodemailer.createTransport({
      service,
      auth: { user: smtpUser, pass: smtpPass },
    });
    console.log(
      `[mail] Well-known service transport: service=${service} user=${maskUser(smtpUser)}`
    );
  }

  return { transporter, from };
}

module.exports = { createMailTransporter, HostingerMailApiTransporter };
