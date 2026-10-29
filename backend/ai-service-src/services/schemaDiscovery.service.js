const { getReadOnlyPool } = require('../config/database');

let cachedSchema = null;
let lastFetched = null;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function discoverSchema() {
  const now = Date.now();
  if (cachedSchema && lastFetched && (now - lastFetched < CACHE_TTL)) {
    return cachedSchema;
  }

  try {
    const pool = await getReadOnlyPool();
    const query = `
      SELECT 
          t.name AS TableName,
          c.name AS ColumnName,
          ty.name AS DataType,
          c.max_length AS MaxLength,
          c.is_nullable AS IsNullable,
          ISNULL(
              (SELECT TOP 1 1 
               FROM sys.index_columns ic
               JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
               WHERE ic.column_id = c.column_id AND ic.object_id = t.object_id AND i.is_primary_key = 1), 
              0
          ) AS IsPrimaryKey,
          ISNULL(
              (SELECT TOP 1 fk.name 
               FROM sys.foreign_key_columns fkc
               JOIN sys.foreign_keys fk ON fkc.constraint_object_id = fk.object_id
               WHERE fkc.parent_object_id = t.object_id AND fkc.parent_column_id = c.column_id), 
              ''
          ) AS ForeignKeyConstraint
      FROM sys.tables t
      JOIN sys.columns c ON t.object_id = c.object_id
      JOIN sys.types ty ON c.user_type_id = ty.user_type_id
      WHERE t.is_ms_shipped = 0
      ORDER BY t.name, c.column_id;
    `;
    const result = await pool.request().query(query);
    
    // Group columns by TableName
    const schema = {};
    result.recordset.forEach(row => {
      const { TableName, ColumnName, DataType, MaxLength, IsNullable, IsPrimaryKey, ForeignKeyConstraint } = row;
      if (!schema[TableName]) {
        schema[TableName] = [];
      }
      schema[TableName].push({
        columnName: ColumnName,
        dataType: DataType,
        maxLength: MaxLength,
        isNullable: IsNullable === 1,
        isPrimaryKey: IsPrimaryKey === 1,
        foreignKey: ForeignKeyConstraint || null
      });
    });

    cachedSchema = schema;
    lastFetched = now;
    console.log("📊 Database schema dynamically discovered and cached in memory.");
    return cachedSchema;
  } catch (error) {
    console.error("❌ Schema Discovery Failed:", error.message);
    if (cachedSchema) {
      console.warn("⚠️ Using expired/stale schema discovery cache.");
      return cachedSchema;
    }
    throw error;
  }
}

function getSchemaPromptRepresentation(schema) {
  let schemaText = "";
  for (const [tableName, columns] of Object.entries(schema)) {
    const colList = columns.map(c => `${c.columnName} (${c.dataType}${c.isPrimaryKey ? ', PRIMARY KEY' : ''}${c.foreignKey ? `, FK` : ''})`).join(', ');
    schemaText += `Table: ${tableName}\nColumns: ${colList}\n\n`;
  }
  return schemaText;
}

module.exports = {
  discoverSchema,
  getSchemaPromptRepresentation
};
