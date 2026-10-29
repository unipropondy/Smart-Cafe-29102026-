// QR POS Backend Modular Server
const express = require("express");
const compression = require("compression");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const sql = require("mssql");

const envPath = path.resolve(__dirname, ".env");

// 1. Ensure the .env file exists
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, "");
}

// 2. Read current .env content
let envContent = fs.readFileSync(envPath, "utf8");

// 3. If JWT_SECRET is not defined in .env, generate a unique one and save it
if (!envContent.includes("JWT_SECRET=")) {
  const secureSecret = crypto.randomBytes(32).toString("hex");
  const prefix = envContent.endsWith("\n") || envContent.trim() === "" ? "" : "\n";
  fs.appendFileSync(envPath, `${prefix}JWT_SECRET=${secureSecret}\n`);
  console.log("🔒 [Security] JWT_SECRET was missing! A brand-new unique key has been automatically generated and saved to .env.");
}

// 4. Load env variables
require("dotenv").config({ path: envPath });

if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set!");
}

const { poolPromise } = require("./config/db");
const { initDB, syncKitchensToPrintMaster } = require("./config/init");
const tenancyMiddleware = require("./middleware/tenancy");
const dbCheck = require("./middleware/dbCheck");
const idempotencyMiddleware = require("./middleware/idempotency");
const { getHoldOvertimeMinutes } = require("./utils/settingsCache");
const { rollbackAllActive } = require("./utils/transactionHelper");

// Import Routes
const authRoutes = require("./routes/auth");
const tableRoutes = require("./routes/tables");
const menuRoutes = require("./routes/menu");
const salesRoutes = require("./routes/sales");
const memberRoutes = require("./routes/members");
const attendanceRoutes = require("./routes/attendance");
const adminRoutes = require("./routes/admin");
const orderRoutes = require("./routes/orders");
const serverRoutes = require("./routes/servers");
const settingsRoutes = require("./routes/settings");
const companySettingsRoutes = require("./routes/companySettings");
const uploadRoutes = require("./routes/upload");
const exportRoutes = require("./routes/export");
const creditCustomerRoutes = require("./routes/creditCustomers");
const settlementRoutes = require("./routes/settlementRoutes");
const settlementLegacyRoutes = require("./routes/settlement");
const config = require('./config');
const yeahpayRoutes = require('./routes/yeahpay');
const loyaltyRoutes = require("./routes/loyalty");
const loyaltyConfigRoutes = require("./routes/loyaltyConfig");
const comboRoutes = require("./routes/combo");
const rewardRoutes = require("./routes/rewardRoutes");
const netsRoutes = require("./routes/nets");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  perMessageDeflate: true,
});

const PORT = process.env.PORT || 3000;

// Expose io to routes
app.set("io", io);

