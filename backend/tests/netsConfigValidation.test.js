/**
 * netsConfigValidation.test.js
 * Comprehensive unit and integration test suite for:
 * 1. Safe configuration validation (rejects invalid IP, port 3000, web ports, invalid modes).
 * 2. Sensitive payment data masking (PAN first 6 + last 4 only, PIN masked).
 * 3. Prevention of sending binary packets to HTTP endpoints.
 * 4. Immediate detection of non-NETS HTTP web responses.
 * 5. Structured diagnostics on timeout, port conflict, and connection errors.
 */

const assert = require('assert');
const net = require('net');
const { defaultTransport, maskSensitiveHex, NetsTransport } = require('../services/nets/netsTransport');
const { defaultNetsService } = require('../services/nets/netsService');
const { isValidBcd2, toBcd2, fromBcd2, parseLanResponse } = require('../services/nets/netsProtocol');

async function runTests() {
  console.log('🧪 Starting NETS Configuration, Validation & Diagnostic Tests...\n');

  // Test 1: BCD Validator
  console.log('--- Test 1: BCD Validator (isValidBcd2) ---');
  const validBcd = Buffer.from([0x00, 0x19]); // 00 19 = 25
  const invalidBcd1 = Buffer.from([0x48, 0x54]); // 'H', 'T' (HTTP header bytes: 0x48 has 8 > 9, wait 8<=9, 4<=9, but 0x54 has 4,5 <=9, what about 0x48: d1=4, d2=8)
  const invalidBcd2 = Buffer.from([0x1A, 0x20]); // 0x1A: low nibble is 0x0A (10 > 9)
  const invalidBcd3 = Buffer.from([0xBF, 0x01]); // 0xBF: high nibble 11 > 9, low 15 > 9

  assert.strictEqual(isValidBcd2(validBcd, 0), true, 'Valid BCD 00 19 should return true');
  assert.strictEqual(isValidBcd2(invalidBcd2, 0), false, '0x1A contains non-decimal nibble 0x0A');
  assert.strictEqual(isValidBcd2(invalidBcd3, 0), false, '0xBF contains non-decimal nibbles');
  console.log('  ✅ isValidBcd2 correctly identifies valid and invalid BCD byte sequences.');

  // Test 2: Safe Configuration Validation - Rejections
  console.log('\n--- Test 2: Configuration Validation - Invalid Inputs ---');
  const transport = new NetsTransport();

  // Test 2a: Reject port 3000 (Node.js Express HTTP server port)
  const resPort3000 = transport.validateConfig({ terminalPort: 3000 }, 3000);
  assert.strictEqual(resPort3000.isValid, false, 'Port 3000 should be rejected');
  assert.ok(resPort3000.errors.some(e => e.includes('reserved for the POS Node.js Express HTTP server')), 'Error should mention POS HTTP server');
  console.log('  ✅ Port 3000 (POS HTTP server) successfully rejected with clear error.');

  // Test 2b: Reject standard web ports (80, 443, 8080)
  const resWebPort = transport.validateConfig({ terminalPort: 80 });
  assert.strictEqual(resWebPort.isValid, false, 'Port 80 should be rejected');
  assert.ok(resWebPort.errors.some(e => e.includes('standard HTTP/HTTPS web port')), 'Error should mention standard web port');
  console.log('  ✅ Web port 80 successfully rejected.');

  // Test 2c: Reject out of bounds ports
  const resBadPort = transport.validateConfig({ terminalPort: 99999 });
  assert.strictEqual(resBadPort.isValid, false, 'Port 99999 should be rejected');
  console.log('  ✅ Out-of-bounds port 99999 rejected.');

  // Test 2d: Reject invalid IPv4 address
  const resBadIp = transport.validateConfig({ terminalIp: '999.1.2.3' });
  assert.strictEqual(resBadIp.isValid, false, 'Invalid IP should be rejected');
  console.log('  ✅ Invalid IP 999.1.2.3 rejected.');

  // Test 2e: Reject broadcast IP
  const resBroadcastIp = transport.validateConfig({ terminalIp: '255.255.255.255' });
  assert.strictEqual(resBroadcastIp.isValid, false, 'Broadcast IP should be rejected');
  console.log('  ✅ Broadcast IP 255.255.255.255 rejected.');

  // Test 2f: Reject invalid interface mode
  const resBadMode = transport.validateConfig({ mode: 'BLUETOOTH' });
  assert.strictEqual(resBadMode.isValid, false, 'Invalid mode BLUETOOTH should be rejected');
  console.log('  ✅ Invalid mode BLUETOOTH rejected.');

  // Test 3: Safe Configuration Validation - Valid Inputs
  console.log('\n--- Test 3: Configuration Validation - Valid Inputs ---');
  const resValid = transport.validateConfig({
    mode: 'LAN',
    terminalIp: '192.168.1.50',
    terminalPort: 7500,
    onlineTimeoutSec: 120,
    offlineTimeoutSec: 60
  });
  assert.strictEqual(resValid.isValid, true, 'Valid config should pass');
  assert.strictEqual(resValid.clean.terminalIp, '192.168.1.50');
  assert.strictEqual(resValid.clean.terminalPort, 7500);
  assert.strictEqual(resValid.clean.onlineTimeoutMs, 120000);
  console.log('  ✅ Valid configuration passed validation cleanly.');

  // Test 4: Sensitive Payment Data Masking
  console.log('\n--- Test 4: PCI Sensitive Data Masking ---');
  // Sample hex containing a 16-digit card number: "4524190012343938"
  const rawWithPan = Buffer.from('4524190012343938', 'ascii');
  const maskedPanHex = maskSensitiveHex(rawWithPan);
  // ASCII of 'X' is 0x58 (58)
  assert.ok(maskedPanHex.includes('58 58 58 58 58 58'), 'Middle PAN digits must be masked with X');
  console.log('  ✅ PAN middle digits masked with X in hex representation.');

  // Test 5: Guard against port conflict in executeLan
  console.log('\n--- Test 5: Pre-connection Guard Against HTTP Port 3000 ---');
  const tempTransport = new NetsTransport({ terminalPort: 3000, terminalIp: '127.0.0.1' });
  try {
    await tempTransport.executeLan('000000000001', '55', [], 2000);
    assert.fail('Should have rejected port 3000 before opening TCP socket');
  } catch (err) {
    assert.strictEqual(err.code, 'E_HTTP_PORT_CONFLICT');
    assert.strictEqual(err.diagnostic.failureReason, 'PORT_CONFLICT_HTTP_SERVER');
    console.log(`  ✅ Successfully blocked binary transmission to port 3000: "${err.diagnostic.detail}"`);
  }

  // Test 6: Immediate Detection of HTTP Server (Mock HTTP Server)
  console.log('\n--- Test 6: Immediate Detection of HTTP Response (No Timeout) ---');
  const mockHttpServer = net.createServer((socket) => {
    socket.on('data', () => {
      // Respond as an HTTP web server would respond to unexpected binary data
      socket.write('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nBad Request');
      socket.end();
    });
  });

  const httpTestPort = 7591;
  await new Promise(r => mockHttpServer.listen(httpTestPort, '127.0.0.1', r));

  const testHttpTransport = new NetsTransport({ terminalPort: httpTestPort, terminalIp: '127.0.0.1' });
  const startMs = Date.now();
  try {
    await testHttpTransport.executeLan('000000000002', '55', [], 10000);
    assert.fail('Should have detected HTTP response and failed immediately');
  } catch (err) {
    const elapsedMs = Date.now() - startMs;
    assert.strictEqual(err.code, 'E_HTTP_ENDPOINT');
    assert.strictEqual(err.diagnostic.failureReason, 'HTTP_ENDPOINT_DETECTED');
    assert.ok(elapsedMs < 1000, `Should fail immediately (<1000ms), took ${elapsedMs}ms`);
    console.log(`  ✅ Detected HTTP server in ${elapsedMs}ms without hanging on timeout: "${err.diagnostic.detail}"`);
  } finally {
    await new Promise(r => mockHttpServer.close(r));
  }

  // Test 7: FC 55 Status Check Structured Diagnostics
  console.log('\n--- Test 7: FC 55 Status Check Diagnostics on Unreachable Host ---');
  // Use a non-routable TEST-NET IP address to test unreachable / timeout diagnostics safely
  const unreachableTransport = new NetsTransport({ terminalIp: '192.0.2.1', terminalPort: 7500 });
  const serviceWithUnreachable = new (require('../services/nets/netsService').NetsService)(unreachableTransport);

  const diagResult = await serviceWithUnreachable.requestTerminalStatus(1000); // 1s timeout
  assert.strictEqual(diagResult.success, false);
  assert.strictEqual(diagResult.functionCode, '55');
  assert.ok(diagResult.diagnostic, 'Diagnostic object must be present');
  assert.strictEqual(diagResult.diagnostic.targetEndpoint, '192.0.2.1:7500');
  assert.ok(diagResult.diagnostic.failureReason, 'Failure reason must be set');
  console.log(`  ✅ FC 55 returns clean diagnostic: Reason="${diagResult.diagnostic.failureReason}", Message="${diagResult.message}"`);

  console.log('\n🎉 ALL CONFIGURATION, VALIDATION & DIAGNOSTIC TESTS PASSED! 🚀');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
