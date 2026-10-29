const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'routes', 'sales.js');
let content = fs.readFileSync(filePath, 'utf8');

// The corrupted text is:
// backtick + ";tWhere}\r\n        ) CombinedSales\r\n        ORDER BY SettlementDate DESC\r\n      " + backtick
// which should just be: backtick
// The NEXT line already has: ";\r\n    } else {"
// So the full corrupt block is the backtick+";tWhere}..." up to and including the second backtick+semicolon
// which becomes just a single backtick+semicolon

// Find the exact corrupt pattern
const corruptSearch = `;tWhere}\r\n        ) CombinedSales\r\n        ORDER BY SettlementDate DESC\r\n      \``;
const corruptIdx = content.indexOf(corruptSearch);

if (corruptIdx === -1) {
  // Try with different spacing
  const corruptSearch2 = `;tWhere}\r\n         ) CombinedSales\r\n         ORDER BY SettlementDate DESC\r\n       \``;
  const corruptIdx2 = content.indexOf(corruptSearch2);
  if (corruptIdx2 === -1) {
    console.log('Corrupt pattern not found. Showing context around ";tWhere}"...');
    const idx = content.indexOf(';tWhere}');
    if (idx >= 0) {
      console.log('Found ";tWhere}" at index:', idx);
      console.log('Raw bytes before:', JSON.stringify(content.substring(idx - 10, idx)));
      console.log('Raw bytes after:', JSON.stringify(content.substring(idx, idx + 120)));
    }
    process.exit(1);
  } else {
    console.log('Found with alt spacing at:', corruptIdx2);
    content = content.substring(0, corruptIdx2) + content.substring(corruptIdx2 + corruptSearch2.length);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed (alt spacing)!');
  }
} else {
  console.log('Found corrupt pattern at:', corruptIdx);
  content = content.substring(0, corruptIdx) + content.substring(corruptIdx + corruptSearch.length);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fixed!');
}

// Verify
const newContent = fs.readFileSync(filePath, 'utf8');
if (newContent.indexOf(';tWhere}') === -1) {
  console.log('Verification passed: corruption removed.');
} else {
  console.log('WARNING: corruption still present!');
}
console.log('New file size:', newContent.length);
