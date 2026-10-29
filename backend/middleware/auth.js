const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is not set!");
}

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token is required" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    // Populate req.user with fallback compatibility fields
    req.user = {
      ...decoded,
      id: decoded.userId || decoded.id,
      username: decoded.userName || decoded.username || "Admin",
      userName: decoded.userName || decoded.username || "Admin",
      companyCode: decoded.companyCode || null,
      databaseName: decoded.databaseName || null,
    };
    next();
  });
};

module.exports = { authenticateToken };
