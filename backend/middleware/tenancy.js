const jwt = require("jsonwebtoken");
const {
  tenancyContext,
  getPoolForDatabase,
  lookupBranchDatabase,
  dbConfig,
} = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Tenancy Middleware:
 * Inspects incoming requests to establish the correct company database context.
 * 1. Checks JWT token (Bearer <token>) - securely extracts authenticated databaseName & companyCode.
 * 2. If no token, checks 'x-company-code' header or request parameters/body for public routes.
 * 3. Falls back to default database if neither is present.
 * Runs downstream middleware and route handlers inside AsyncLocalStorage tenancy context.
 */
async function tenancyMiddleware(req, res, next) {
  try {
    let targetDb = null;
    let companyCode = null;

    // 1. Inspect Authorization Bearer Token (trusted server-signed context)
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.databaseName) {
          targetDb = String(decoded.databaseName).trim();
          companyCode = decoded.companyCode ? String(decoded.companyCode).trim() : null;
        }
      } catch (err) {
        // Token invalid or expired - proceed to allow authenticateToken middleware to handle appropriately
      }
    }

    // 2. Check X-Company-Code header or parsed body/query for unauthenticated company-scoped requests
    if (!targetDb) {
      const candidateCode =
        req.headers["x-company-code"] ||
        (req.body && req.body.companyCode) ||
        (req.query && req.query.companyCode);

      if (candidateCode && typeof candidateCode === "string" && candidateCode.trim()) {
        try {
          const mapping = await lookupBranchDatabase(candidateCode.trim());
          if (mapping && mapping.databaseName) {
            targetDb = mapping.databaseName;
            companyCode = mapping.branchCode;
          }
        } catch (e) {
          console.warn("⚠️ [Tenancy] Failed to lookup branch database for candidate code:", candidateCode, e.message);
        }
      }
    }

    // 3. Fallback to default database
    if (!targetDb) {
      targetDb = dbConfig.database || "UCSPONDY";
    }

    // Obtain or reuse connection pool for the target database
    let pool = null;
    try {
      pool = await getPoolForDatabase(targetDb);
    } catch (err) {
      console.error(`❌ [Tenancy] Failed to get connection pool for "${targetDb}":`, err.message);
      return res.status(503).json({
        success: false,
        error: "Database Connection Unavailable",
        message: `Database connection unavailable for company context (${targetDb}). Please try again.`,
      });
    }

    req.pool = pool;
    req.db = pool;
    req.databaseName = targetDb;
    req.companyCode = companyCode;

    tenancyContext.run(
      {
        pool,
        databaseName: targetDb,
        companyCode,
        poolPromise: Promise.resolve(pool),
      },
      () => next()
    );
  } catch (err) {
    console.error("❌ [Tenancy Middleware Unexpected Error]:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error configuring tenant database.",
    });
  }
}

module.exports = tenancyMiddleware;
