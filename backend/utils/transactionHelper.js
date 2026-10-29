const { sql, getPool } = require("../config/db");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Keep a registry of active transactions for monitoring and emergency rollback
const activeTransactions = new Set();

// Ensure logs directory exists
const LOGS_DIR = path.resolve(__dirname, "../logs");
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}
const LEAKS_LOG_FILE = path.join(LOGS_DIR, "transaction_leaks.log");

// 🚀 GHOST SHIELD: Globally intercept sql.Request constructor to track requests created with new sql.Request(transaction)
const originalRequest = sql.Request;
sql.Request = function(connection, ...args) {
  const req = new originalRequest(connection, ...args);
  
  // If connection is a Transaction and has our custom activeRequests registry, track it
  if (connection && connection.activeRequests) {
    connection.activeRequests.add(req);
    
    const originalQuery = req.query;
    req.query = async function(...queryArgs) {
      try {
        return await originalQuery.apply(req, queryArgs);
      } finally {
        connection.activeRequests.delete(req);
      }
    };

    const originalExecute = req.execute;
    req.execute = async function(...execArgs) {
      try {
        return await originalExecute.apply(req, execArgs);
      } finally {
        connection.activeRequests.delete(req);
      }
    };
  }
  return req;
};
// Inherit prototype and static properties
sql.Request.prototype = originalRequest.prototype;
Object.assign(sql.Request, originalRequest);

/**
 * Execute business logic inside an SQL transaction with automated lifecycle management.
 *
 * @param {Function} callback - Async function executing operations, receives the (transaction) object.
 * @param {Object} options - Configuration options.
 * @param {string} options.name - Name of transaction for diagnostics and logging.
 * @param {number} options.timeoutMs - Timeout threshold in milliseconds (default: 30000).
 * @param {string} options.tableId - Table ID associated with this transaction (if applicable).
 * @param {string} options.orderId - Order ID associated with this transaction (if applicable).
 * @param {string} options.userId - User ID associated with this transaction (if available).
 */
