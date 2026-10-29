const { poolPromise } = require("../config/db");

let cachedOrg = null;

/**
 * Dynamically retrieves the active organization details from the database and caches them.
 * If the database connection fails or no organization exists, it falls back to a resilient default.
 */
async function getActiveOrganization() {
  if (cachedOrg) return cachedOrg;

  try {
    const pool = await poolPromise;
    if (!pool) throw new Error("Database pool not available");

    const result = await pool.request().query(`
      SELECT TOP 1 
        BusinessUnitId, 
        BusinessUnitCode, 
        Name 
      FROM [dbo].[vw_Organization]
    `);

    if (result.recordset.length > 0) {
      cachedOrg = {
        businessUnitId: String(result.recordset[0].BusinessUnitId).toUpperCase(),
        businessUnitCode: String(result.recordset[0].BusinessUnitCode || "UPS").toUpperCase(),
        name: result.recordset[0].Name,
      };
      console.log(`📡 [OrgHelper] Loaded active organization config: ${cachedOrg.name} (${cachedOrg.businessUnitCode})`);
      return cachedOrg;
    }
  } catch (err) {
    console.error("🔥 [Critical] Error loading organization configuration:", err.message);
  }

  // Resilient multi-branch fail-safe fallback
  return {
    businessUnitId: "00000000-0000-0000-0000-000000000000",
    businessUnitCode: "DEFAULT",
    name: "Default POS Branch",
  };
}

module.exports = { getActiveOrganization };
