const express = require('express');
const router = express.Router();
const { getPool, sql } = require('../config/db');

// Middleware to authenticate the print bridge requests
const authenticateBridge = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const storeId = req.headers['x-store-id'] || req.query.storeId || req.body.storeId;

  const expectedToken = process.env.BRIDGE_TOKEN || 'unipro-pos-bridge-token-2026';

  if (!token || token !== expectedToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Bridge Token' });
  }

  if (!storeId) {
    return res.status(400).json({ success: false, error: 'Bad Request: Missing Store ID' });
  }

  req.storeId = storeId;
  next();
};

// 1. POST /api/print-jobs/auth - Verify connection on bridge startup
router.post('/auth', authenticateBridge, (req, res) => {
  res.json({ success: true, message: 'Authenticated successfully', storeId: req.storeId });
});

let lastBridgeActivity = 0;
let lastBridgeIp = '';

const normalizeIp = (ip) => {
  if (!ip) return '';
  const match = ip.match(/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/);
  if (match) return match[1];
  return ip.trim();
};

// GET /api/print-jobs/bridge-status - Check if print bridge is active/online
router.get('/bridge-status', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT DATEDIFF(SECOND, LastBridgeHeartbeat, GETDATE()) AS SecondsSinceHeartbeat 
      FROM CompanySettings 
      WHERE Id = '1'
    `);
    if (result.recordset.length > 0 && result.recordset[0].SecondsSinceHeartbeat !== null) {
      const isOnline = result.recordset[0].SecondsSinceHeartbeat < 8; // 8 seconds threshold
      return res.json({ success: true, online: isOnline });
    }
    const isOnline = (Date.now() - lastBridgeActivity) < 8000;
    res.json({ success: true, online: isOnline });
  } catch (err) {
    console.error('Error checking print bridge status:', err);
    const isOnline = (Date.now() - lastBridgeActivity) < 8000;
    res.json({ success: true, online: isOnline });
  }
});

// 2. GET /api/print-jobs/pending - Fetch pending jobs for the store
router.get('/pending', authenticateBridge, async (req, res) => {
  lastBridgeActivity = Date.now();
  lastBridgeIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const pool = getPool();

  // Persist heartbeat in DB to support multi-instance servers/restarts
  try {
    await pool.request().query("UPDATE CompanySettings SET LastBridgeHeartbeat = GETDATE() WHERE Id = '1'");
  } catch (dbErr) {
    console.error('Failed to save bridge heartbeat in database:', dbErr.message);
  }

  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();
    
    // Select pending jobs with database-level row locking and skipping locked rows
    const selectReq = new sql.Request(transaction);
    const result = await selectReq
      .input('StoreId', sql.NVarChar(50), req.storeId)
      .query(`
        SELECT JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, Attempts, ProcessedOn
        FROM PrintJobQueue WITH (UPDLOCK, READPAST)
        WHERE StoreId = @StoreId 
          AND (
            (Status = 'PENDING' AND (
              Attempts = 0 
              OR (Attempts = 1 AND DATEDIFF(second, ProcessedOn, GETDATE()) >= 2)
              OR (Attempts = 2 AND DATEDIFF(second, ProcessedOn, GETDATE()) >= 5)
            ))
            OR (Status = 'PROCESSING' AND DATEDIFF(minute, ProcessedOn, GETDATE()) >= 2 AND Attempts < 3)
          )
        ORDER BY CreatedOn ASC
      `);

    let jobs = result.recordset || [];

    if (jobs.length > 0) {
      // NOTE: Do NOT decode the base64 cash drawer command here.
      // Keeping Content as 'G3AAGRk=' (base64) ensures printer.ts routes it
      // through the binary path — no line feeds or paper cut appended.

      // Mark them as PROCESSING
      const jobIds = jobs.map(j => `'${j.JobId}'`).join(',');
      const updateReq = new sql.Request(transaction);
      await updateReq.query(`
        UPDATE PrintJobQueue
        SET Status = 'PROCESSING', ProcessedOn = GETDATE(), Attempts = Attempts + 1
        WHERE JobId IN (${jobIds})
      `);

      // Log picked jobs
      jobs.forEach(job => {
        console.log(`[PrintQueue] Job picked: ID=${job.JobId}, Printer=${job.PrinterName} (${job.PrinterIp}:${job.PrinterPort}), Attempt=${job.Attempts + 1}`);
      });
    }

    await transaction.commit();
    res.json({ success: true, data: jobs });

  } catch (err) {
    try { await transaction.rollback(); } catch (e) {}
    console.error('Error fetching pending print jobs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST /api/print-jobs/:jobId/complete - Mark job as completed
router.post('/:jobId/complete', authenticateBridge, async (req, res) => {
  try {
    const { jobId } = req.params;
    const pool = getPool();
    
    await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .query(`
        UPDATE PrintJobQueue
        SET Status = 'COMPLETED', CompletedOn = GETDATE(), ErrorMessage = NULL
        WHERE JobId = @JobId
      `);

    console.log(`[PrintQueue] Print successful: JobId=${jobId}`);
    res.json({ success: true, message: 'Job completed successfully' });
  } catch (err) {
    console.error('Error completing print job:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3.5. POST /api/print-jobs/:jobId/release - Release job back to PENDING without consuming attempts (for network timeouts)
router.post('/:jobId/release', authenticateBridge, async (req, res) => {
  try {
    const { jobId } = req.params;
    const pool = getPool();
    await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .query(`
        UPDATE PrintJobQueue
        SET Status = 'PENDING', 
            Attempts = CASE WHEN Attempts > 0 THEN Attempts - 1 ELSE 0 END, 
            ProcessedOn = NULL
        WHERE JobId = @JobId
      `);
    res.json({ success: true, message: 'Job released back to queue' });
  } catch (err) {
    console.error('Error releasing print job:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/print-jobs/:jobId/failed - Mark job as failed or schedule retry
router.post('/:jobId/failed', authenticateBridge, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { errorMessage } = req.body;
    const pool = getPool();

    // Query attempts to determine if we should retry
    const jobRes = await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .query("SELECT Attempts, PrinterName, PrinterIp, PrinterPort FROM PrintJobQueue WHERE JobId = @JobId");
    
    const job = jobRes.recordset[0];
    const attempts = job ? job.Attempts : 0;
    const printerInfo = job ? `${job.PrinterName} (${job.PrinterIp}:${job.PrinterPort})` : 'Unknown Printer';

    if (attempts < 3) {
      // Revert status to PENDING so it can be retried after the delay
      await pool.request()
        .input('JobId', sql.UniqueIdentifier, jobId)
        .input('ErrorMessage', sql.NVarChar(sql.MAX), errorMessage || 'Unknown Error')
        .query(`
          UPDATE PrintJobQueue
          SET Status = 'PENDING', ErrorMessage = @ErrorMessage
          WHERE JobId = @JobId
        `);
      console.log(`[PrintQueue] Printer connection failed on ${printerInfo}: ${errorMessage}. Retry attempt ${attempts}/3 scheduled for JobId=${jobId}`);
    } else {
      // Mark as permanently FAILED
      await pool.request()
        .input('JobId', sql.UniqueIdentifier, jobId)
        .input('ErrorMessage', sql.NVarChar(sql.MAX), errorMessage || 'Unknown Error')
        .query(`
          UPDATE PrintJobQueue
          SET Status = 'FAILED', ErrorMessage = @ErrorMessage, CompletedOn = NULL
          WHERE JobId = @JobId
        `);
      console.log(`[PrintQueue] Job failed after 3 attempts on ${printerInfo}: ${errorMessage}. JobId=${jobId}`);
    }

    res.json({ success: true, message: 'Job failure recorded' });
  } catch (err) {
    console.error('Error recording print job failure:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// 5. POST /api/print-jobs - Queue a new print job from the frontend Web version
router.post('/', authenticateBridge, async (req, res) => {
  try {
    const { printerType, kitchenTypeValue, content, targetPrinterIp, printerIp: bodyPrinterIp } = req.body;
    const storeId = req.storeId;

    if (printerType === undefined || !content) {
      return res.status(400).json({ success: false, error: 'Missing required fields: printerType and content' });
    }

    const pool = getPool();

    // Resolve Printer IP and Name from req.body if provided, or from PrintMaster / CompanySettings
    let printerIp = (targetPrinterIp || bodyPrinterIp || '').trim();
    let printerName = printerIp || 'Receipt Printer';
    const pType = parseInt(printerType);

    if (!printerIp) {
      if (pType === 2) {
        // Kitchen Printer
        const kitchenRes = await pool.request()
          .input('KitchenTypeValue', sql.NVarChar(50), kitchenTypeValue ? String(kitchenTypeValue) : '0')
          .query(`
            SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName 
            FROM PrintMaster 
            WHERE PrinterType = 2 AND CAST(KitchenTypeValue AS VARCHAR(50)) = CAST(@KitchenTypeValue AS VARCHAR(50)) AND IsActive = 1 
              AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
          `);
        if (kitchenRes.recordset.length > 0) {
          printerIp = kitchenRes.recordset[0].PrinterIP;
          printerName = kitchenRes.recordset[0].PrinterName;
        }
      }

      // Fallback or Direct check for Cashier (1) or TakeAway (3) or if Kitchen Printer not found/not configured with IP
      if (!printerIp || printerIp.trim() === '') {
        const printerRes = await pool.request()
          .input('PrinterType', sql.Int, pType)
          .query(`
            SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName 
            FROM PrintMaster 
            WHERE PrinterType = @PrinterType AND IsActive = 1 
              AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
          `);
        if (printerRes.recordset.length > 0) {
          printerIp = printerRes.recordset[0].PrinterIP;
          printerName = printerRes.recordset[0].PrinterName;
        }
      }

      // Ultimate fallback to Cashier Printer (Type 1) or CompanySettings for non-KDS jobs
      if ((!printerIp || printerIp.trim() === '') && pType !== 4) {
        const cashierRes = await pool.request()
          .query(`
            SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName 
            FROM PrintMaster 
            WHERE PrinterType = 1 AND IsActive = 1 
              AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
          `);
        if (cashierRes.recordset.length > 0) {
          printerIp = cashierRes.recordset[0].PrinterIP;
          printerName = cashierRes.recordset[0].PrinterName;
        } else {
          try {
            const companyRes = await pool.request()
              .query("SELECT TOP 1 PrinterIP, CashierPrinterIP FROM CompanySettings WHERE Id = '1'");
            if (companyRes.recordset.length > 0) {
              printerIp = companyRes.recordset[0].CashierPrinterIP || companyRes.recordset[0].PrinterIP || '';
              printerName = printerIp || 'Cashier Printer';
            }
          } catch (cErr) {
            console.warn('[PrintQueue] CompanySettings fallback check error:', cErr.message);
          }
        }
      }
    }

    if (!printerIp || printerIp.trim() === '') {
      printerIp = 'Receipt Printer';
      printerName = 'Receipt Printer';
    }

    const jobId = require('crypto').randomUUID();

    // Insert the job into PrintJobQueue
    await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .input('StoreId', sql.NVarChar(50), storeId)
      .input('PrinterName', sql.NVarChar(100), printerName)
      .input('PrinterIp', sql.NVarChar(100), printerIp)
      .input('PrinterPort', sql.Int, 9100) // Default thermal printer raw TCP port
      .input('Content', sql.NVarChar(sql.MAX), content)
      .query(`
        INSERT INTO PrintJobQueue (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn)
        VALUES (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE())
      `);

    res.json({ success: true, message: 'Print job queued successfully', jobId, printerIp, printerName });

    // Notify native APK clients to process the queue immediately (don't wait for 20s poll)
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('print_jobs_available', { storeId, jobId });
        console.log(`[PrintQueue] Emitted print_jobs_available for JobId=${jobId}`);
      }
    } catch (emitErr) {
      console.warn('[PrintQueue] Could not emit print_jobs_available:', emitErr.message);
    }
  } catch (err) {
    console.error('Error queuing print job:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/print-jobs/status/:jobId - Check print job status
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const pool = getPool();
    const result = await pool.request()
      .input('JobId', sql.UniqueIdentifier, jobId)
      .query(`
        SELECT Status, ErrorMessage 
        FROM PrintJobQueue 
        WHERE JobId = @JobId
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }
    res.json({ success: true, status: result.recordset[0].Status, error: result.recordset[0].ErrorMessage });
  } catch (err) {
    console.error('Error fetching print job status:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

