const fs = require("fs");
const content = fs.readFileSync("c:/Users/UNIPRO/Desktop/POS/frontend/components/UniversalPrinter.ts", "utf8");
const lines = content.split("\n");

lines.forEach((line, idx) => {
  if (line.includes("| Table:")) {
    console.log(`${idx + 1}: ${line}`);
  }
});

process.exit(0);
