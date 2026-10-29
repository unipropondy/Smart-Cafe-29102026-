const http = require('http');

function getUrl(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

async function testTotalSales() {
  console.log("=== GET /api/settlement/total-sales/ALL ===");
  const totalSales = await getUrl('/api/settlement/total-sales/ALL?fromDate=2026-09-29&toDate=2026-09-29');
  console.log(JSON.stringify(totalSales, null, 2));
}

testTotalSales().catch(console.error);
