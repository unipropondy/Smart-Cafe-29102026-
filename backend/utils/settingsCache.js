const sql = require("mssql");
const { poolPromise } = require("../config/db");

let cachedHoldOvertimeMinutes = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // 60 seconds cache TTL

let cachedCompanySettings = null;
let companySettingsFetchTime = 0;

let cachedAppSettings = null;
let appSettingsFetchTime = 0;

async function getHoldOvertimeMinutes() {
  const now = Date.now();
  if (cachedHoldOvertimeMinutes !== null && (now - lastFetchTime < CACHE_TTL_MS)) {
    console.log("⚡ [SettingsCache] Cache HIT: HoldOvertimeMinutes");
    return cachedHoldOvertimeMinutes;
  }

  console.log("⚡ [SettingsCache] Cache MISS: HoldOvertimeMinutes");
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      const result = await pool.request().query("SELECT TOP 1 HoldOvertimeMinutes FROM CompanySettings WITH (NOLOCK)");
      if (result.recordset.length > 0) {
        cachedHoldOvertimeMinutes = result.recordset[0].HoldOvertimeMinutes || 30;
      } else {
        cachedHoldOvertimeMinutes = 30;
      }
      lastFetchTime = now;
    }
  } catch (err) {
    console.error("⚠️ [SettingsCache] Error fetching HoldOvertimeMinutes:", err.message);
    if (cachedHoldOvertimeMinutes === null) {
      return 30; // Return default if not yet cached
    }
  }

  return cachedHoldOvertimeMinutes;
}

async function getCompanySettings() {
  const now = Date.now();
  if (cachedCompanySettings !== null && (now - companySettingsFetchTime < CACHE_TTL_MS)) {
    console.log("⚡ [SettingsCache] Cache HIT: CompanySettings");
    return cachedCompanySettings;
  }

  console.log("⚡ [SettingsCache] Cache MISS: CompanySettings");
  try {
    const pool = await poolPromise;
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
        cachedCompanySettings = result.recordset[0];
        companySettingsFetchTime = now;
      }
    }
  } catch (err) {
    console.error("⚠️ [SettingsCache] Error fetching CompanySettings:", err.message);
  }

  return cachedCompanySettings;
}

async function getAppSettings() {
  const now = Date.now();
  if (cachedAppSettings !== null && (now - appSettingsFetchTime < CACHE_TTL_MS)) {
    console.log("⚡ [SettingsCache] Cache HIT: AppSettings");
    return cachedAppSettings;
  }

  console.log("⚡ [SettingsCache] Cache MISS: AppSettings");
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      const result = await pool.request().query("SELECT TOP 1 * FROM AppSettings");
      if (result.recordset.length > 0) {
        cachedAppSettings = result.recordset[0];
        appSettingsFetchTime = now;
      } else {
        cachedAppSettings = {};
      }
    }
  } catch (err) {
    console.error("⚠️ [SettingsCache] Error fetching AppSettings:", err.message);
  }

  return cachedAppSettings;
}

async function getBusinessTimezoneSettings() {
  const companySettings = await getCompanySettings();
  
  return {
    timezone: companySettings?.BusinessTimezone || 'Asia/Singapore',
    offsetMinutes: companySettings?.DayEndOffsetMinutes != null ? Number(companySettings.DayEndOffsetMinutes) : 0
  };
}

function invalidateCache() {
  console.log("⚡ [SettingsCache] Cache INVALIDATION: Clearing all settings cache");
  cachedHoldOvertimeMinutes = null;
  lastFetchTime = 0;
  cachedCompanySettings = null;
  companySettingsFetchTime = 0;
  cachedAppSettings = null;
  appSettingsFetchTime = 0;
}

module.exports = {
  getHoldOvertimeMinutes,
  getCompanySettings,
  getAppSettings,
  getBusinessTimezoneSettings,
  invalidateCache
};