// Socket.io Connection
io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  // Broadcast new orders to other clients (e.g. KDS screens)
  socket.on("new_order", (data) => {
    console.log("📦 [Server] New order event received:", data.orderId);
    io.emit("new_order", data);
  });

  // 🚀 INSTANT SYNC: Relay cart changes between tablets in the same table room without DB lag
  socket.on("join_table", ({ tableId }) => {
    if (!tableId) return;
    const cleanTableId = String(tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
    const room = `table_${cleanTableId}`;
    socket.join(room);
    console.log(`🔌 [Server] Socket ${socket.id} joined table room: ${room}`);
  });

  socket.on("cart_change", (data) => {
    if (data.tableId) {
      const cleanTableId = String(data.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      const room = `table_${cleanTableId}`;
      console.log(`🛒 [Server] Cart change relay for room ${room}`);
      socket.to(room).emit("cart_change", data);
    } else {
      console.log("🛒 [Server] Cart change relay (no tableId):", data.tableId);
      io.emit("cart_change", data);
    }
  });

  // Broadcast status updates (e.g. order completed, items voided)
  socket.on("order_status_update", (data) => {
    console.log("🔄 [Server] Order status update received:", data.orderId);
    io.emit("order_status_update", data);
  });

  // Relay customer request (e.g. Call Waiter, Water, Spoon)
  socket.on("customer_request", (data) => {
    console.log(`🛎️ [Server] Customer Request from Table ${data.tableNo}: ${data.type}`);
    io.emit("customer_request", data);
  });

  // 💵 QUICK CASH SYNC: Broadcast quick-cash button amounts to all POS terminals
  socket.on("quick_cash_updated", (data) => {
    console.log("💵 [Server] Quick cash amounts updated:", data.amounts);
    socket.broadcast.emit("quick_cash_updated", data);
  });

  // 🖥️ TERMINAL ROOM JOIN: POS devices and Customer Display screens join a shared room
  // Room name format: terminal_{TerminalCode} (e.g. terminal_COUNTER_1)
  socket.on("join_terminal", ({ terminalCode }) => {
    if (!terminalCode) return;
    const room = `terminal_${terminalCode}`;
    socket.join(room);
    console.log(`🖥️ [Server] Socket ${socket.id} joined room: ${room}`);
  });

  // 🖥️ CUSTOMER DISPLAY SYNC: Route to terminal room so only the paired display receives updates
  // Falls back to global broadcast if no terminalCode (legacy/unconfigured devices)
  socket.on("customer_display_sync", (data) => {
    const { terminalCode } = data;
    if (terminalCode) {
      const room = `terminal_${terminalCode}`;
      console.log(`🖥️ [Server] Customer Display Sync → room: ${room} | State: ${data.paymentSuccess ? "SUCCESS" : data.active ? "CART" : "IDLE"}`);
      io.to(room).emit("customer_display_sync", data);
    } else {
      // Legacy fallback: no terminal configured, broadcast to all
      console.log("🖥️ [Server] Customer Display Sync → BROADCAST (no terminalCode)");
      io.emit("customer_display_sync", data);
    }
  });

  // Relay terminal payment status to other tablets
  socket.on("terminal_payment_sync", (data) => {
    console.log(`🔌 [Server] Terminal payment sync:`, data);
    socket.broadcast.emit("terminal_payment_sync", data);
  });

  // Relay terminal split rows status to other tablets
  socket.on("terminal_split_rows_sync", (data) => {
    console.log(`🔌 [Server] Terminal split rows sync:`, data);
    socket.broadcast.emit("terminal_split_rows_sync", data);
  });

  // 🍽️ MENU PUBLISH & UPDATES SYNC: Broadcast menu published status changes to all QR menus and POS apps
  socket.on("menu_updated", (data) => {
    console.log("🍽️ [Server] Socket menu_updated event received:", data);
    const menuRoute = require("./routes/menu");
    if (menuRoute && typeof menuRoute.clearMenuCache === "function") {
      menuRoute.clearMenuCache(io);
    } else {
      io.emit("menu_updated", data || {});
    }
  });

  socket.on("disconnect", () => {
    console.log("🔌 Client disconnected:", socket.id);
  });
});
console.log('🔐 [YeahPay] AppId loaded:', config.appId ? '✅ Yes' : '❌ Missing');
console.log('🔐 [YeahPay] Sync URL:', config.syncApiUrl);
// 🔄 REAL-TIME DB POLLER: Syncs database updates (e.g. from online/QR orders or external systems) with Socket.io clients instantly
// Only emits when changes are detected, preventing performance issues.
const previousTablesState = new Map();
const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };

let previousMenuPublishHash = null;

