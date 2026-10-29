const fs = require("fs");
const path = "c:/Users/User/Desktop/POS-v-2.0/backend/routes/sales.js";

let content = fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const targetStr = `const { authenticateToken } = require("../middleware/auth");\nrouter.use(authenticateToken);`;

if (!content.includes(targetStr)) {
  console.log("Could not find targetStr");
  process.exit(1);
}

// Find login-wise-sales block start
const salesIdx = content.indexOf("/* ================= LOGIN-WISE SALES REPORT ================= */");
if (salesIdx === -1) {
  console.log("Could not find login-wise-sales block");
  process.exit(1);
}

const reportsBlock = content.slice(salesIdx);
content = content.slice(0, salesIdx);

// Insert reportsBlock before const { authenticateToken }
content = content.replace(targetStr, `${reportsBlock}\n\n${targetStr}`);
fs.writeFileSync(path, content, "utf8");
console.log("SUCCESSFULLY MOVED REPORTS ROUTES PUBLIC!");
