const sql = require("mssql");
require("dotenv").config();

const config = {
  user: process.env.DB_USER || "ups",
  password: process.env.DB_PASSWORD || "ups",
  server: process.env.DB_SERVER || "myerpcloud.dyndns.org",
  port: Number(process.env.DB_PORT) || 9199,
  database: process.env.DB_NAME || "UCSPONDY",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

async function checkSchema() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query("SELECT TOP 1 * FROM TableMaster");
    console.log("TableMaster columns:", Object.keys(result.recordset[0]));
    console.log("Sample row:", result.recordset[0]);
    await sql.close();
  } catch (err) {
    console.error("Schema check failed:", err);
  }
}

checkSchema();
