const { poolPromise } = require('../backend/config/db');
const sql = require('../backend/node_modules/mssql');

async function test() {
  const tableId = '718077AA-1DE4-45AD-B807-5DCC701C9917';
  
  // Call the backend API /api/orders/send via http fetch
  try {
    const res = await fetch('http://localhost:3000/api/orders/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId: tableId,
        orderType: 'TAKEAWAY',
        entryStatus: 'q',
        items: [{
          id: 'D50B97D3-FD16-4AD9-97BD-ACC6AB91DD1E',
          lineItemId: require('crypto').randomUUID(),
          name: '100plus',
          qty: 1,
          price: 1.00,
          status: 'SENT',
          isTakeaway: true
        }]
      })
    });
    const data = await res.json();
    console.log("Response:", res.status, data);
  } catch (err) {
    console.error("Fetch error:", err);
  }
  process.exit(0);
}

test();
