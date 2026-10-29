const BLACKLIST = /\b(ALTER|DROP|TRUNCATE|DELETE|INSERT|UPDATE|EXEC|EXECUTE|CREATE|REPLACE|MERGE|GRANT|REVOKE|INTO|CURSOR)\b/i;

/**
 * Validates a generated SQL string for read-only correctness, blacklisted keywords, and tenant isolation constraints.
 * @param {string} sqlString The SQL query to validate.
 * @param {number|string} shopId The tenant identifier to enforce.
 * @param {object} schema The discovered schema catalog.
 */
function validateSQL(sqlString, shopId, schema = {}) {
  if (!sqlString || typeof sqlString !== 'string') {
    throw new Error("Security Violation: Empty or invalid query payload.");
  }

  // 1. Blacklist Regex Check
  if (BLACKLIST.test(sqlString)) {
    throw new Error("Security Violation: Unauthorized execution payload or mutation keyword detected.");
  }

  // 2. Strict SELECT only verification
  const normalized = sqlString.trim().toLowerCase();
  if (!normalized.startsWith("select")) {
    throw new Error("Security Violation: Queries must strictly start with SELECT.");
  }

  // 3. Multi-Statement blocker
  if (sqlString.includes(';')) {
    const statements = sqlString.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      if (!stmt.toLowerCase().startsWith('select')) {
        throw new Error("Security Violation: Multi-statement query contains unauthorized commands.");
      }
    }
  }

  // 4. Tenant Isolation Verification
  // We check which tables are used in the query. If any table in the schema contains a tenant column,
  // we check that the query includes the filter.
  // Common tenant column names in typical POS databases: ShopID, StoreID, CompanyID, OrgID, BranchID.
  // If the schema is provided, we inspect the columns of the referenced tables.
  const tablesInQuery = findTablesInQuery(sqlString, schema);
  for (const table of tablesInQuery) {
    const cols = schema[table];
    if (cols) {
      const tenantCol = cols.find(c => {
        const name = c.columnName.toLowerCase();
        return name === 'shopid' || name === 'storeid' || name === 'orgid' || name === 'branchid';
      });
      if (tenantCol) {
        const colName = tenantCol.columnName;
        // Check if the query filters by this tenant column and the correct shopId
        const filterPattern = new RegExp(`\\b${colName}\\s*=\\s*['"]?${shopId}['"]?\\b`, 'i');
        if (!filterPattern.test(sqlString)) {
          throw new Error(`Tenant Validation Error: Access pattern violation on table ${table}. Missing filter for ${colName} = ${shopId}`);
        }
      }
    }
  }

  return true;
}

function findTablesInQuery(sqlString, schema = {}) {
  const tables = [];
  const words = sqlString.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();
    if (word === 'from' || word === 'join') {
      if (i + 1 < words.length) {
        let tableName = words[i + 1].replace(/[\[\]]/g, '').split(/[.\s(]/)[0];
        // Match table name case insensitively against schema keys
        const matchedKey = Object.keys(schema).find(k => k.toLowerCase() === tableName.toLowerCase());
        if (matchedKey) {
          tables.push(matchedKey);
        }
      }
    }
  }
  return tables;
}

module.exports = {
  validateSQL,
  findTablesInQuery
};
