const { getPool } = require("../config/db");

const dbCheck = (req, res, next) => {
  // Skip check for root and test endpoints if needed
  if (req.path === "/" || req.path === "/test") {
    return next();
  }

  const pool = req.pool || getPool();
  if (!pool) {
    return res.status(503).json({
      error: "Database Connection Unavailable",
      message: "The server is currently unable to connect to the database. Please try again in a few moments.",
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

module.exports = dbCheck;
