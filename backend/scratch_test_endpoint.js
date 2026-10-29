const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/reports/login-wise-sales?filter=custom&startDate=2026-09-28&endDate=2026-09-28',
  method: 'GET',
  headers: {
    'Authorization': 'Bearer dummy-or-check'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log("Status:", res.statusCode);
    console.log("Data snippet:", data.slice(0, 300));
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

req.end();
