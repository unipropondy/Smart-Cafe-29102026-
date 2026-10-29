/**
 * netsTransport.js
 * Hardware & Network transport communication layer for NETS ECR II terminal.
 * Supports Ethernet/LAN (TCP/IP) and RS-232 (Serial COM) with full Section 2.2 error handling,
 * retry limits, timeouts, ACK/NAK state machine, database persistence, and hexadecimal communication logging.
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const { poolPromise, sql } = require('../../config/db');
const {
  STX,
  ETX,
  ACK,
  NAK,
  FS,
  buildLanPacket,
  buildRs232Packet,
  parseLanResponse,
  parseRs232Response,
  isValidBcd2,
  fromBcd2
} = require('./netsProtocol');

const LOG_DIR = path.resolve(__dirname, '../../logs');
const COMM_LOG_FILE = path.join(LOG_DIR, 'nets_comm.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// In-memory circular buffer of the last 100 log entries for UI inspection / UAT export
const recentLogs = [];
const MAX_LOGS = 100;

/**
 * Sanitizes raw packet bytes for communication logging.
 * Masks Primary Account Number (PAN) digits and sensitive authentication data (PIN).
 * Retains first 6 and last 4 digits of card numbers, replacing middle digits with 'X'.
 */
function maskSensitiveHex(rawBytes) {
  if (!rawBytes) return '';

  let bufferToInspect;
  if (Buffer.isBuffer(rawBytes)) {
    bufferToInspect = Buffer.from(rawBytes);
  } else if (typeof rawBytes === 'string') {
    // If it's already a hex string, try to decode to buffer for pattern masking
    const cleanHex = rawBytes.replace(/\s+/g, '');
    if (/^[0-9A-Fa-f]+$/.test(cleanHex) && cleanHex.length % 2 === 0) {
      bufferToInspect = Buffer.from(cleanHex, 'hex');
    } else {
      // Plain text: mask any 13-19 digit card numbers
      return rawBytes.replace(/\b(\d{6})\d{3,9}(\d{4})\b/g, '$1XXXXXX$2');
    }
  } else {
    return String(rawBytes);
  }

  // Scan ASCII representation for 13 to 19 digit PANs
  const latinStr = bufferToInspect.toString('latin1');
  const panRegex = /\b(\d{6})(\d{3,9})(\d{4})\b/g;

  if (panRegex.test(latinStr)) {
    const maskedLatin = latinStr.replace(panRegex, (match, prefix, middle, suffix) => {
      return prefix + 'X'.repeat(middle.length) + suffix;
    });
    bufferToInspect = Buffer.from(maskedLatin, 'latin1');
  }

  return Array.from(bufferToInspect)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

function logComm(direction, rawBytes, comment = '', metadata = {}) {
  const timestamp = new Date().toISOString();
  const hexString = maskSensitiveHex(rawBytes);

  const destTag = metadata.destination ? `[${metadata.destination}] ` : '';
  const fcTag = metadata.functionCode ? `[FC ${metadata.functionCode}] ` : '';
  const ecnTag = metadata.ecn ? `[ECN ${metadata.ecn}] ` : '';
  const lenTag = metadata.declaredLength !== undefined && metadata.declaredLength !== null ? `[Len ${metadata.declaredLength}] ` : '';

  const logEntry = `[${timestamp}] [${direction}] ${destTag}${fcTag}${ecnTag}${lenTag}${hexString}${comment ? ' # ' + comment : ''}`;
  console.log(`📡 [NETS COMM] ${logEntry}`);

  recentLogs.push({
    timestamp,
    direction,
    destination: metadata.destination || null,
    functionCode: metadata.functionCode || null,
    ecn: metadata.ecn || null,
    declaredLength: metadata.declaredLength ?? null,
    hex: hexString,
    comment,
    error: metadata.error || null
  });
  if (recentLogs.length > MAX_LOGS) recentLogs.shift();

  try {
    fs.appendFileSync(COMM_LOG_FILE, logEntry + '\n', 'utf8');
  } catch (err) {
    console.error('Failed to append to nets_comm.log:', err.message);
  }
}

class NetsTransport {
  constructor(options = {}) {
    this.mode = (options.mode || process.env.NETS_INTERFACE_MODE || 'LAN').toUpperCase(); // 'LAN' or 'RS232'
    this.terminalIp = options.terminalIp || process.env.NETS_TERMINAL_IP || '192.168.9.38';
    this.terminalPort = parseInt(options.terminalPort || process.env.NETS_TERMINAL_PORT || '7500', 10);
    this.comPort = options.comPort || process.env.NETS_COM_PORT || 'COM1';
    this.baudRate = parseInt(options.baudRate || process.env.NETS_BAUD_RATE || '9600', 10);
    this.creditAcquirer = options.creditAcquirer || 'DBS';
    this.receiptMode = options.receiptMode || 'POS_PRINT_RP';
    this.ackTimeoutMs = parseInt(options.ackTimeoutMs || '2000', 10); // Section 2.2.2.3: 2 seconds
    this.maxRetries = 2; // Section 2.2.2.1: Resend twice (total 3 attempts)
    this.onlineTimeoutMs = parseInt(options.onlineTimeoutMs || '120000', 10); // Section 2.2.2.6: 2 minutes
    this.offlineTimeoutMs = parseInt(options.offlineTimeoutMs || '60000', 10); // Section 2.2.2.6: 1 minute
    this.lastUpdated = null;
    this.loadedFromDb = false;
  }

  /**
   * Safe validation for NETS terminal configuration updates.
   * Protects against invalid IPs, port conflicts (such as port 3000), and invalid interface modes.
   */
  validateConfig(cfg = {}, serverPort = 3000) {
    const errors = [];
    const clean = {};
    const configuredHttpPort = parseInt(process.env.PORT || '3000', 10);

    // 1. Interface Mode validation
    if (cfg.mode !== undefined || cfg.InterfaceMode !== undefined) {
      const rawMode = String(cfg.mode || cfg.InterfaceMode || '').toUpperCase().trim();
      if (rawMode !== 'LAN' && rawMode !== 'RS232') {
        errors.push(`Invalid interface mode "${rawMode}". Allowed modes are 'LAN' or 'RS232'.`);
      } else {
        clean.mode = rawMode;
      }
    }

    // 2. Terminal IP validation
    if (cfg.terminalIp !== undefined || cfg.TerminalIp !== undefined) {
      const ip = String(cfg.terminalIp || cfg.TerminalIp || '').trim();
      const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipv4Regex.test(ip)) {
        errors.push(`Invalid IPv4 address format: "${ip}". Expected standard format e.g. 192.168.1.100.`);
      } else if (ip === '0.0.0.0' || ip === '255.255.255.255') {
        errors.push(`Terminal IP cannot be a broadcast or wildcard address: "${ip}".`);
      } else {
        clean.terminalIp = ip;
      }
    }

    // 3. Terminal Port validation
    if (cfg.terminalPort !== undefined || cfg.TerminalPort !== undefined) {
      const port = parseInt(cfg.terminalPort || cfg.TerminalPort, 10);
      const targetIp = (cfg.terminalIp || cfg.TerminalIp || this.terminalIp || '').trim();
      const isLocalhost = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(targetIp);

      if (isNaN(port) || port < 1 || port > 65535) {
        errors.push(`Invalid terminal port "${cfg.terminalPort}". Port must be an integer between 1 and 65535.`);
      } else if (isLocalhost && (port === serverPort || port === configuredHttpPort || port === 3000)) {
        errors.push(`Port ${port} on localhost is reserved for the POS Node.js Express HTTP server. NETS ECR II terminal operates on a raw TCP socket port (typically 7500 or 9742).`);
      } else if (isLocalhost && [80, 443, 8080].includes(port)) {
        errors.push(`Port ${port} on localhost is a standard HTTP/HTTPS web port. NETS ECR II terminals require a dedicated raw TCP socket port.`);
      } else {
        clean.terminalPort = port;
      }
    }

    // 4. RS-232 COM Port validation
    if (cfg.comPort !== undefined || cfg.ComPort !== undefined) {
      const com = String(cfg.comPort || cfg.ComPort || '').toUpperCase().trim();
      if (!/^COM\d{1,3}$/i.test(com)) {
        errors.push(`Invalid COM port "${com}". Expected format like COM1, COM2, COM3.`);
      } else {
        clean.comPort = com;
      }
    }

    // 5. Baud Rate validation
    if (cfg.baudRate !== undefined || cfg.BaudRate !== undefined) {
      const baud = parseInt(cfg.baudRate || cfg.BaudRate, 10);
      const validBauds = [9600, 19200, 38400, 57600, 115200];
      if (!validBauds.includes(baud)) {
        errors.push(`Invalid baud rate "${baud}". Allowed baud rates: ${validBauds.join(', ')}.`);
      } else {
        clean.baudRate = baud;
      }
    }

    // 6. Timeouts validation
    if (cfg.onlineTimeoutSec !== undefined || cfg.OnlineTimeoutSec !== undefined || cfg.onlineTimeoutMs !== undefined) {
      const sec = parseInt(cfg.onlineTimeoutSec || cfg.OnlineTimeoutSec || Math.round((cfg.onlineTimeoutMs || 120000) / 1000), 10);
      if (isNaN(sec) || sec < 10 || sec > 600) {
        errors.push(`Invalid online timeout. Must be between 10 and 600 seconds.`);
      } else {
        clean.onlineTimeoutSec = sec;
        clean.onlineTimeoutMs = sec * 1000;
      }
    }

    if (cfg.offlineTimeoutSec !== undefined || cfg.OfflineTimeoutSec !== undefined || cfg.offlineTimeoutMs !== undefined) {
      const sec = parseInt(cfg.offlineTimeoutSec || cfg.OfflineTimeoutSec || Math.round((cfg.offlineTimeoutMs || 60000) / 1000), 10);
      if (isNaN(sec) || sec < 5 || sec > 300) {
        errors.push(`Invalid offline timeout. Must be between 5 and 300 seconds.`);
      } else {
        clean.offlineTimeoutSec = sec;
        clean.offlineTimeoutMs = sec * 1000;
      }
    }

    if (cfg.creditAcquirer !== undefined || cfg.CreditAcquirer !== undefined) {
      clean.creditAcquirer = String(cfg.creditAcquirer || cfg.CreditAcquirer || 'DBS').toUpperCase().trim();
    }

    if (cfg.receiptMode !== undefined || cfg.ReceiptMode !== undefined) {
      clean.receiptMode = String(cfg.receiptMode || cfg.ReceiptMode || 'POS_PRINT_RP').trim();
    }

    return { isValid: errors.length === 0, errors, clean };
  }

  /**
   * Synchronizes terminal configuration from MSSQL dbo.NetsTerminalConfig.
   */
  async loadConfigFromDb() {
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = (async () => {
      try {
        const pool = await poolPromise;
        if (!pool || !pool.connected) {
          return this.getConfig();
        }

        const result = await pool.request().query(`
          SELECT TOP 1
            ConfigId, InterfaceMode, TerminalIp, TerminalPort, ComPort, BaudRate,
            CreditAcquirer, ReceiptMode, OnlineTimeoutSec, OfflineTimeoutSec, LastUpdated
          FROM [dbo].[NetsTerminalConfig]
          ORDER BY ConfigId ASC
        `);

        if (result.recordset && result.recordset.length > 0) {
          const row = result.recordset[0];
          this.mode = (row.InterfaceMode || 'LAN').toUpperCase();
          this.terminalIp = row.TerminalIp || '192.168.9.38';
          this.terminalPort = parseInt(row.TerminalPort || 7500, 10);
          this.comPort = row.ComPort || 'COM1';
          this.baudRate = parseInt(row.BaudRate || 9600, 10);
          this.creditAcquirer = row.CreditAcquirer || 'DBS';
          this.receiptMode = row.ReceiptMode || 'POS_PRINT_RP';
          this.onlineTimeoutMs = (row.OnlineTimeoutSec || 120) * 1000;
          this.offlineTimeoutMs = (row.OfflineTimeoutSec || 60) * 1000;
          this.lastUpdated = row.LastUpdated;
          this.loadedFromDb = true;

          console.log(`✅ [NETS] Loaded terminal configuration from database: ${this.mode} (${this.mode === 'LAN' ? this.terminalIp + ':' + this.terminalPort : this.comPort})`);
        }
      } catch (err) {
        console.error('⚠️ [NETS] Failed to load config from dbo.NetsTerminalConfig:', err.message);
      } finally {
        this._loadingPromise = null;
      }
      return this.getConfig();
    })();

    return this._loadingPromise;
  }

  /**
   * Persists updated configuration to MSSQL dbo.NetsTerminalConfig and updates memory.
   */
  async saveConfigToDb(cleanCfg = {}) {
    if (this._loadingPromise) {
      await this._loadingPromise.catch(() => {});
    }
    this.updateConfig(cleanCfg);

    try {
      const pool = await poolPromise;
      if (pool && pool.connected) {
        const req = pool.request();
        req.input('InterfaceMode', sql.NVarChar(20), this.mode);
        req.input('TerminalIp', sql.NVarChar(50), this.terminalIp);
        req.input('TerminalPort', sql.Int, this.terminalPort);
        req.input('ComPort', sql.NVarChar(20), this.comPort);
        req.input('BaudRate', sql.Int, this.baudRate);
        req.input('CreditAcquirer', sql.NVarChar(20), this.creditAcquirer || 'DBS');
        req.input('ReceiptMode', sql.NVarChar(50), this.receiptMode || 'POS_PRINT_RP');
        req.input('OnlineTimeoutSec', sql.Int, Math.round(this.onlineTimeoutMs / 1000));
        req.input('OfflineTimeoutSec', sql.Int, Math.round(this.offlineTimeoutMs / 1000));

        const check = await pool.request().query("SELECT COUNT(*) AS cnt FROM [dbo].[NetsTerminalConfig]");
        if (check.recordset && check.recordset[0]?.cnt > 0) {
          await req.query(`
            UPDATE [dbo].[NetsTerminalConfig]
            SET
              InterfaceMode = @InterfaceMode,
              TerminalIp = @TerminalIp,
              TerminalPort = @TerminalPort,
              ComPort = @ComPort,
              BaudRate = @BaudRate,
              CreditAcquirer = @CreditAcquirer,
              ReceiptMode = @ReceiptMode,
              OnlineTimeoutSec = @OnlineTimeoutSec,
              OfflineTimeoutSec = @OfflineTimeoutSec,
              LastUpdated = GETDATE()
            WHERE ConfigId = (SELECT TOP 1 ConfigId FROM [dbo].[NetsTerminalConfig] ORDER BY ConfigId ASC);
          `);
        } else {
          await req.query(`
            INSERT INTO [dbo].[NetsTerminalConfig] (
              InterfaceMode, TerminalIp, TerminalPort, ComPort, BaudRate,
              CreditAcquirer, ReceiptMode, OnlineTimeoutSec, OfflineTimeoutSec, LastUpdated
            ) VALUES (
              @InterfaceMode, @TerminalIp, @TerminalPort, @ComPort, @BaudRate,
              @CreditAcquirer, @ReceiptMode, @OnlineTimeoutSec, @OfflineTimeoutSec, GETDATE()
            );
          `);
        }
        this.lastUpdated = new Date();
        this.loadedFromDb = true;
        console.log(`💾 [NETS] Saved configuration to dbo.NetsTerminalConfig: ${this.mode} (${this.mode === 'LAN' ? this.terminalIp + ':' + this.terminalPort : this.comPort})`);
      }
    } catch (err) {
      console.error('⚠️ [NETS] Failed to persist config to dbo.NetsTerminalConfig:', err.message);
      throw new Error(`Failed to persist configuration to database: ${err.message}`);
    }

    return this.getConfig();
  }

  updateConfig(cfg = {}) {
    if (cfg.mode) this.mode = cfg.mode.toUpperCase();
    if (cfg.terminalIp) this.terminalIp = cfg.terminalIp;
    if (cfg.terminalPort) this.terminalPort = parseInt(cfg.terminalPort, 10);
    if (cfg.comPort) this.comPort = cfg.comPort;
    if (cfg.baudRate) this.baudRate = parseInt(cfg.baudRate, 10);
    if (cfg.creditAcquirer) this.creditAcquirer = cfg.creditAcquirer;
    if (cfg.receiptMode) this.receiptMode = cfg.receiptMode;
    if (cfg.onlineTimeoutMs) this.onlineTimeoutMs = parseInt(cfg.onlineTimeoutMs, 10);
    if (cfg.offlineTimeoutMs) this.offlineTimeoutMs = parseInt(cfg.offlineTimeoutMs, 10);
  }

  getConfig() {
    return {
      mode: this.mode,
      terminalIp: this.terminalIp,
      terminalPort: this.terminalPort,
      comPort: this.comPort,
      baudRate: this.baudRate,
      creditAcquirer: this.creditAcquirer,
      receiptMode: this.receiptMode,
      onlineTimeoutSec: Math.round(this.onlineTimeoutMs / 1000),
      offlineTimeoutSec: Math.round(this.offlineTimeoutMs / 1000),
      lastUpdated: this.lastUpdated,
      loadedFromDb: this.loadedFromDb,
      activeEndpoint: this.mode === 'LAN' ? `${this.terminalIp}:${this.terminalPort}` : `${this.comPort}@${this.baudRate}`
    };
  }

  getRecentLogs() {
    return recentLogs;
  }

  /**
   * Executes a command over Ethernet/LAN (TCP/IP).
   * Follows Section 2.1.3.1 and Section 2.2 error handling.
   */
  async executeLan(ecn, functionCode, fields = [], timeoutMs = 60000) {
    const destination = `${this.terminalIp}:${this.terminalPort}`;
    const serverPort = parseInt(process.env.PORT || '3000', 10);

    // Guard against sending NETS frames to the local Node.js Express server on localhost
    const isLocalhost = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(this.terminalIp);
    if (isLocalhost && (this.terminalPort === serverPort || this.terminalPort === 3000)) {
      const err = new Error(`Cannot connect: Terminal port ${this.terminalPort} on localhost conflicts with local POS HTTP server port.`);
      err.code = 'E_HTTP_PORT_CONFLICT';
      err.diagnostic = {
        targetEndpoint: destination,
        interfaceMode: 'LAN',
        failureReason: 'PORT_CONFLICT_HTTP_SERVER',
        detail: `Port ${this.terminalPort} on localhost is hosting the POS Express HTTP server. NETS ECR II terminals require a dedicated raw TCP socket port (typically 7500 or 9742).`,
        actionRequired: 'Update terminal configuration with the actual NETS terminal IP and port 7500.'
      };
      logComm('ERR [LAN]', '', err.message, { destination, functionCode, ecn, error: err.message });
      throw err;
    }

    const packet = buildLanPacket(ecn, functionCode, fields);
    let attempt = 0;
    const maxAttempts = 1 + this.maxRetries;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        logComm('OUT [LAN]', packet, `Attempt ${attempt}/${maxAttempts}`, {
          destination,
          functionCode,
          ecn,
          declaredLength: packet.length - 2
        });

        const responseBuf = await this._sendLanPacketOnce(packet, timeoutMs, { functionCode, ecn });

        // Check if NAK was received on LAN (Section 2.2.2.2 - terminal busy)
        if (responseBuf.length === 1 && responseBuf[0] === NAK) {
          logComm('IN  [LAN]', 'NAK', 'Terminal replied NAK (busy)', { destination, functionCode, ecn });
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          } else {
            const err = new Error('Terminal busy (received NAK on LAN after retries)');
            err.code = 'TA';
            err.diagnostic = {
              targetEndpoint: destination,
              interfaceMode: 'LAN',
              failureReason: 'TERMINAL_BUSY_NAK',
              detail: 'Terminal returned NAK (0x15). The terminal is currently processing another transaction or menu operation.',
              actionRequired: 'Wait for the current operation on the terminal to complete and retry.'
            };
            throw err;
          }
        }

        const parsed = parseLanResponse(responseBuf);

        logComm('IN  [LAN]', responseBuf, `Response received (RC: ${parsed.responseCode})`, {
          destination,
          functionCode,
          ecn,
          declaredLength: parsed.declaredLength
        });

        if (!parsed.valid) {
          logComm('ERR [LAN]', '', 'Corrupted response received (LRC mismatch)', { destination, functionCode, ecn });
          const err = new Error('Response failed LRC verification (corrupted packet from terminal)');
          err.code = 'E_LRC_MISMATCH';
          err.diagnostic = {
            targetEndpoint: destination,
            interfaceMode: 'LAN',
            failureReason: 'LRC_VALIDATION_FAILED',
            detail: 'The terminal response was received, but the Longitudinal Redundancy Check (LRC) checksum failed.',
            actionRequired: 'Inspect network link stability or interference.'
          };
          throw err;
        }

        return parsed;
      } catch (err) {
        logComm('ERR [LAN]', '', `Attempt ${attempt} error: ${err.message}`, {
          destination,
          functionCode,
          ecn,
          error: err.message
        });

        // Do not retry if the endpoint was identified as an HTTP web server
        if (err.code === 'E_HTTP_ENDPOINT' || err.code === 'E_HTTP_PORT_CONFLICT' || err.code === 'E_INVALID_PROTOCOL') {
          throw err;
        }

        if (attempt >= maxAttempts) {
          throw err;
        }
        // Wait 2s before retry as per Section 2.2.2.3
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    const finalErr = new Error(`Failed to communicate with NETS terminal via LAN after ${maxAttempts} attempts`);
    finalErr.diagnostic = {
      targetEndpoint: destination,
      interfaceMode: 'LAN',
      failureReason: 'MAX_RETRIES_EXCEEDED',
      detail: `All ${maxAttempts} communication attempts failed.`
    };
    throw finalErr;
  }

  _sendLanPacketOnce(packet, timeoutMs, meta = {}) {
    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let timer = null;
      let receivedBuffers = [];
      let expectedTotalLength = null;

      const destination = `${this.terminalIp}:${this.terminalPort}`;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        client.removeAllListeners();
        client.destroy();
      };

      timer = setTimeout(() => {
        cleanup();
        const combined = Buffer.concat(receivedBuffers);
        const bytesReceived = combined.length;

        const timeoutErr = new Error(`NETS terminal LAN timeout after ${timeoutMs}ms (IP: ${destination}). Bytes received: ${bytesReceived}`);
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.diagnostic = {
          targetEndpoint: destination,
          interfaceMode: 'LAN',
          failureReason: bytesReceived === 0 ? 'TIMEOUT_NO_RESPONSE' : 'TIMEOUT_INCOMPLETE_RESPONSE',
          bytesReceived,
          expectedTotalLength,
          detail: bytesReceived === 0
            ? `TCP socket connected to ${destination}, but the device did not send any NETS ECR response data within ${timeoutMs}ms. Verify that ${this.terminalIp} is the actual NETS terminal IP and that the terminal ECR communication port is configured to ${this.terminalPort} (default 7500).`
            : `Received partial response (${bytesReceived} bytes of expected ${expectedTotalLength}), but socket timed out before complete frame was received.`,
          actionRequired: 'Verify that the NETS terminal screen is on the home/idle screen, LAN mode is enabled, and IP/port match.'
        };
        reject(timeoutErr);
      }, timeoutMs);

      client.connect(this.terminalPort, this.terminalIp, () => {
        client.write(packet);
      });

      client.on('data', (chunk) => {
        receivedBuffers.push(chunk);
        const combined = Buffer.concat(receivedBuffers);

        // 1. Immediate HTTP Server Detection:
        // If the remote endpoint sends HTTP response headers ("HTTP/1.1", "<!DOCTYPE", "<html"),
        // it is an HTTP web server, NOT a raw NETS ECR socket.
        const prefix = combined.slice(0, Math.min(12, combined.length)).toString('latin1');
        if (/^HTTP\/|^<html|^<!DOC/i.test(prefix)) {
          cleanup();
          const httpErr = new Error(`Endpoint ${destination} returned an HTTP response instead of NETS ECR binary framing. This is an HTTP web server, NOT a NETS terminal.`);
          httpErr.code = 'E_HTTP_ENDPOINT';
          httpErr.diagnostic = {
            targetEndpoint: destination,
            interfaceMode: 'LAN',
            failureReason: 'HTTP_ENDPOINT_DETECTED',
            detail: `The endpoint responded with HTTP web data ("${prefix.trim()}"). It is a web server (e.g. Node.js Express), NOT a NETS ECR II terminal. NETS ECR II communicates on a raw TCP socket port (typically 7500 or 9742).`,
            actionRequired: `Verify the NETS terminal IP on the terminal's screen (Terminal Menu -> Network Settings) and set the correct IP and port 7500 at /api/nets/config.`
          };
          return reject(httpErr);
        }

        // 2. Protocol Header Check: First 2 bytes must be valid BCD length
        if (combined.length >= 2 && expectedTotalLength === null) {
          if (!isValidBcd2(combined, 0)) {
            cleanup();
            const hexHeader = combined.slice(0, Math.min(8, combined.length)).toString('hex').toUpperCase();
            const protoErr = new Error(`Received non-BCD length header from ${destination} (0x${hexHeader}). The endpoint is not speaking NETS ECR II protocol.`);
            protoErr.code = 'E_INVALID_PROTOCOL';
            protoErr.diagnostic = {
              targetEndpoint: destination,
              interfaceMode: 'LAN',
              failureReason: 'NON_BCD_PROTOCOL_HEADER',
              detail: `The device sent non-BCD header bytes (0x${hexHeader}). A valid NETS ECR LAN response must begin with a 2-byte BCD length.`,
              actionRequired: `Check whether port ${this.terminalPort} on ${this.terminalIp} is used by another service. NETS ECR typically listens on port 7500.`
            };
            return reject(protoErr);
          }

          const declared = fromBcd2(combined, 0);
          expectedTotalLength = declared + 2; // 2 bytes length + body + LRC
        }

        // 3. Header Framing Check: Once 20 bytes are received, verify Field Separator at byte 19
        if (combined.length >= 20 && expectedTotalLength !== null) {
          if (combined[19] !== FS) {
            cleanup();
            const frameErr = new Error(`Malformed NETS ECR header from ${destination}: missing Field Separator (0x1C) at byte 19.`);
            frameErr.code = 'E_INVALID_PROTOCOL';
            frameErr.diagnostic = {
              targetEndpoint: destination,
              interfaceMode: 'LAN',
              failureReason: 'INVALID_HEADER_FRAMING',
              detail: `Byte 19 is 0x${combined[19].toString(16).toUpperCase()}, expected Field Separator 0x1C.`,
              actionRequired: 'Verify that the target device is a NETS ECR II terminal.'
            };
            return reject(frameErr);
          }
        }

        if (expectedTotalLength && combined.length >= expectedTotalLength) {
          cleanup();
          resolve(combined.slice(0, expectedTotalLength));
        }
      });

      client.on('error', (err) => {
        cleanup();
        let failureReason = 'SOCKET_ERROR';
        let detail = err.message;
        let actionRequired = 'Check terminal power, network cable, and IP configuration.';

        if (err.code === 'ECONNREFUSED') {
          failureReason = 'CONNECTION_REFUSED';
          detail = `Connection refused by ${destination}. No service is listening on port ${this.terminalPort} or the terminal is powered off.`;
          actionRequired = `Verify the NETS terminal is powered on, connected to the local network, and port ${this.terminalPort} is configured for ECR.`;
        } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
          failureReason = 'HOST_UNREACHABLE';
          detail = `Host ${this.terminalIp} is unreachable from this POS machine.`;
          actionRequired = `Check physical ethernet / Wi-Fi connection and ensure POS machine and NETS terminal are on the same subnet.`;
        } else if (err.code === 'ETIMEDOUT') {
          failureReason = 'TCP_CONNECT_TIMEOUT';
          detail = `TCP connection handshake to ${destination} timed out without connecting.`;
          actionRequired = `Check firewall rules and verify the terminal IP address.`;
        }

        const customErr = new Error(`TCP socket error connecting to ${destination} - ${err.message}`);
        customErr.code = err.code;
        customErr.diagnostic = {
          targetEndpoint: destination,
          interfaceMode: 'LAN',
          failureReason,
          detail,
          suggestedAction: actionRequired
        };
        reject(customErr);
      });

      client.on('close', () => {
        if (receivedBuffers.length > 0 && expectedTotalLength && Buffer.concat(receivedBuffers).length >= expectedTotalLength) {
          // Handled in 'data'
        } else if (receivedBuffers.length > 0) {
          cleanup();
          resolve(Buffer.concat(receivedBuffers));
        }
      });
    });
  }

  /**
   * Executes a command over RS-232 serial.
   */
  async executeRs232(ecn, functionCode, fields = [], timeoutMs = 60000) {
    let SerialPort;
    try {
      SerialPort = require('serialport').SerialPort;
    } catch (e) {
      throw new Error(`SerialPort package not installed. RS-232 mode requires 'serialport'. Please use LAN mode or install serialport.`);
    }

    const destination = `${this.comPort}@${this.baudRate}`;
    const packet = buildRs232Packet(ecn, functionCode, fields);
    let attempt = 0;
    const maxAttempts = 1 + this.maxRetries;

    const port = new SerialPort({
      path: this.comPort,
      baudRate: this.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: false
    });

    await new Promise((resolve, reject) => {
      port.open(err => (err ? reject(err) : resolve()));
    });

    try {
      while (attempt < maxAttempts) {
        attempt++;
        logComm('OUT [RS232]', packet, `Attempt ${attempt}/${maxAttempts}`, {
          destination,
          functionCode,
          ecn,
          declaredLength: packet.length - 5
        });

        // Step 1: Send command and wait for ACK (0x06) within 2 seconds (Section 2.2.2.3)
        const ackReceived = await this._sendAndAwaitAck(port, packet, this.ackTimeoutMs);
        if (!ackReceived) {
          logComm('ERR [RS232]', '', `No ACK received within ${this.ackTimeoutMs}ms (attempt ${attempt})`, {
            destination,
            functionCode,
            ecn
          });
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          const err = new Error(`Terminal did not acknowledge command (No ACK received after ${maxAttempts} attempts)`);
          err.code = 'NO_ACK';
          err.diagnostic = {
            targetEndpoint: destination,
            interfaceMode: 'RS232',
            failureReason: 'NO_ACK_RECEIVED',
            detail: `Terminal did not respond with ACK (0x06) within ${this.ackTimeoutMs}ms.`
          };
          throw err;
        }

        logComm('IN  [RS232]', Buffer.from([ACK]), 'ACK received from terminal', { destination, functionCode, ecn });

        // Step 2: Wait for response data packet (up to timeoutMs)
        const responseBuf = await this._readRs232Response(port, timeoutMs);
        const parsed = parseRs232Response(responseBuf);

        logComm('IN  [RS232]', responseBuf, `Response packet received (RC: ${parsed.responseCode})`, {
          destination,
          functionCode,
          ecn,
          declaredLength: parsed.declaredLength
        });

        // Step 3: Validate LRC and send ACK (or NAK on corruption)
        if (!parsed.valid) {
          logComm('OUT [RS232]', Buffer.from([NAK]), 'Corrupted response received, sending NAK', { destination, functionCode, ecn });
          port.write(Buffer.from([NAK]));
          const err = new Error('Response failed LRC verification (corrupted packet from terminal)');
          err.code = 'E_LRC_MISMATCH';
          err.diagnostic = {
            targetEndpoint: destination,
            interfaceMode: 'RS232',
            failureReason: 'LRC_VALIDATION_FAILED',
            detail: 'Corrupted response packet received over RS-232 serial cable.'
          };
          throw err;
        }

        // Send ACK back to terminal to confirm receipt (Section 2.2.1)
        logComm('OUT [RS232]', Buffer.from([ACK]), 'Sending ACK to terminal for valid response', { destination, functionCode, ecn });
        port.write(Buffer.from([ACK]));
        return parsed;
      }
    } finally {
      if (port.isOpen) {
        port.close();
      }
    }
  }

  _sendAndAwaitAck(port, packet, timeoutMs) {
    return new Promise((resolve) => {
      let timer = null;
      const onData = (data) => {
        for (let i = 0; i < data.length; i++) {
          if (data[i] === ACK) {
            clearTimeout(timer);
            port.removeListener('data', onData);
            return resolve(true);
          } else if (data[i] === NAK) {
            clearTimeout(timer);
            port.removeListener('data', onData);
            return resolve(false);
          }
        }
      };

      timer = setTimeout(() => {
        port.removeListener('data', onData);
        resolve(false);
      }, timeoutMs);

      port.on('data', onData);
      port.write(packet);
    });
  }

  _readRs232Response(port, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer = null;
      let chunks = [];
      let expectedTotalLength = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        port.removeAllListeners('data');
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for NETS response on ${this.comPort} after ${timeoutMs}ms`));
      }, timeoutMs);

      port.on('data', (data) => {
        chunks.push(data);
        const combined = Buffer.concat(chunks);

        // RS232: STX (1) + LEN (2) + Body (LEN) + ETX (1) + LRC (1)
        if (combined.length >= 3 && expectedTotalLength === null) {
          const bodyLen = fromBcd2(combined, 1);
          expectedTotalLength = 1 + 2 + bodyLen + 1 + 1;
        }

        if (expectedTotalLength && combined.length >= expectedTotalLength) {
          cleanup();
          resolve(combined.slice(0, expectedTotalLength));
        }
      });
    });
  }

  /**
   * Unified execute method that dispatches to LAN or RS232 based on configured mode.
   */
  async execute(ecn, functionCode, fields = [], timeoutMs = null) {
    const finalTimeout = timeoutMs || (functionCode === '30' || functionCode === 'Q2' || functionCode === 'I0' ? this.onlineTimeoutMs : this.offlineTimeoutMs);

    if (this.mode === 'RS232') {
      return this.executeRs232(ecn, functionCode, fields, finalTimeout);
    }
    return this.executeLan(ecn, functionCode, fields, finalTimeout);
  }
}

// Global transport singleton
const defaultTransport = new NetsTransport();

// Attempt background load from database on startup
defaultTransport.loadConfigFromDb().catch(err => {
  console.warn('⚠️ [NETS] Initial DB config load deferred:', err.message);
});

module.exports = {
  NetsTransport,
  defaultTransport,
  logComm,
  maskSensitiveHex
};
