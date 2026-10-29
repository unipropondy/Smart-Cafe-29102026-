const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  user: process.env.AI_DB_USER || process.env.DB_USER,
  password: process.env.AI_DB_PASSWORD || process.env.DB_PASSWORD,
  server: process.env.AI_DB_SERVER || process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.AI_DB_PORT || process.env.DB_PORT || '1433'),
  database: process.env.AI_DB_NAME || process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 10000, 
    requestTimeout: 10000,
    appName: "POS_AI_Service_Replica"
  },
  pool: {
    max: 20, // Keep pool small for AI service
    min: 2,
    idleTimeoutMillis: 30000
  }
};

let poolInstance = null;

const getReadOnlyPool = async () => {
  if (poolInstance) return poolInstance;

  try {
    poolInstance = await new sql.ConnectionPool(dbConfig).connect();
    console.log("✅ AI Microservice connected successfully to Read-Only DB Pool");
    return poolInstance;
  } catch (err) {
    console.error("❌ AI Microservice DB Connection Failed:", err.message);
    poolInstance = null;
    throw err;
  }
};

module.exports = {
  sql,
  getReadOnlyPool
};