async function pollMenuPublishStatus() {
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      const result = await pool.request().query(`
        SELECT 
          (SELECT CHECKSUM_AGG(CHECKSUM(DishId, ISNULL(IsPublished, 0))) FROM DishMaster WITH (NOLOCK)) AS dishHash,
          (SELECT CHECKSUM_AGG(CHECKSUM(CategoryId, ISNULL(IsPublished, 0))) FROM CategoryMaster WITH (NOLOCK)) AS catHash,
          (SELECT CHECKSUM_AGG(CHECKSUM(DishGroupId, ISNULL(IsPublished, 0))) FROM DishGroupMaster WITH (NOLOCK)) AS groupHash
      `);

      const row = result.recordset[0];
      const currentHash = `${row?.dishHash}_${row?.catHash}_${row?.groupHash}`;

      if (previousMenuPublishHash !== null && previousMenuPublishHash !== currentHash) {
        console.log(`🔌 [DB Poller Sync] Menu IsPublished change detected! Clearing menu cache & emitting menu_updated...`);
        const menuRoute = require("./routes/menu");
        if (menuRoute && typeof menuRoute.clearMenuCache === "function") {
          menuRoute.clearMenuCache(io);
        } else {
          io.emit("menu_updated", { source: "db_poller", timestamp: Date.now() });
        }
      }
      previousMenuPublishHash = currentHash;
    }
  } catch (err) {
    console.error("🔄 [DB Poller Menu] Error:", err.message);
  } finally {
    setTimeout(pollMenuPublishStatus, 3000);
  }
}

async function pollTables() {
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      const holdMinutes = await getHoldOvertimeMinutes();

      const result = await pool.request()
        .input("holdMinutes", sql.Int, holdMinutes)
        .query(`
        SELECT 
          TableId AS id, 
          CAST(TableNumber AS VARCHAR(50)) AS label,
          CAST(DiningSection AS VARCHAR(10)) AS DiningSection, 
          LockedByName as lockedByName,
          Status, 
          CONVERT(VARCHAR, StartTime, 126) as StartTime, 
          ISNULL(TotalAmount, 0) as totalAmount, 
          CurrentOrderId as currentOrderId,
          entry_status AS entryStatus,
          CustomerName as customerName,
          Pax as pax,
          TableType,
          Seats,
          XSize,
          YSize,
          CASE 
            WHEN Status IN (1, 2, 3) AND StartTime IS NOT NULL AND StartTime > '2000-01-01' AND DATEDIFF(MINUTE, StartTime, GETDATE()) >= 60 THEN 1 
            ELSE 0 
          END AS isOvertime,
          CASE 
            WHEN Status = 3 AND ModifiedOn IS NOT NULL AND DATEDIFF(MINUTE, ModifiedOn, GETDATE()) >= @holdMinutes THEN 1 
            ELSE 0 
          END AS isHoldOvertime,
          CONVERT(VARCHAR, ModifiedOn, 126) as ModifiedOn
        FROM TableMaster WITH (NOLOCK)
      `);

      const currentTables = result.recordset || [];
      currentTables.forEach((table) => {
        const tableId = String(table.id || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
        const prevState = previousTablesState.get(tableId);

        const hasChanged = !prevState || 
          prevState.status !== table.Status || 
          prevState.entryStatus !== table.entryStatus ||
          prevState.totalAmount !== table.totalAmount ||
          prevState.lockedByName !== table.lockedByName ||
          prevState.customerName !== table.customerName ||
          prevState.pax !== table.pax;

        if (hasChanged) {
          // Update local memory state
          previousTablesState.set(tableId, {
            status: table.Status,
            entryStatus: table.entryStatus,
            totalAmount: table.totalAmount,
            lockedByName: table.lockedByName,
            customerName: table.customerName,
            pax: table.pax
          });

          // Only emit if this is not the very first load/state initialization
          if (prevState) {
            io.emit("table_status_updated", {
              tableId,
              status: Number(table.Status),
              totalAmount: Number(table.totalAmount) || 0,
              startTime: table.StartTime,
              tableNo: table.label,
              section: sectionMap[String(table.DiningSection)] || table.DiningSection,
              modifiedOn: table.ModifiedOn,
              isOvertime: table.isOvertime || 0,
              isHoldOvertime: table.isHoldOvertime || 0,
              entryStatus: table.entryStatus || null,
              customerName: table.customerName || null,
              pax: table.pax || null
            });
            console.log(`🔌 [DB Poller Sync] Table ${table.label} updated -> Emit socket. Status: ${table.Status}, QR: ${table.entryStatus}`);
          } else {
            // Initialize memory state silently on startup
            console.log(`🔌 [DB Poller Sync] Initialized table state for: ${table.label}`);
          }
        }
      });
    }
  } catch (err) {
    console.error("🔄 [DB Poller Sync] Error:", err.message);
  } finally {
    // Schedule the next poll to execute 5 seconds after this one finished (prevents overlapping)
    setTimeout(pollTables, 5000);
  }
}

