const path = require("path");
// Adjust path to root of backend folder where .env is located
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const sql = require("mssql");
const { AsyncLocalStorage } = require("async_hooks");

const tenancyContext = new AsyncLocalStorage();

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME || "UCSPONDY",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 30000,
    requestTimeout: 30000,
    appName: "POS_System",
    keepAlive: true // Enable TCP keepAlive
  },
  connectionTimeout: 30000,
  requestTimeout: 30000,
  pool: {
    max: 50,
    min: 0,
    idleTimeoutMillis: 30000 // 30s recycle for idle pool connections
  }
};

// Log configuration for debugging (mask password)
console.log("📋 Database Configuration:");
console.log(`   Server: ${dbConfig.server || "NOT SET"}`);
console.log(`   Port: ${dbConfig.port || "NOT SET"}`);
console.log(`   Default Database: ${dbConfig.database || "NOT SET"}`);
console.log(`   User: ${dbConfig.user || "NOT SET"}`);
console.log(`   Connection Timeout: ${dbConfig.connectionTimeout}ms`);

let defaultPoolInstance = null;
const pools = new Map(); // key: UPPERCASE dbName -> { pool, connectingPromise }

/**
 * Connect to a specific database pool with retries.
 */
async function createDatabasePool(targetDatabase, retries = 3, delay = 2000) {
  const cleanDb = String(targetDatabase || "").trim();
  if (!cleanDb || !/^[a-zA-Z0-9_#$]+$/.test(cleanDb)) {
    throw new Error(`Invalid database name identifier: "${cleanDb}"`);
  }

  const poolConfig = {
    ...dbConfig,
    database: cleanDb,
  };

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔌 [Database] Connecting to ${poolConfig.server}:${poolConfig.port}/${cleanDb}... (Attempt ${i + 1}/${retries})`);
      const pool = await new sql.ConnectionPool(poolConfig).connect();
      console.log(`✅ [Database] Connected to MSSQL database "${cleanDb}" successfully`);
      pool.on("error", (err) => {
        console.error(`⚠️ [Database Pool Error] (${cleanDb}):`, err.message);
        if (!pool.connected) {
          pools.delete(cleanDb.toUpperCase());
        }
      });
      return pool;
    } catch (err) {
      console.error(`❌ [Database Connection Attempt ${i + 1} Failed for "${cleanDb}"]:`, err.message);
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Get or create a connection pool for a specific database.
 */
async function getPoolForDatabase(databaseName) {
  const dbName = (databaseName || dbConfig.database || "UCSPONDY").trim();
  const key = dbName.toUpperCase();

  const existing = pools.get(key);
  if (existing) {
    if (existing.pool && existing.pool.connected) {
      return existing.pool;
    }
    if (existing.connectingPromise) {
      try {
        return await existing.connectingPromise;
      } catch (err) {
        pools.delete(key);
      }
    }
  }

  const connectingPromise = createDatabasePool(dbName)
    .then((pool) => {
      pools.set(key, { pool, connectingPromise: null });
      if (key === (dbConfig.database || "UCSPONDY").toUpperCase()) {
        defaultPoolInstance = pool;
      }
      return pool;
    })
    .catch((err) => {
      pools.delete(key);
      throw err;
    });

  pools.set(key, { pool: null, connectingPromise });
  return await connectingPromise;
}

// Connect default pool on startup
const defaultPoolPromise = getPoolForDatabase(dbConfig.database).then((pool) => {
  defaultPoolInstance = pool;
  return pool;
}).catch((err) => {
  console.error("❌ Failed to connect default database on startup:", err.message);
  return null;
});

/**
 * Single source of truth: Fetch all company codes from UNIPRO.dbo.BranchDatabaseMaster dynamically.
 */
async function getBranchDatabaseList() {
  const masterPool = defaultPoolInstance || (await defaultPoolPromise) || (await getPoolForDatabase("UNIPRO"));
  if (!masterPool) {
    throw new Error("Unable to obtain database connection for company lookup.");
  }

  const result = await masterPool.request().query(`
    SELECT 
      LTRIM(RTRIM(BranchCode)) AS BranchCode, 
      LTRIM(RTRIM(DatabaseName)) AS DatabaseName 
    FROM UNIPRO.dbo.BranchDatabaseMaster WITH (NOLOCK)
    WHERE BranchCode IS NOT NULL AND DatabaseName IS NOT NULL
    ORDER BY BranchCode ASC
  `);

  return (result.recordset || []).map((row) => ({
    branchCode: String(row.BranchCode || "").trim(),
    databaseName: String(row.DatabaseName || "").trim(),
  }));
}

/**
 * Validate a branch/company code and return its mapped database name.
 */
async function lookupBranchDatabase(branchCode) {
  if (!branchCode || typeof branchCode !== "string") return null;
  const cleanCode = branchCode.trim();
  if (!cleanCode) return null;

  const masterPool = defaultPoolInstance || (await defaultPoolPromise) || (await getPoolForDatabase("UNIPRO"));
  if (!masterPool) {
    throw new Error("Unable to obtain database connection for branch validation.");
  }

  const result = await masterPool.request()
    .input("branchCode", sql.VarChar(100), cleanCode)
    .query(`
      SELECT TOP 1 
        LTRIM(RTRIM(BranchCode)) AS BranchCode, 
        LTRIM(RTRIM(DatabaseName)) AS DatabaseName 
      FROM UNIPRO.dbo.BranchDatabaseMaster WITH (NOLOCK)
      WHERE UPPER(LTRIM(RTRIM(BranchCode))) = UPPER(@branchCode)
    `);

  if (!result.recordset || result.recordset.length === 0) {
    return null;
  }

  const row = result.recordset[0];
  return {
    branchCode: String(row.BranchCode || "").trim(),
    databaseName: String(row.DatabaseName || "").trim(),
  };
}

/**
 * Transparent Thenable proxy for poolPromise.
 * Automatically resolves to the tenant pool for the current request context if available,
 * otherwise falls back to the default database pool.
 */
const poolPromise = {
  then(onFulfilled, onRejected) {
    const store = tenancyContext.getStore();
    if (store && store.poolPromise) {
      return store.poolPromise.then(onFulfilled, onRejected);
    }
    if (store && store.pool && store.pool.connected) {
      return Promise.resolve(store.pool).then(onFulfilled, onRejected);
    }
    return defaultPoolPromise.then(onFulfilled, onRejected);
  },
  catch(onRejected) {
    return this.then(null, onRejected);
  }
};

/**
 * Returns the currently active pool for the caller.
 */
function getPool(databaseName) {
  if (databaseName) {
    const key = String(databaseName).trim().toUpperCase();
    const entry = pools.get(key);
    return entry?.pool && entry.pool.connected ? entry.pool : null;
  }
  const store = tenancyContext.getStore();
  if (store && store.pool && store.pool.connected) {
    return store.pool;
  }
  return defaultPoolInstance;
}

module.exports = {
  sql,
  poolPromise,
  dbConfig,
  getPool,
  getPoolForDatabase,
  getBranchDatabaseList,
  lookupBranchDatabase,
  tenancyContext,
  defaultPoolPromise,
};