async function runInTransaction(callback, options = {}) {
  const name = options.name || "AnonymousTransaction";
  const timeoutMs = options.timeoutMs || 30000;
  const tableId = options.tableId || "N/A";
  const orderId = options.orderId || "N/A";
  const userId = options.userId || "N/A";
  
  const txId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
  const startTime = Date.now();
  const stackTrace = new Error().stack;

  const pool = getPool();
  if (!pool) {
    throw new Error(`[TX] [${name}] Database connection pool is not initialized or connected.`);
  }

  const transaction = new sql.Transaction(pool);
  const activeRequests = new Set();
  transaction.activeRequests = activeRequests;
  let isDone = false;
  let spid = "PENDING";

  // Intercept transaction.request() to track requests created via method
  const originalTxRequest = transaction.request;
  transaction.request = function(...args) {
    const req = originalTxRequest.apply(transaction, args);
    activeRequests.add(req);

    const originalQuery = req.query;
    req.query = async function(...queryArgs) {
      try {
        return await originalQuery.apply(req, queryArgs);
      } finally {
        activeRequests.delete(req);
      }
    };

    const originalExecute = req.execute;
    req.execute = async function(...execArgs) {
      try {
        return await originalExecute.apply(req, execArgs);
      } finally {
        activeRequests.delete(req);
      }
    };

    return req;
  };

  const registryItem = {
    txId,
    name,
    startTime,
    tableId,
    orderId,
    userId,
    spid: () => spid,
    stackTrace,
    tx: transaction,
    activeRequests,
    isDone: () => isDone,
    rollback: async (reason = "Manual Rollback") => {
      if (isDone) return;
      try {
        const duration = Date.now() - startTime;
        console.warn(`[TX_ROLLBACK] id=${txId} route=${name} duration=${duration}ms spid=${spid} reason="${reason}"`);
        
        // 1. Cancel all active queries on the connection to prevent "request in progress" error
        if (activeRequests.size > 0) {
          console.warn(`[TX] [${name}] Cancelling ${activeRequests.size} active query requests...`);
          for (const req of activeRequests) {
            try {
              req.cancel();
            } catch (err) {
              console.error(`[TX] [${name}] Failed to cancel active request: ${err.message}`);
            }
          }
          // Poll until activeRequests is empty or we hit a max wait time of 5 seconds
          const cancelStartTime = Date.now();
          while (activeRequests.size > 0 && Date.now() - cancelStartTime < 5000) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (activeRequests.size > 0) {
            console.warn(`[TX] [${name}] Warning: ${activeRequests.size} requests could not be cancelled in 5s.`);
          }
        }

        // 2. Rollback
        await transaction.rollback();
        console.warn(`[TX] [${name}] Emergency rollback completed.`);
      } catch (err) {
        console.error(`[TX] [${name}] Emergency rollback failed: ${err.message}`);
        try {
          const conn = transaction._acquiredConnection;
          if (conn) {
            console.warn(`[TX_FORCE_CLOSE] id=${txId} route=${name} spid=${spid}`);
            if (typeof conn.close === 'function') {
              conn.close();
            } else if (conn.socket && typeof conn.socket.destroy === 'function') {
              conn.socket.destroy();
            }
          }
        } catch (closeErr) {
          console.error(`[TX] [${name}] Failed to force close connection: ${closeErr.message}`);
        }
      } finally {
        isDone = true;
        activeTransactions.delete(registryItem);
      }
    }
  };

  activeTransactions.add(registryItem);

  try {
    console.log(`[TX_START] id=${txId} route=${name} table=${tableId} order=${orderId} user=${userId} spid=${spid}`);
    await transaction.begin();

    // Query SPID asynchronously immediately after transaction begins
    try {
      const spidRes = await transaction.request().query("SELECT @@SPID as spid");
      spid = String(spidRes.recordset[0]?.spid || "UNKNOWN");
      // Update starting log with active SPID
      console.log(`[TX_SPID_RESOLVED] id=${txId} route=${name} spid=${spid}`);
    } catch (spidErr) {
      console.warn(`[TX] [${name}] Failed to fetch @@SPID: ${spidErr.message}`);
      spid = "UNKNOWN";
    }

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Transaction execution timeout exceeded (${timeoutMs}ms)`));
      }, timeoutMs);
    });

    // Execute business logic with timeout race
    const result = await Promise.race([
      callback(transaction),
      timeoutPromise
    ]);

    clearTimeout(timeoutId);

    const duration = Date.now() - startTime;
    console.log(`[TX_COMMIT] id=${txId} route=${name} duration=${duration}ms spid=${spid}`);
    await transaction.commit();
    isDone = true;

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error.message.includes("timeout exceeded")) {
      console.error(`[TX_TIMEOUT] id=${txId} route=${name} duration=${duration}ms spid=${spid}`);
    } else {
      console.error(`[TX] [${name}] Transaction failed after ${duration}ms: ${error.message}`);
    }

    if (!isDone) {
      await registryItem.rollback(error.message);
    }
    throw error;
  } finally {
    isDone = true;
    activeTransactions.delete(registryItem);
  }
}

/**
 * Rollback all active transactions registered in memory.
 * Typically invoked during process shutdown or global unhandled rejection/exceptions.
 */
async function rollbackAllActive() {
  if (activeTransactions.size === 0) {
    return;
  }
  console.warn(`⚠️ [TX] Process exiting or error occurred. Clearing ${activeTransactions.size} active transactions...`);
  const rollbacks = Array.from(activeTransactions).map(item => item.rollback("Global Emergency Rollback"));
  await Promise.allSettled(rollbacks);
  console.log(`[TX] Emergency rollback process completed.`);
}

// ================= MONITORING SCHEDULES =================

// 1. Warn/Critical (Every 10 Seconds) & Auto-Recovery (5 Minutes)
setInterval(async () => {
  const now = Date.now();
  for (const item of activeTransactions) {
    if (item.isDone()) continue;

    const durationMs = now - item.startTime;
    const durationSec = Math.floor(durationMs / 1000);

    if (durationMs >= 300000) {
      // 🚨 AUTO-RECOVERY (5 Minutes)
      try {
        const report = `
========================================
[TX_LEAK_DETECTED] CRITICAL TRANSACTION HANG (>= 5 MINUTES)
Time: ${new Date().toISOString()}
Transaction ID: ${item.txId}
Route/Name: ${item.name}
Table ID: ${item.tableId}
Order ID: ${item.orderId}
User ID: ${item.userId}
SPID: ${item.spid()}
Duration: ${durationSec}s
Stack Trace:
${item.stackTrace}
========================================
`;
        // Synchronously write to log file so it survives connection destruction
        fs.appendFileSync(LEAKS_LOG_FILE, report, "utf8");
        console.error(`🚨 [TX_LEAK_DETECTED] Critical: transaction ${item.txId} (route: ${item.name}) active for ${durationSec}s. Logged details and initiating auto-recovery.`);
      } catch (logErr) {
        console.error("❌ Failed to write transaction leak details to log file:", logErr.message);
      }

      // Safe Rollback & Close
      try {
        await item.rollback("Auto-Recovery (5-minute threshold exceeded)");
      } catch (recoverErr) {
        console.error(`❌ Auto-recovery rollback failed for tx ${item.txId}:`, recoverErr.message);
      }
    } else if (durationMs >= 60000) {
      // Critical (60 Seconds)
      console.error(`[TX_CRITICAL] Transaction open for ${durationSec}s. route=${item.name} id=${item.txId} spid=${item.spid()}`);
    } else if (durationMs >= 30000) {
      // Warning (30 Seconds)
      console.warn(`[TX_WARNING] Transaction open for ${durationSec}s. route=${item.name} id=${item.txId} spid=${item.spid()}`);
    }
  }
}, 10000);

// 2. Diagnostics (Every 60 Seconds)
setInterval(() => {
  let oldestAgeSec = 0;
  let longRunningCount = 0;
  const now = Date.now();

  for (const item of activeTransactions) {
    if (item.isDone()) continue;
    const age = Math.floor((now - item.startTime) / 1000);
    if (age > oldestAgeSec) {
      oldestAgeSec = age;
    }
    if (now - item.startTime >= 30000) {
      longRunningCount++;
    }
  }

  console.log(`[TX_DIAGNOSTICS] Active count: ${activeTransactions.size} | Long-running count (>=30s): ${longRunningCount} | Oldest transaction age: ${oldestAgeSec}s`);
}, 60000);

module.exports = {
  runInTransaction,
  rollbackAllActive,
  activeTransactions
};
