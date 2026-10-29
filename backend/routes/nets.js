/**
 * nets.js
 * Express router for NETS ECR II terminal integration.
 */

const express = require('express');
const router = express.Router();
const { defaultNetsService } = require('../services/nets/netsService');
const { defaultTransport } = require('../services/nets/netsTransport');

function broadcastTerminalStatus(io, tableId, amount, method, result) {
  if (!io) return;
  const targetTableId = tableId || 'COUNTER';

  const status = result.isApproved || result.success ? 'success' : 'failed';
  const message = result.isApproved || result.success
    ? `✅ $${parseFloat(amount || 0).toFixed(2)} paid via ${method}`
    : `❌ ${result.message || result.responseDesc || 'Payment failed'}`;

  console.log(`🔌 [NETS Socket] Broadcasting terminal sync for Table ${targetTableId} → Status: ${status}`);
  io.emit('terminal_payment_sync', {
    tableId: targetTableId,
    session: {
      tableId: targetTableId,
      status,
      message,
      method,
      total: parseFloat(amount) || 0,
      approvalCode: result.approvalCode || '',
      stan: result.stan || '',
      rrn: result.rrn || '',
      receiptText: result.receiptText || ''
    }
  });
}

// 🔹 1. Check Terminal Status (FC 55)
router.get('/status', async (req, res) => {
  try {
    const result = await defaultNetsService.requestTerminalStatus();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 2. All NETS Purchase (FC 30) - Card or Terminal QR
router.post('/purchase', async (req, res) => {
  const { amount, isQrOnTerminal, ecrRef, tableId } = req.body;

  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid or zero transaction amount' });
  }

  const lockKey = tableId ? `table_${tableId}` : (ecrRef || `order_${Date.now()}`);

  try {
    const method = isQrOnTerminal ? 'NETS QR' : 'NETS CARD';
    const result = await defaultNetsService.processPurchase({
      amount: parseFloat(amount),
      isQrOnTerminal: !!isQrOnTerminal,
      ecrRef,
      lockKey
    });

    broadcastTerminalStatus(req.io, tableId, amount, method, result);
    res.json(result);
  } catch (err) {
    const failResult = { success: false, isApproved: false, message: err.message };
    broadcastTerminalStatus(req.io, tableId, amount, 'NETS', failResult);
    res.status(500).json(failResult);
  }
});

// 🔹 3. Request POS-Displayed NETS QR Payload (FC Q1)
router.post('/qr-request', async (req, res) => {
  const { amount, ecrRef } = req.body;
  if (!amount || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid amount' });
  }

  try {
    const result = await defaultNetsService.requestQrPayload({
      amount: parseFloat(amount),
      ecrRef
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 4. Query POS-Displayed NETS QR Payment (FC Q2)
router.post('/qr-query', async (req, res) => {
  const { amount, qrPayload, ecrRef, tableId } = req.body;

  try {
    const result = await defaultNetsService.queryQrPayment({
      amount: parseFloat(amount),
      qrPayload,
      ecrRef
    });

    broadcastTerminalStatus(req.io, tableId, amount, 'NETS QR (POS)', result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 5. Get Last Approved Transaction (FC 56)
router.post('/last-approved', async (req, res) => {
  try {
    const result = await defaultNetsService.getLastApprovedTransaction();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 6. NETS Logon (FC 80)
router.post('/logon', async (req, res) => {
  try {
    const result = await defaultNetsService.logon();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 7. NETS Settlement (FC 81)
router.post('/settlement', async (req, res) => {
  try {
    const result = await defaultNetsService.netsSettlement();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 8. Credit Card Settlement (FC I5)
router.post('/settlement-credit', async (req, res) => {
  const { acquirerName } = req.body;
  try {
    const result = await defaultNetsService.creditSettlement(acquirerName || 'DBS');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 9. TMS / CTS Update (FC 84)
router.post('/tms-update', async (req, res) => {
  try {
    const result = await defaultNetsService.tmsUpdate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 10. End-Of-Day Sequence (Credit -> ~20s delay -> NETS -> ~20s delay -> TMS)
router.post('/eod-sequence', async (req, res) => {
  const { acquirerName } = req.body;
  try {
    const result = await defaultNetsService.runEodSequence(acquirerName || 'DBS');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 11. Get / Update Terminal Config
router.get('/config', async (req, res) => {
  try {
    const config = await defaultTransport.loadConfigFromDb();
    const serverPort = parseInt(process.env.PORT || '3000', 10);
    res.json({
      success: true,
      config,
      currentEcn: defaultNetsService.getCurrentEcn(),
      posServerInfo: {
        httpPort: serverPort,
        warning: `Do not configure terminal port to ${serverPort} (reserved for POS Express HTTP API). NETS ECR II raw TCP terminal port is typically 7500 (or 9742).`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/config', async (req, res) => {
  try {
    const serverPort = parseInt(process.env.PORT || '3000', 10);
    const validation = defaultTransport.validateConfig(req.body, serverPort);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Terminal configuration validation failed',
        errors: validation.errors
      });
    }

    const updatedConfig = await defaultTransport.saveConfigToDb(validation.clean);

    res.json({
      success: true,
      message: 'Terminal configuration updated and persisted to database successfully',
      config: updatedConfig
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 12. Get Communication Logs (STX, ETX, LRC, Hex with timestamps)
router.get('/logs', (req, res) => {
  res.json({
    success: true,
    logs: defaultTransport.getRecentLogs()
  });
});

module.exports = router;
