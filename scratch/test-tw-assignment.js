const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const url = new URL(path, BASE_URL);

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('========================================================');
  console.log('🧪 RUNNING QR TAKEAWAY (QR TW) TABLE ASSIGNMENT TESTS');
  console.log('========================================================\n');

  // Clear any existing takeaway tables for clean baseline test
  console.log('0. Preparing baseline: checking existing tables...');
  const initialTables = await request('GET', '/api/tables/all');
  console.log(`   Total tables retrieved: ${Array.isArray(initialTables.body) ? initialTables.body.length : 'unknown'}`);

  // TEST 1: Customer 1 scans (calls auto-assign with session 1)
  console.log('\n--- TEST 1: Customer 1 Scans QR Code (Immediate Assignment) ---');
  const session1 = 'tw_test_cust_1_' + Date.now();
  const res1 = await request('POST', '/api/tables/auto-assign-takeaway', {
    sessionId: session1,
    customerName: 'Customer 1',
    pax: 1
  });
  console.log(`   Customer 1 Response:`, res1.body?.table?.tableNo, `(Table ID: ${res1.body?.table?.tableId})`);
  const table1 = res1.body?.table?.tableNo;

  // TEST 2: Customer 1 does NOTHING. Customer 2 scans QR code.
  console.log('\n--- TEST 2: Customer 1 Does Nothing. Customer 2 Scans QR Code ---');
  const session2 = 'tw_test_cust_2_' + Date.now();
  const res2 = await request('POST', '/api/tables/auto-assign-takeaway', {
    sessionId: session2,
    customerName: 'Customer 2',
    pax: 1
  });
  console.log(`   Customer 2 Response:`, res2.body?.table?.tableNo, `(Table ID: ${res2.body?.table?.tableId})`);
  const table2 = res2.body?.table?.tableNo;

  if (table1 && table2 && table1 !== table2) {
    console.log(`   ✅ PASS: Customer 1 assigned ${table1}, Customer 2 assigned ${table2}. No duplicate!`);
  } else {
    console.error(`   ❌ FAIL: Duplicate or invalid assignment! C1: ${table1}, C2: ${table2}`);
  }

  // TEST 3: Customer 1 refreshes the page (calls auto-assign again with session 1)
  console.log('\n--- TEST 3: Customer 1 Refreshes Page (Session Persistence) ---');
  const res1Refresh = await request('POST', '/api/tables/auto-assign-takeaway', {
    sessionId: session1,
    customerName: 'Customer 1',
    pax: 1
  });
  console.log(`   Customer 1 Refresh Response:`, res1Refresh.body?.table?.tableNo, `(Existing Session: ${res1Refresh.body?.isExistingSession})`);
  if (res1Refresh.body?.table?.tableNo === table1) {
    console.log(`   ✅ PASS: Customer 1 retained the same table ${table1} across refresh.`);
  } else {
    console.error(`   ❌ FAIL: Customer 1 received a different table on refresh! Got: ${res1Refresh.body?.table?.tableNo}`);
  }

  // TEST 4: POS Grid Fetch / Reconcile Check
  console.log('\n--- TEST 4: POS Grid Fetch (Verify Auto-Reconciliation does not clear idle TW tables) ---');
  await request('GET', '/api/tables/all');
  const res1AfterPoll = await request('POST', '/api/tables/auto-assign-takeaway', {
    sessionId: session1,
    customerName: 'Customer 1',
    pax: 1
  });
  if (res1AfterPoll.body?.table?.tableNo === table1) {
    console.log(`   ✅ PASS: Idle TW table ${table1} was NOT wiped by POS tables auto-reconciliation.`);
  } else {
    console.error(`   ❌ FAIL: Idle TW table was reset after POS fetch!`);
  }

  // TEST 5: Concurrent Scanning (Multiple customers scanning simultaneously)
  console.log('\n--- TEST 5: 4 Concurrent Customers Scanning Simultaneously ---');
  const concurrentSessions = [
    { sessionId: 'tw_concur_A_' + Date.now(), name: 'Concur Cust A' },
    { sessionId: 'tw_concur_B_' + Date.now(), name: 'Concur Cust B' },
    { sessionId: 'tw_concur_C_' + Date.now(), name: 'Concur Cust C' },
    { sessionId: 'tw_concur_D_' + Date.now(), name: 'Concur Cust D' },
  ];

  const concurrentPromises = concurrentSessions.map(c => 
    request('POST', '/api/tables/auto-assign-takeaway', {
      sessionId: c.sessionId,
      customerName: c.name,
      pax: 1
    })
  );

  const results = await Promise.all(concurrentPromises);
  const assignedTables = results.map((r, i) => {
    const tNo = r.body?.table?.tableNo;
    console.log(`   ${concurrentSessions[i].name} -> ${tNo}`);
    return tNo;
  });

  const uniqueTables = new Set(assignedTables.filter(Boolean));
  if (uniqueTables.size === 4) {
    console.log(`   ✅ PASS: All 4 concurrent scans received unique tables: ${assignedTables.join(', ')}`);
  } else {
    console.error(`   ❌ FAIL: Duplicate tables detected among concurrent scans! Got: ${assignedTables.join(', ')}`);
  }

  console.log('\n========================================================');
  console.log('🎉 TESTS COMPLETE');
  console.log('========================================================\n');
}

runTests().catch(console.error);
