/**
 * Unit & Regression Tests for netsProtocol.js
 * Validates framing, LRC, BCD conversion, and field extraction against official NETS samples.
 */

const assert = require('assert');
const {
  toBcd2,
  fromBcd2,
  computeLrc,
  buildLanPacket,
  buildRs232Packet,
  parseLanResponse,
  parseRs232Response,
  buildRequestHeader
} = require('../services/nets/netsProtocol');

console.log('🧪 Starting NETS Protocol Unit Tests...\n');

// Test 1: BCD 2-byte conversion
console.log('Test 1: BCD conversion');
const bcd19 = toBcd2(19);
assert.strictEqual(bcd19.toString('hex'), '0019', 'BCD for 19 should be 0019');
assert.strictEqual(fromBcd2(bcd19), 19, 'fromBcd2 should return 19');

const bcd77 = toBcd2(77);
assert.strictEqual(bcd77.toString('hex'), '0077', 'BCD for 77 should be 0077');
assert.strictEqual(fromBcd2(bcd77), 77, 'fromBcd2 should return 77');
console.log('  ✅ BCD conversions match expected.');

// Test 2: LAN Status Check command framing from "lan Sample command.txt"
// Sample: [192.168.9.38:7500] 001930303030303030313737363435353031301C2E
console.log('\nTest 2: LAN Status Check (FC 55) packet building');
const lanPacket = buildLanPacket('000000017764', '55', [], '01');
const expectedLanHex = '001930303030303030313737363435353031301C2E';
assert.strictEqual(
  lanPacket.toString('hex').toUpperCase(),
  expectedLanHex.toUpperCase(),
  `Generated LAN packet must match sample:\nExpected: ${expectedLanHex}\nReceived: ${lanPacket.toString('hex').toUpperCase()}`
);
console.log('  ✅ LAN FC 55 packet matches exact sample command 100%!');

// Test 3: RS-232 Status Check command framing from "ECR2Prime_sample.txt"
// Sample: 02001830303030303030303537363435353031301C0336
console.log('\nTest 3: RS-232 Status Check (FC 55) packet building');
const rsPacket = buildRs232Packet('000000005764', '55', [], '01');
const expectedRsHex = '02001830303030303030303537363435353031301C0336';
assert.strictEqual(
  rsPacket.toString('hex').toUpperCase(),
  expectedRsHex.toUpperCase(),
  `Generated RS232 packet must match sample:\nExpected: ${expectedRsHex}\nReceived: ${rsPacket.toString('hex').toUpperCase()}`
);
console.log('  ✅ RS-232 FC 55 packet matches exact sample command 100%!');

// Test 4: LAN Purchase with fields (T2, 40, 42, HD)
// Sample from UAT Certification Requirement:
// 02007730303030303030313432323633303031301C5432000230311C343000123030303030303030313030301C343200123030303030303030303030301C4844001343455041533530325F696374321C0340
console.log('\nTest 4: RS-232 FC 30 All NETS Purchase packet building');
const purchaseRsPacket = buildRs232Packet('000000014226', '30', [
  { code: 'T2', data: '01' },
  { code: '40', data: '000000001000' },
  { code: '42', data: '000000000000' },
  { code: 'HD', data: 'CEPAS502_ict2' }
], '01');
const expectedPurchaseRsHex = '02007730303030303030313432323633303031301C5432000230311C343000123030303030303030313030301C343200123030303030303030303030301C4844001343455041533530325F696374321C0340';
assert.strictEqual(
  purchaseRsPacket.toString('hex').toUpperCase(),
  expectedPurchaseRsHex.toUpperCase(),
  `Generated RS-232 Purchase packet mismatch!`
);
console.log('  ✅ RS-232 Purchase command matches UAT sample command 100%!');

// Test 5: LAN Response Parsing
console.log('\nTest 5: LAN Status Check Response Parsing');
// Response sample: 001930303030303030313737363435353030301C2F
const sampleLanRespBuf = Buffer.from('001930303030303030313737363435353030301C2F', 'hex');
const parsedLan = parseLanResponse(sampleLanRespBuf);
assert.strictEqual(parsedLan.valid, true, 'LRC should be valid');
assert.strictEqual(parsedLan.ecn, '000000017764', 'ECN should match');
assert.strictEqual(parsedLan.functionCode, '55', 'Function code should be 55');
assert.strictEqual(parsedLan.responseCode, '00', 'Response code should be 00');
assert.strictEqual(parsedLan.isApproved, true, 'isApproved should be true');
console.log('  ✅ LAN Response parsed successfully!');

// Test 6: RS-232 Purchase Response Parsing from comLog.txt (Test_01)
console.log('\nTest 6: RS-232 Purchase Response Parsing from comLog.txt');
const fs = require('fs');
const path = require('path');
const comLogPath = path.resolve(__dirname, '../../docs/nets_specs/comLog.txt');
let test01Hex = '';
if (fs.existsSync(comLogPath)) {
  const lines = fs.readFileSync(comLogPath, 'utf8').split('\n');
  test01Hex = lines[14].replace(/.*\[COM2\]\s*/, '').trim().split(/\s+/).join('');
}
const parsedRs = parseRs232Response(Buffer.from(test01Hex, 'hex'));
assert.strictEqual(parsedRs.valid, true, 'RS-232 LRC should be valid');
assert.strictEqual(parsedRs.responseCode, '00', 'Response code should be 00');
assert.strictEqual(parsedRs.fields['01'].trim(), '000006', 'Approval code should be 000006');
assert.strictEqual(parsedRs.fields['16'].trim(), '10050202', 'Terminal ID should be 10050202');
assert.strictEqual(parsedRs.fields['40'].trim(), '000000001000', 'Amount should be 000000001000 ($10.00)');
assert.strictEqual(parsedRs.fields['65'].trim(), '000456', 'STAN should be 000456');
assert.strictEqual(parsedRs.fields['RP'].trim(), 'My Receipt Print data', 'RP receipt field should match');
console.log('  ✅ RS-232 complex response with 20+ fields parsed correctly!');

console.log('\n🎉 ALL PROTOCOL TESTS PASSED SUCCESSFULLY! 🚀');

