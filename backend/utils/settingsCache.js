const sql = require("mssql");
const { poolPromise } = require("../config/db");

const CACHE_TTL_MS = 60000; // 60 seconds cache TTL

const holdOvertimeCache = new Map(); // dbKey -> { value, fetchTime }
const companySettingsCache = new Map(); // dbKey -> { data, fetchTime }
const appSettingsCache = new Map(); // dbKey -> { data, fetchTime }

function getDbKey(pool) {
  return (pool?.config?.database || "DEFAULT").toUpperCase();
}

async function getHoldOvertimeMinutes(customPool) {
  const pool = customPool || (await poolPromise);
  const dbKey = getDbKey(pool);
  const now = Date.now();
  const cached = holdOvertimeCache.get(dbKey);

  if (cached && (now - cached.fetchTime < CACHE_TTL_MS)) {
    console.log(`⚡ [SettingsCache] Cache HIT: HoldOvertimeMinutes (${dbKey})`);
    return cached.value;
  }

  console.log(`⚡ [SettingsCache] Cache MISS: HoldOvertimeMinutes (${dbKey})`);
  let holdMinutes = 30;
  try {
    if (pool && pool.connected) {
      const result = await pool.request().query("SELECT TOP 1 HoldOvertimeMinutes FROM CompanySettings WITH (NOLOCK)");
      if (result.recordset.length > 0 && result.recordset[0].HoldOvertimeMinutes != null) {
        holdMinutes = result.recordset[0].HoldOvertimeMinutes;
      }
      holdOvertimeCache.set(dbKey, { value: holdMinutes, fetchTime: now });
    }
  } catch (err) {
    console.error("⚠️ [SettingsCache] Error fetching HoldOvertimeMinutes:", err.message);
    if (cached) return cached.value;
  }

  return holdMinutes;
}

async function getCompanySettings(customPool) {
  const pool = customPool || (await poolPromise);
  const dbKey = getDbKey(pool);
  const now = Date.now();
  const cached = companySettingsCache.get(dbKey);

  if (cached && (now - cached.fetchTime < CACHE_TTL_MS)) {
    console.log(`⚡ [SettingsCache] Cache HIT: CompanySettings (${dbKey})`);
    return cached.data;
  }

  console.log(`⚡ [SettingsCache] Cache MISS: CompanySettings (${dbKey})`);
  let settings = null;
  try {
    if (pool && pool.connected) {
      // 1. Try to get specific Master Settings (ID 1)
      let result = await pool.request()
        .query("SELECT * FROM CompanySettings WHERE Id = '1'");
      
      // 2. Fallback: If not found OR if the found record has NO NAME (empty shell)
      if (result.recordset.length === 0 || !result.recordset[0].CompanyName || result.recordset[0].CompanyName.trim() === '') {
        const fallbackResult = await pool.request()
          .query("SELECT TOP 1 * FROM CompanySettings WHERE CompanyName IS NOT NULL AND CompanyName <> '' ORDER BY UpdatedOn DESC");
        
        if (fallbackResult.recordset.length > 0) {
          result = fallbackResult;
        }
      }

      if (result.recordset.length > 0) {
        settings = result.recordset[0];
        companySettingsCache.set(dbKey, { data: settings, fetchTime: now });
      }
    }
  } catch (err) {
    console.error("⚠️ [SettingsCache] Error fetching CompanySettings:", err.message);
  }

  return settings;
}

async function getAppSettings(customPool) {
  const pool = customPool || (await poolPromise);
  const dbKey = getDbKey(pool);
  const now = Date.now();
  const cached = appSettingsCache.get(dbKey);

  if (cached && (now - cached.fetchTime < CACHE_TTL_MS)) {
    console.log(`⚡ [SettingsCache] Cache HIT: AppSettings (${dbKey})`);
    return cached.data;
  }

  console.log(`⚡ [SettingsCache] Cache MISS: AppSettings (${dbKey})`);
  let settings = {};
  try {
    if (pool && pool.connected) {
      const result = await pool.request().query("SELECT TOP 1 * FROM AppSettings");
      if (result.recordset.length > 0) {
        settings = result.recordset[0];
      }
      appSettingsCache.set(dbKey, { data: settings, fetchTime: now });
    }
  } catch (err) {
    console.error("⚠️ [SettingsCache] Error fetching AppSettings:", err.message);
  }

  return settings;
}

async function getBusinessTimezoneSettings(customPool) {
  const companySettings = await getCompanySettings(customPool);
  
  return {
    timezone: companySettings?.BusinessTimezone || 'Asia/Singapore',
    offsetMinutes: companySettings?.DayEndOffsetMinutes != null ? Number(companySettings.DayEndOffsetMinutes) : 0
  };
}

function invalidateCache(databaseName) {
  if (databaseName) {
    const dbKey = String(databaseName).toUpperCase();
    console.log(`⚡ [SettingsCache] Cache INVALIDATION for database: ${dbKey}`);
    holdOvertimeCache.delete(dbKey);
    companySettingsCache.delete(dbKey);
    appSettingsCache.delete(dbKey);
  } else {
    console.log("⚡ [SettingsCache] Cache INVALIDATION: Clearing all settings cache");
    holdOvertimeCache.clear();
    companySettingsCache.clear();
    appSettingsCache.clear();
  }
}

module.exports = {
  getHoldOvertimeMinutes,
  getCompanySettings,
  getAppSettings,
  getBusinessTimezoneSettings,
  invalidateCache
};