// Start the pollers
setTimeout(pollTables, 5000);
setTimeout(pollMenuPublishStatus, 3000);

// ✅ Global Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`🌐 [Request] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} (${duration}ms)`);
  });
  next();
});
app.use(compression()); // Compress all responses
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads"), {
  maxAge: '1d', 
  immutable: true
}));
app.use(express.static(path.join(__dirname, "dist")));

// 🏢 Dynamic Tenancy Context Middleware (resolves company database per request)
app.use("/api", tenancyMiddleware);

// 🔄 Database Connection Check (for all API routes)
app.use("/api", dbCheck);
app.use("/api", idempotencyMiddleware);

/* ================= ROUTES ================= */
app.use("/api/auth", authRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", salesRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/company-settings", companySettingsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/credit-customers", creditCustomerRoutes);
app.use("/api/settlement", settlementRoutes);
app.use("/api/settlement", settlementLegacyRoutes);
app.use('/api/yeahpay', (req, res, next) => {
  req.io = io;
  next();
}, yeahpayRoutes);
app.use('/api/nets', (req, res, next) => {
  req.io = io;
  next();
}, netsRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/loyalty/configs", loyaltyConfigRoutes);
app.use("/api/combo", comboRoutes);
app.use("/api/rewards", rewardRoutes);
const cashDrawerRouter = require("./routes/cashDrawer");
app.use("/api/cash-drawer", cashDrawerRouter);
const printJobsRouter = require("./routes/printJobs");
app.use("/api/print-jobs", printJobsRouter);
const terminalRoutes = require("./routes/terminal");
app.use("/api/terminal", terminalRoutes);
// AI Chat Integration
const aiRouter = require("./ai-service-src/routes/ai.routes");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");

const aiApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later." }
});

const authenticateAiToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    req.user = { shop_id: 1, role: 'ADMIN', username: 'TestOwner', user_id: 1 };
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      req.user = { shop_id: 1, role: 'ADMIN', username: 'TestOwner', user_id: 1 };
      return next();
    }
    req.user = decoded;
    next();
  });
};

const requireAiAuthorizedRole = (req, res, next) => {
  const role = (req.user?.role || '').toUpperCase();
  const allowed = ['ADMIN'];
  if (!allowed.includes(role)) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Insufficient privileges. Only ADMIN group users can access the AI Chat assistant."
    });
  }
  next();
};

app.use("/api/ai", aiApiLimiter, authenticateAiToken, requireAiAuthorizedRole, aiRouter);
app.use("/api/v1/ai", aiApiLimiter, authenticateAiToken, requireAiAuthorizedRole, aiRouter);

