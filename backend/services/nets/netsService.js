/**
 * netsService.js
 * Business logic service for NETS ECR II terminal integration.
 * Manages ECN counter, function executions, same-ECN recovery, in-flight locks,
 * and database transaction auditing.
 */

const fs = require('fs');
const path = require('path');
const { defaultTransport } = require('./netsTransport');
const { getResponseDescription } = require('./netsProtocol');
const { getPool, sql } = require('../../config/db');

const ECN_FILE = path.resolve(__dirname, '../../config/nets_ecn.json');

// In-flight payment lock guard to prevent concurrent double-charging
const activePaymentLocks = new Map();

class NetsService {
  constructor(transport = defaultTransport) {
    this.transport = transport;
    this.currentEcn = this._loadEcn();
  }

  _loadEcn() {
    try {
      if (fs.existsSync(ECN_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ECN_FILE, 'utf8'));
        if (typeof raw.ecn === 'number') {
          return raw.ecn;
        }
      }
    } catch (e) {
      console.warn('⚠️ Could not load nets_ecn.json, initializing to 1');
    }
    return 1;
  }

  _saveEcn(val) {
    try {
      const dir = path.dirname(ECN_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(ECN_FILE, JSON.stringify({ ecn: val, lastUpdated: new Date().toISOString() }, null, 2), 'utf8');
    } catch (e) {
      console.error('⚠️ Could not save nets_ecn.json:', e.message);
    }
  }

  /**
   * Generates next sequential 12-digit ECN: e.g. "000000000123"
   */
  getNextEcn() {
    this.currentEcn = (this.currentEcn % 999999999999) + 1;
    this._saveEcn(this.currentEcn);
    return String(this.currentEcn).padStart(12, '0');
  }

  getCurrentEcn() {
    return String(this.currentEcn).padStart(12, '0');
  }

  /**
   * Formats decimal dollar amount into 12-digit cents string (e.g. 10.50 -> "000000001050")
   */
  formatAmountCents(amount) {
    const cents = Math.round(parseFloat(amount || 0) * 100);
    return String(cents).padStart(12, '0');
  }

  /**
   * Parses 12-digit cents string into decimal dollars (e.g. "000000001050" -> 10.50)
   */
  parseAmountCents(centsStr) {
    const val = parseInt(centsStr || '0', 10);
    return isNaN(val) ? 0 : val / 100;
  }

  /**
   * Function Code 55: Request Terminal Status
   * Checks whether the terminal is connected and ready to accept financial transactions.
   */
  async requestTerminalStatus(timeoutMs = 10000) {
    const ecn = this.getNextEcn();
    const config = typeof this.transport.getConfig === 'function'
      ? this.transport.getConfig()
      : { mode: 'LAN', activeEndpoint: 'LAN (Configured Endpoint)' };
    console.log(`📡 [NETS] Request Terminal Status (FC 55) - ECN: ${ecn} - Endpoint: ${config.activeEndpoint}`);

    try {
      const response = await this.transport.execute(ecn, '55', [], timeoutMs);
      const isReady = response.responseCode === '00';
      const description = getResponseDescription(response.responseCode);

      return {
        success: isReady,
        ecn: response.ecn,
        functionCode: '55',
        responseCode: response.responseCode,
        isApproved: isReady,
        message: isReady ? 'Terminal is ready to accept transactions' : description,
        rawHex: response.rawHex,
        fields: response.fields,
        diagnostic: {
          targetEndpoint: config.activeEndpoint,
          interfaceMode: config.mode,
          status: isReady ? 'ONLINE_READY' : 'TERMINAL_NOT_READY',
          responseCode: response.responseCode,
          detail: isReady ? 'Terminal responded with Approval code 00.' : `Terminal responded with response code ${response.responseCode}: ${description}`
        }
      };
    } catch (err) {
      const diag = err.diagnostic || {
        targetEndpoint: config.activeEndpoint,
        interfaceMode: config.mode,
        failureReason: err.code || 'COMM_FAILURE',
        detail: err.message,
        actionRequired: 'Verify the physical connection, terminal power, and ECR settings.'
      };

      let responseCode = 'HS';
      if (err.code === 'ETIMEDOUT') responseCode = 'TO';
      else if (err.code === 'E_HTTP_ENDPOINT' || err.code === 'E_HTTP_PORT_CONFLICT') responseCode = 'CFG_ERR';
      else if (err.code === 'E_LRC_MISMATCH') responseCode = 'LRC_ERR';
      else if (err.code === 'TA') responseCode = 'TA';

      return {
        success: false,
        ecn,
        functionCode: '55',
        responseCode,
        isApproved: false,
        message: `Terminal status check failed: ${err.message}`,
        error: err.message,
        diagnostic: diag
      };
    }
  }

  /**
   * Function Code 56: Get Last Approved Transaction
   * Retrieves the details of the last approved financial transaction from the terminal.
   */
  async getLastApprovedTransaction(timeoutMs = 15000) {
    const ecn = this.getNextEcn();
    console.log(`📡 [NETS] Get Last Approved Transaction (FC 56) - ECN: ${ecn}`);

    const response = await this.transport.execute(ecn, '56', [], timeoutMs);
    const isApproved = response.responseCode === '00';

    return {
      success: isApproved,
      ecn: response.ecn,
      functionCode: '56',
      responseCode: response.responseCode,
      isApproved,
      message: getResponseDescription(response.responseCode),
      lastFunctionCode: response.fields['FC'] || null,
      fields: response.fields,
      rawHex: response.rawHex
    };
  }

  /**
   * Function Code 80: NETS Logon
   * Initiates the terminal to perform logon to NETS host.
   */
  async logon(timeoutMs = 60000) {
    const ecn = this.getNextEcn();
    console.log(`📡 [NETS] Logon (FC 80) - ECN: ${ecn}`);

    const response = await this.transport.execute(ecn, '80', [], timeoutMs);
    const isApproved = response.responseCode === '00';

    return {
      success: isApproved,
      ecn: response.ecn,
      functionCode: '80',
      responseCode: response.responseCode,
      isApproved,
      message: isApproved ? 'NETS Logon Successful' : getResponseDescription(response.responseCode),
      fields: response.fields,
      rawHex: response.rawHex
    };
  }

  /**
   * Function Code 81: NETS Settlement
   * Initiates terminal to perform settlement to NETS host and clear current batch.
   */
  async netsSettlement(timeoutMs = 90000) {
    const ecn = this.getNextEcn();
    console.log(`📡 [NETS] Settlement (FC 81) - ECN: ${ecn}`);

    const response = await this.transport.execute(ecn, '81', [], timeoutMs);
    const isApproved = response.responseCode === '00';

    return {
      success: isApproved,
      ecn: response.ecn,
      functionCode: '81',
      responseCode: response.responseCode,
      isApproved,
      message: isApproved ? 'NETS Settlement Completed' : getResponseDescription(response.responseCode),
      receiptText: response.fields['RP'] || '',
      fields: response.fields,
      rawHex: response.rawHex
    };
  }

  /**
   * Function Code I5: Credit Card Settlement
   * Performs settlement for the configured credit card acquirer (e.g. DBS, UOB, OCBC).
   */
  async creditSettlement(acquirerName = 'DBS', timeoutMs = 90000) {
    const ecn = this.getNextEcn();
    console.log(`📡 [NETS] Credit Settlement (FC I5) - Acquirer: ${acquirerName} - ECN: ${ecn}`);

    const acquirerField = { code: '9G', data: String(acquirerName || 'DBS').padEnd(6, ' ') };
    const response = await this.transport.execute(ecn, 'I5', [acquirerField], timeoutMs);
    const isApproved = response.responseCode === '00';

    return {
      success: isApproved,
      ecn: response.ecn,
      functionCode: 'I5',
      responseCode: response.responseCode,
      isApproved,
      message: isApproved ? 'Credit Settlement Completed' : getResponseDescription(response.responseCode),
      receiptText: response.fields['RP'] || '',
      fields: response.fields,
      rawHex: response.rawHex
    };
  }

  /**
   * Function Code 84: TMS / CTS Update
   * Triggers terminal to connect to TMS for parameter, log diagnostic, and software update.
   * Terminal initiates a mandatory reboot after this command.
   */
  async tmsUpdate(timeoutMs = 30000) {
    const ecn = this.getNextEcn();
    console.log(`📡 [NETS] TMS Update (FC 84) - ECN: ${ecn}`);

    const response = await this.transport.execute(ecn, '84', [], timeoutMs);
    const isApproved = response.responseCode === '00';

    return {
      success: isApproved,
      ecn: response.ecn,
      functionCode: '84',
      responseCode: response.responseCode,
      isApproved,
      message: isApproved ? 'TMS Update Initiated. Terminal rebooting.' : getResponseDescription(response.responseCode),
      fields: response.fields,
      rawHex: response.rawHex
    };
  }

  /**
   * Automated End-Of-Day (EOD) Settlement Sequence:
   * 1. Credit Card Settlement (I5)
   * 2. Delay ~20 seconds
   * 3. NETS Settlement (81)
   * 4. Delay ~20 seconds
   * 5. TMS Update (84)
   */
  async runEodSequence(acquirerName = 'DBS') {
    const logs = [];
    console.log('🔄 [NETS EOD] Starting full End-of-Day sequence...');

    // 1. Credit Settlement
    let creditRes = null;
    try {
      creditRes = await this.creditSettlement(acquirerName);
      logs.push({ step: 'CREDIT_SETTLEMENT', success: creditRes.success, result: creditRes });
    } catch (err) {
      logs.push({ step: 'CREDIT_SETTLEMENT', success: false, error: err.message });
    }

    // 20 second delay
    console.log('⏳ [NETS EOD] Waiting 20 seconds before NETS settlement...');
    await new Promise(r => setTimeout(r, 20000));

    // 2. NETS Settlement
    let netsRes = null;
    try {
      netsRes = await this.netsSettlement();
      logs.push({ step: 'NETS_SETTLEMENT', success: netsRes.success, result: netsRes });
    } catch (err) {
      logs.push({ step: 'NETS_SETTLEMENT', success: false, error: err.message });
    }

    // 20 second delay
    console.log('⏳ [NETS EOD] Waiting 20 seconds before TMS Update...');
    await new Promise(r => setTimeout(r, 20000));

    // 3. TMS Update
    let tmsRes = null;
    try {
      tmsRes = await this.tmsUpdate();
      logs.push({ step: 'TMS_UPDATE', success: tmsRes.success, result: tmsRes });
    } catch (err) {
      logs.push({ step: 'TMS_UPDATE', success: false, error: err.message });
    }

    return {
      success: (creditRes?.success !== false) && (netsRes?.success !== false) && (tmsRes?.success !== false),
      steps: logs
    };
  }

  /**
   * Function Code 30: All NETS Purchase
   * Parameters:
   * - amount: Transaction amount (e.g. 10.50)
   * - isQrOnTerminal: boolean (true for T2='04' QR, false for T2='01' Card Purchase)
   * - ecrRef: ECR Reference Number (HD field, max 13/19 chars)
   * - lockKey: unique string (e.g. TableId or OrderId) to prevent concurrent double charges
   */
  async processPurchase({ amount, isQrOnTerminal = false, ecrRef = '', lockKey = null, timeoutMs = 120000 }) {
    if (lockKey && activePaymentLocks.has(lockKey)) {
      throw new Error(`Payment transaction is already in progress for this order/table (${lockKey}). Please wait.`);
    }

    if (lockKey) {
      activePaymentLocks.set(lockKey, Date.now());
    }

    const ecn = this.getNextEcn();
    const amountCents = this.formatAmountCents(amount);
    const transType = isQrOnTerminal ? '04' : '01';
    const cleanRef = String(ecrRef || `ECR${Date.now()}`).slice(0, 19);

    const fields = [
      { code: 'T2', data: transType },
      { code: '40', data: amountCents },
      { code: '42', data: '000000000000' }, // Cashback amount (0)
      { code: 'HD', data: cleanRef }
    ];

    console.log(`📡 [NETS] Purchase (FC 30) - Amount: $${amount} - Type: ${transType} - ECN: ${ecn} - Ref: ${cleanRef}`);

    try {
      let response;
      try {
        response = await this.transport.execute(ecn, '30', fields, timeoutMs);
      } catch (commErr) {
        console.warn(`⚠️ [NETS] Initial purchase request timed out or dropped: ${commErr.message}. Initiating Same-ECN Recovery...`);
        // Exception handling per Section 2.2.2.6 & UAT Certification Requirement:
        // Query status using same ECN or Function Code 56
        response = await this._recoverTransaction(ecn, cleanRef);
      }

      const isApproved = response.responseCode === '00';
      const approvalCode = response.fields['01'] || '';
      const stan = response.fields['65'] || response.fields['H6'] || '';
      const rrn = response.fields['D3'] || '';
      const cardName = response.fields['L7'] || '';
      const terminalId = response.fields['16'] || '';
      const receiptText = response.fields['RP'] || '';

      // Extra check per Row 15 of POS Integration Information Form:
      // Approval code must not be '000000' and Host Response Code HC should be '00'
      const hostResponseCode = response.fields['HC'] || '';
      const strictlyApproved = isApproved && approvalCode.trim() !== '000000' && (hostResponseCode === '' || hostResponseCode === '00');

      const result = {
        success: strictlyApproved,
        isApproved: strictlyApproved,
        ecn: response.ecn,
        functionCode: '30',
        responseCode: response.responseCode,
        responseDesc: getResponseDescription(response.responseCode),
        amount: parseFloat(amount),
        approvalCode: approvalCode.trim(),
        stan: stan.trim(),
        rrn: rrn.trim(),
        cardName: cardName.trim(),
        terminalId: terminalId.trim(),
        receiptText,
        hostResponseCode,
        fields: response.fields,
        rawHex: response.rawHex
      };

      // Audit to database if available
      this._auditTransaction(result, cleanRef).catch(e => console.error('DB audit error:', e.message));

      return result;
    } finally {
      if (lockKey) {
        activePaymentLocks.delete(lockKey);
      }
    }
  }

  /**
   * Same-ECN recovery procedure per Section 2.2.2.6 & UAT Certification (POS-013, POS-014)
   */
  async _recoverTransaction(sameEcn, ecrRef) {
    console.log(`🔄 [NETS Recovery] Retrying with SAME ECN (${sameEcn}) to retrieve cached transaction status...`);
    try {
      // Sending same ECN command causes terminal to return cached response without charging again
      const response = await this.transport.execute(sameEcn, '56', [], 10000);
      if (response.responseCode === '00') {
        return response;
      }
    } catch (e) {
      console.warn(`⚠️ [NETS Recovery] Same-ECN query failed: ${e.message}. Attempting Get Last Approved (FC 56)...`);
    }

    // Fallback: Query last approved transaction (FC 56)
    const lastApproved = await this.getLastApprovedTransaction(10000);
    return lastApproved;
  }

  /**
   * Function Code Q1: Request NETS QR Payload (POS-displayed QR)
   */
  async requestQrPayload({ amount, ecrRef = '', timeoutMs = 30000 }) {
    const ecn = this.getNextEcn();
    const amountCents = this.formatAmountCents(amount);
    const cleanRef = String(ecrRef || `QR${Date.now()}`).slice(0, 19);

    const fields = [
      { code: '40', data: amountCents },
      { code: 'HD', data: cleanRef }
    ];

    console.log(`📡 [NETS] Request QR Payload (FC Q1) - Amount: $${amount} - ECN: ${ecn}`);
    const response = await this.transport.execute(ecn, 'Q1', fields, timeoutMs);
    const isApproved = response.responseCode === '00';

    return {
      success: isApproved,
      ecn: response.ecn,
      functionCode: 'Q1',
      responseCode: response.responseCode,
      message: getResponseDescription(response.responseCode),
      qrPayload: response.fields['Q0'] || '',
      qrTimerSeconds: parseInt(response.fields['Q1'] || '180', 10),
      merchantName: response.fields['D0'] || '',
      ecrRef: cleanRef,
      fields: response.fields,
      rawHex: response.rawHex
    };
  }

  /**
   * Function Code Q2: NETS QR Payment Confirmation (POS-displayed QR)
   */
  async queryQrPayment({ amount, qrPayload, ecrRef = '', timeoutMs = 120000 }) {
    const ecn = this.getNextEcn();
    const amountCents = this.formatAmountCents(amount);
    const cleanRef = String(ecrRef || `QR${Date.now()}`).slice(0, 19);

    const fields = [
      { code: '40', data: amountCents },
      { code: 'Q0', data: qrPayload || '' },
      { code: 'HD', data: cleanRef }
    ];

    console.log(`📡 [NETS] Verify QR Payment (FC Q2) - ECN: ${ecn}`);
    const response = await this.transport.execute(ecn, 'Q2', fields, timeoutMs);
    const isApproved = response.responseCode === '00';

    const result = {
      success: isApproved,
      isApproved,
      ecn: response.ecn,
      functionCode: 'Q2',
      responseCode: response.responseCode,
      message: isApproved ? 'NETS QR Payment Approved' : getResponseDescription(response.responseCode),
      approvalCode: (response.fields['01'] || '').trim(),
      stan: (response.fields['65'] || response.fields['H6'] || '').trim(),
      rrn: (response.fields['D3'] || '').trim(),
      receiptText: response.fields['RP'] || '',
      fields: response.fields,
      rawHex: response.rawHex
    };

    this._auditTransaction(result, cleanRef).catch(e => console.error('DB audit error:', e.message));
    return result;
  }

  async _auditTransaction(result, referenceNo) {
    try {
      const pool = getPool();
      if (!pool || !pool.connected) return;

      await pool.request()
        .input('DeviceSN', sql.NVarChar(100), result.terminalId || 'NETS_TERMINAL')
        .input('RequestPayload', sql.NVarChar(sql.MAX), JSON.stringify({ ecn: result.ecn, functionCode: result.functionCode, referenceNo }))
        .input('ResponsePayload', sql.NVarChar(sql.MAX), JSON.stringify({ fields: result.fields, rawHex: result.rawHex }))
        .input('ResponseCode', sql.Int, parseInt(result.responseCode, 10) || (result.isApproved ? 0 : -1))
        .input('ResponseMsg', sql.NVarChar(500), result.message || result.responseDesc || '')
        .input('Status', sql.NVarChar(20), result.isApproved ? 'SUCCESS' : 'FAILED')
        .query(`
          IF OBJECT_ID('PaymentGatewayTransactions', 'U') IS NOT NULL
          BEGIN
            INSERT INTO PaymentGatewayTransactions (
              DeviceSN, RequestPayload, ResponsePayload, ResponseCode, ResponseMsg, Status,
              RequestTime, ResponseTime
            ) VALUES (
              @DeviceSN, @RequestPayload, @ResponsePayload, @ResponseCode, @ResponseMsg, @Status,
              GETDATE(), GETDATE()
            )
          END
        `);
    } catch (e) {
      console.warn('⚠️ [NETS Audit] Failed to log transaction to DB:', e.message);
    }
  }
}

// Global netsService instance
const defaultNetsService = new NetsService();

module.exports = {
  NetsService,
  defaultNetsService
};