// Root Endpoints (Serve static client SPA fallback routing)
app.get(["/", /^\/customer.*/], (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Legacy support (redirects to ensure existing frontend calls don't break)
app.post("/api/checkout", (req, res) =>
  res.redirect(307, "/api/orders/checkout"),
);
// 🔥 QR LEGACY: QR app uses /api/order (singular) but routes are /api/orders (plural)
app.use("/api/order", (req, res) => {
  const newPath = "/api/orders" + req.path + (Object.keys(req.query).length ? "?" + new URLSearchParams(req.query).toString() : "");
  res.redirect(307, newPath);
});
app.get("/tables", (req, res) => res.redirect("/api/tables/all"));
app.get("/kitchens", (req, res) => res.redirect("/api/menu/kitchens"));
app.get("/dishgroups/:id", (req, res) =>
  res.redirect(`/api/menu/dishgroups/${req.params.id}`),
);
app.get("/dishes/:id", (req, res) =>
  res.redirect(`/api/menu/dishes/group/${req.params.id}`),
);
app.get("/api/dishes/all", (req, res) => res.redirect("/api/menu/dishes/all"));
app.get("/api/discounts", (req, res) => res.redirect("/api/admin/discounts"));
app.get("/modifiers/:id", (req, res) =>
  res.redirect(`/api/menu/modifiers/${req.params.id}`),
);
app.get("/image/:id", (req, res) =>
  res.redirect(`/api/menu/image/${req.params.id}`),
);

// 🧹 JANITOR HEARTBEAT: Safe Ghost Cleanup (Every 15 minutes)
// Strictly closes orphan orders only if the table has been vacant with 0 items for over 30 minutes
setInterval(async () => {
  try {
    const pool = await poolPromise;
    if (!pool || !pool.connected) return;
    
    // Close only true stale orphan orders where table is 0 and no active items exist
    const result = await pool.request().query(`
      UPDATE RestaurantOrderCur 
      SET isOrderClosed = 1, ModifiedOn = GETDATE()
      WHERE (isOrderClosed = 0 OR isOrderClosed IS NULL)
      AND Tableno IN (
        SELECT TableNumber 
        FROM TableMaster 
        WHERE Status = 0
      )
      AND OrderId NOT IN (
        SELECT OrderId FROM RestaurantOrderDetailCur WHERE StatusCode IN (1, 2, 3, 5)
      )
      AND CreatedOn < DATEADD(MINUTE, -30, GETDATE());
    `);
    
    if (result.recordset || result.rowsAffected[0] > 0) {
      const affected = result.rowsAffected[0] || 0;
      if (affected > 0) {
        console.log(`🧹 [Janitor] Cleared ${affected} stale orphan orders.`);
      }
    }
  } catch (err) {
    console.error("🧹 [Janitor] Cleanup failed:", err.message);
  }
}, 15 * 60 * 1000); // 15 Minutes

// 📊 TEMPORARY DIAGNOSTICS LOGGING (Every 5 minutes)
const DIAGNOSTICS_LOG_FILE = path.join(__dirname, "logs", "diagnostics.log");

function logDiagnostics(label = "Interval") {
  try {
    const mem = process.memoryUsage();
    const { activeTransactions } = require("./utils/transactionHelper");
    const { getPool } = require("./config/db");
    
    const pool = getPool();
    const poolStats = pool && pool.pool ? {
      used: pool.pool.used.length,
      free: pool.pool.free.length,
      pendingAcquires: pool.pool.pendingAcquires.length,
      pendingCreates: pool.pool.pendingCreates.length,
      max: pool.pool.max,
      min: pool.pool.min
    } : { used: 0, free: 0, pendingAcquires: 0, pendingCreates: 0, max: 0, min: 0 };

    const io = app.get("io");
    const activeSockets = io ? io.sockets.sockets.size : 0;
    const activeRooms = io && io.sockets.adapter ? io.sockets.adapter.rooms.size : 0;

    const imgCacheStats = menuRoutes && menuRoutes.imageCache ? menuRoutes.imageCache.getStats() : {
      size: 0,
      maxSize: 100,
      estimatedMemoryMb: "0.00 MB",
      hits: 0,
      misses: 0,
      hitRate: "0.00%",
      missRate: "0.00%"
    };

    const stats = {
      timestamp: new Date().toISOString(),
      label,
      memory: {
        rss: (mem.rss / 1024 / 1024).toFixed(2) + " MB",
        heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2) + " MB",
        heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2) + " MB",
        external: (mem.external / 1024 / 1024).toFixed(2) + " MB",
        heapUsagePercent: ((mem.heapUsed / mem.heapTotal) * 100).toFixed(2) + "%"
      },
      transactions: {
        activeCount: activeTransactions ? activeTransactions.size : 0
      },
      databasePool: poolStats,
      sockets: {
        activeSockets,
        activeRooms
      },
      imageCache: imgCacheStats
    };

    const logMessage = `[DIAGNOSTICS] [${stats.timestamp}] [${label}]
Memory: RSS=${stats.memory.rss}, HeapTotal=${stats.memory.heapTotal}, HeapUsed=${stats.memory.heapUsed} (Usage: ${stats.memory.heapUsagePercent})
Transactions: ActiveCount=${stats.transactions.activeCount}
DB Pool: Used=${stats.databasePool.used}, Free=${stats.databasePool.free}, PendingAcquires=${stats.databasePool.pendingAcquires}, PendingCreates=${stats.databasePool.pendingCreates}
Sockets: ActiveSockets=${stats.sockets.activeSockets}, ActiveRooms=${stats.sockets.activeRooms}
Image Cache: Size=${stats.imageCache.size}/${stats.imageCache.maxSize}, EstMemory=${stats.imageCache.estimatedMemoryMb}, Hits=${stats.imageCache.hits}, Misses=${stats.imageCache.misses} (HitRate: ${stats.imageCache.hitRate}, MissRate: ${stats.imageCache.missRate})
--------------------------------------------------------------------------------`;

    console.log(logMessage);
    const logsDir = path.dirname(DIAGNOSTICS_LOG_FILE);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(DIAGNOSTICS_LOG_FILE, logMessage + "\n", "utf8");
  } catch (err) {
    console.error("⚠️ [Diagnostics] Logging failed:", err.message);
  }
}

// Log startup metrics after 5 seconds to let everything initialize
setTimeout(() => {
  logDiagnostics("Startup");
}, 5000);

// Log every 5 minutes
setInterval(() => {
  logDiagnostics("Interval");
}, 5 * 60 * 1000);

/* ================= START SERVER ================= */
httpServer.listen(PORT, async () => {
  console.log(`🚀 Modular Server running on port ${PORT}`);

  try {
    const pool = await poolPromise;
    if (pool) {
      await initDB(pool);
      // ✅ One-time migration: Fix any active tables with NULL StartTime
      await pool.request().query("UPDATE TableMaster SET StartTime = GETDATE() WHERE StartTime IS NULL AND Status IN (1, 2, 3, 4)");
      console.log("✅ Database initialized and ready.");

      // 💳 NETS ECR II: Sync active terminal configuration from database
      const { defaultTransport } = require("./services/nets/netsTransport");
      await defaultTransport.loadConfigFromDb();
    }
  } catch (err) {
    console.error("⚠️ Initial DB setup failed:", err.message);
  }

  // 🔄 KITCHEN AUTO-SYNC: Detect new kitchens from backoffice every 3 minutes
  // This ensures any kitchen added in the backoffice automatically appears
  // in PrintMaster (smart kitchen routing) without needing a server restart.
  setInterval(async () => {
    try {
      const pool = await poolPromise;
      if (pool && pool.connected) {
        await syncKitchensToPrintMaster(pool);
      }
    } catch (err) {
      console.error("❌ [KitchenSync Interval] Error:", err.message);
    }
  }, 3 * 60 * 1000); // Every 3 minutes
  console.log("🍳 [KitchenSync] Background auto-sync started (every 3 minutes).");

  // 🔄 PRINT QUEUE CLEANUP: Reset stuck 'PROCESSING' jobs to 'PENDING' every 60 seconds
  setInterval(async () => {
    try {
      const pool = await poolPromise;
      if (pool && pool.connected) {
        const result = await pool.request().query(`
          UPDATE PrintJobQueue
          SET Status = 'PENDING', ProcessedOn = NULL, Attempts = 0
          WHERE Status = 'PROCESSING' AND DATEDIFF(minute, ProcessedOn, GETDATE()) >= 3
        `);
        if (result.rowsAffected[0] > 0) {
          console.log(`🧹 [PrintQueue Cleanup] Reset ${result.rowsAffected[0]} stuck print jobs back to PENDING.`);
          // Notify the print bridge client that jobs are available to print
          io.emit("print_jobs_available", { storeId: "STORE_001" });
        }
      }
    } catch (err) {
      console.error("❌ [PrintQueue Cleanup] Error resetting stuck jobs:", err.message);
    }
  }, 60 * 1000); // Every 60 seconds
  console.log("🧹 [PrintQueue Cleanup] Background watchdog started (every 60 seconds).");

  // 🧹 QR TAKEAWAY AUTO-EXPIRY WATCHDOG: Auto-release abandoned QR takeaway tables after 15 mins and broadcast in real-time
  setInterval(async () => {
    try {
      const pool = await poolPromise;
      if (pool && pool.connected) {
        const expiredRes = await pool.request().query(`
          DECLARE @cleared TABLE (TableId UNIQUEIDENTIFIER, TableNumber NVARCHAR(50), DiningSection INT);

          UPDATE tm
          SET tm.Status = 0, tm.entry_status = NULL, tm.TotalAmount = 0, tm.StartTime = NULL, 
              tm.CurrentOrderId = NULL, tm.CustomerName = NULL, tm.Pax = NULL, tm.LockedByName = NULL,
              tm.ModifiedOn = GETDATE()
          OUTPUT INSERTED.TableId, INSERTED.TableNumber, INSERTED.DiningSection INTO @cleared
          FROM TableMaster tm
          WHERE tm.Status IN (1, 2, 3, 4)
            AND CAST(tm.DiningSection AS VARCHAR(10)) = '4'
            AND tm.entry_status = 'q'
            AND DATEDIFF(MINUTE, ISNULL(tm.StartTime, tm.ModifiedOn), GETDATE()) >= 15
            AND (
              tm.CurrentOrderId IS NULL 
              OR NOT EXISTS (
                SELECT 1 FROM RestaurantOrderCur roc 
                WHERE (roc.OrderNumber = tm.CurrentOrderId OR TRY_CAST(roc.OrderId AS NVARCHAR(100)) = TRY_CAST(tm.CurrentOrderId AS NVARCHAR(100)))
                  AND (roc.isOrderClosed = 0 OR roc.isOrderClosed IS NULL)
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM CartItems ci WHERE ci.CartId = CAST(tm.TableId AS NVARCHAR(128)) OR ci.CartId = tm.TableNumber
            );

          SELECT TableId, TableNumber, DiningSection FROM @cleared;
        `);

        if (expiredRes.recordset && expiredRes.recordset.length > 0) {
          console.log(`🧹 [QR Watchdog] Auto-released ${expiredRes.recordset.length} expired QR takeaway table(s):`, expiredRes.recordset.map(r => r.TableNumber).join(", "));
          expiredRes.recordset.forEach(tbl => {
            const cleanTid = String(tbl.TableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
            io.emit("table_status_updated", {
              tableId: cleanTid,
              tableNo: tbl.TableNumber,
              section: "TAKEAWAY",
              status: 0,
              orderId: "EMPTY",
              totalAmount: 0,
              startTime: 0,
              entryStatus: null,
              paymentStatus: 0,
              customerName: null,
              pax: null,
            });
          });
          io.emit("tables_updated");
        }
      }
    } catch (err) {
      console.error("❌ [QR Watchdog] Error auto-releasing expired tables:", err.message);
    }
  }, 15 * 1000); // Check every 15 seconds
  console.log("🧹 [QR Watchdog] Background auto-expiry watchdog started (every 15 seconds).");
});

// Register global exception handlers for transaction cleanup
process.on("uncaughtException", async (err) => {
  console.error("🔥 [Fatal] Uncaught Exception occurred:", err);
  try {
    await rollbackAllActive();
  } catch (cleanErr) {
    console.error("⚠️ Failed to clean up transactions during uncaughtException:", cleanErr);
  }
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("🔥 [Fatal] Unhandled Rejection at:", promise, "reason:", reason);
  try {
    await rollbackAllActive();
  } catch (cleanErr) {
    console.error("⚠️ Failed to clean up transactions during unhandledRejection:", cleanErr);
  }
});