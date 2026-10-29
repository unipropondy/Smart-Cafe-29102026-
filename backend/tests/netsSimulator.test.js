/**
 * netsSimulator.test.js
 * End-to-End integration test using an in-process NETS ECR II terminal simulator
 * to thoroughly test FC 55, 56, 80, 81, 84, 30, I5, and Q1/Q2.
 */

const net = require('net');
const assert = require('assert');
const { NetsTransport } = require('../services/nets/netsTransport');
const { NetsService } = require('../services/nets/netsService');
const {
  STX,
  ETX,
  ACK,
  NAK,
  computeLrc,
  parseLanResponse,
  buildLanPacket
} = require('../services/nets/netsProtocol');

console.log('🧪 Starting NETS Simulator Integration Test Suite...\n');

// 1. Create a simulated NETS ECR II terminal server on localhost
const SIM_PORT = 7588;
let lastReceivedCommand = null;
let simulateNakCount = 0;

const server = net.createServer((socket) => {
  let chunks = [];

  socket.on('data', (data) => {
    chunks.push(data);
    const combined = Buffer.concat(chunks);

    // Minimum LAN packet: 2 bytes len + 18 bytes header + 1 byte LRC = 21 bytes
    if (combined.length >= 21) {
      const parsed = parseLanResponse(combined);
      lastReceivedCommand = parsed;

      // Handle simulated NAK (busy) scenario
      if (simulateNakCount > 0) {
        simulateNakCount--;
        socket.write(Buffer.from([NAK]));
        chunks = [];
        return;
      }

      // Build simulated response matching NETS spec
      const fc = parsed.functionCode;
      const ecn = parsed.ecn;

      if (fc === '55') {
        // FC 55: Terminal Status Check Response (Sample: 0019...55000...)
        const respPacket = buildLanPacket(ecn, '55', [], '00'); // Version '00' in header becomes response code
        socket.write(respPacket);
      } else if (fc === '30') {
        // FC 30: All NETS Purchase Response
        const respFields = [
          { code: '02', data: 'APPROVED                                ' },
          { code: 'D0', data: 'NETS TEST STORE 123                     ' },
          { code: '03', data: '261028' },
          { code: '04', data: '154500' },
          { code: '16', data: '39012348' },
          { code: 'D1', data: '390123456788   ' },
          { code: '65', data: '000123' },
          { code: '01', data: '987654' },
          { code: 'D3', data: '123456789012' },
          { code: 'L7', data: 'NETS DEBIT          ' },
          { code: '40', data: '000000001550' },
          { code: 'HC', data: '00' },
          { code: 'RP', data: 'NETS TRANSACTION APPROVED\nAMT: $15.50\nSTAN: 000123\nAPPR: 987654' }
        ];
        const respPacket = buildLanPacket(ecn, '30', respFields, '00');
        socket.write(respPacket);
      } else if (fc === '56') {
        // FC 56: Last Approved Transaction
        const respFields = [
          { code: 'FC', data: '30' },
          { code: '01', data: '987654' },
          { code: '40', data: '000000001550' }
        ];
        const respPacket = buildLanPacket(ecn, '56', respFields, '00');
        socket.write(respPacket);
      } else if (fc === '80') {
        // FC 80: Logon
        const respPacket = buildLanPacket(ecn, '80', [{ code: '02', data: 'LOGON SUCCESSFUL                        ' }], '00');
        socket.write(respPacket);
      } else if (fc === '81') {
        // FC 81: Settlement
        const respPacket = buildLanPacket(ecn, '81', [
          { code: '02', data: 'SETTLEMENT COMPLETE                     ' },
          { code: 'RP', data: 'NETS SETTLEMENT APPROVED\nBATCH TOTAL: $15.50' }
        ], '00');
        socket.write(respPacket);
      } else if (fc === '84') {
        // FC 84: TMS
        const respPacket = buildLanPacket(ecn, '84', [], '00');
        socket.write(respPacket);
      } else if (fc === 'I5') {
        // FC I5: Credit Settlement
        const respPacket = buildLanPacket(ecn, 'I5', [
          { code: '02', data: 'CREDIT SETTLEMENT APPROVED              ' },
          { code: 'RP', data: 'DBS SETTLEMENT SUCCESS' }
        ], '00');
        socket.write(respPacket);
      } else if (fc === 'Q1') {
        // FC Q1: NETS QR Payload Request
        const respFields = [
          { code: 'Q0', data: '00020101021226580011SG.NETS.COM0112123456789012520458145303702540515.505802SG5915NETS TEST STORE6009SINGAPORE6304ABCD' },
          { code: 'Q1', data: '180' },
          { code: 'D0', data: 'NETS TEST STORE' }
        ];
        const respPacket = buildLanPacket(ecn, 'Q1', respFields, '00');
        socket.write(respPacket);
      } else if (fc === 'Q2') {
        // FC Q2: NETS QR Payment Query
        const respFields = [
          { code: '01', data: '112233' },
          { code: '65', data: '000124' },
          { code: 'D3', data: '998877665544' },
          { code: 'RP', data: 'NETS QR APPROVED $15.50' }
        ];
        const respPacket = buildLanPacket(ecn, 'Q2', respFields, '00');
        socket.write(respPacket);
      }
      chunks = [];
    }
  });
});

server.listen(SIM_PORT, '127.0.0.1', async () => {
  console.log(`📡 Mock NETS Terminal listening on 127.0.0.1:${SIM_PORT}`);

  try {
    const transport = new NetsTransport({
      mode: 'LAN',
      terminalIp: '127.0.0.1',
      terminalPort: SIM_PORT,
      ackTimeoutMs: 1000
    });
    const netsService = new NetsService(transport);

    // ─────────────────────────────────────────────────────────────
    // TEST A: FC 55 Request Terminal Status
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test A: FC 55 Terminal Status Check ---');
    const statusRes = await netsService.requestTerminalStatus(3000);
    assert.strictEqual(statusRes.success, true, 'Status check must succeed');
    assert.strictEqual(statusRes.isApproved, true, 'Terminal must be ready');
    assert.strictEqual(statusRes.functionCode, '55');
    console.log('  ✅ Status check returned APPROVED (00)');

    // ─────────────────────────────────────────────────────────────
    // TEST B: FC 55 with NAK retry handling (Section 2.2.2.2)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test B: FC 55 NAK Retry Handling ---');
    simulateNakCount = 1; // Simulate 1 NAK, should retry and succeed
    const statusRetryRes = await netsService.requestTerminalStatus(5000);
    assert.strictEqual(statusRetryRes.success, true, 'Status check after 1 NAK must retry and succeed');
    console.log('  ✅ NAK retry handling verified successfully!');

    // ─────────────────────────────────────────────────────────────
    // TEST C: FC 30 All NETS Purchase
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test C: FC 30 All NETS Purchase ($15.50) ---');
    const purchaseRes = await netsService.processPurchase({
      amount: 15.50,
      ecrRef: 'INV-1001',
      timeoutMs: 5000
    });
    assert.strictEqual(purchaseRes.success, true, 'Purchase must succeed');
    assert.strictEqual(purchaseRes.approvalCode, '987654');
    assert.strictEqual(purchaseRes.stan, '000123');
    assert.strictEqual(purchaseRes.amount, 15.50);
    assert.ok(purchaseRes.receiptText.includes('NETS TRANSACTION APPROVED'));
    console.log(`  ✅ Purchase approved! STAN: ${purchaseRes.stan}, APPR: ${purchaseRes.approvalCode}`);

    // ─────────────────────────────────────────────────────────────
    // TEST D: FC 56 Get Last Approved Transaction
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test D: FC 56 Get Last Approved Transaction ---');
    const lastRes = await netsService.getLastApprovedTransaction(3000);
    assert.strictEqual(lastRes.success, true);
    assert.strictEqual(lastRes.lastFunctionCode, '30');
    assert.strictEqual(lastRes.fields['01'].trim(), '987654');
    console.log('  ✅ Last approved transaction retrieved matching purchase!');

    // ─────────────────────────────────────────────────────────────
    // TEST E: FC 80 Logon
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test E: FC 80 NETS Logon ---');
    const logonRes = await netsService.logon(3000);
    assert.strictEqual(logonRes.success, true);
    console.log('  ✅ NETS Logon completed successfully!');

    // ─────────────────────────────────────────────────────────────
    // TEST F: FC 81 Settlement & FC I5 Credit Settlement
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test F: Settlements (FC 81 & FC I5) ---');
    const netsSettleRes = await netsService.netsSettlement(3000);
    assert.strictEqual(netsSettleRes.success, true);
    assert.ok(netsSettleRes.receiptText.includes('NETS SETTLEMENT APPROVED'));

    const creditSettleRes = await netsService.creditSettlement('DBS', 3000);
    assert.strictEqual(creditSettleRes.success, true);
    console.log('  ✅ Both NETS & Credit settlements completed successfully!');

    // ─────────────────────────────────────────────────────────────
    // TEST G: FC 84 TMS / CTS Update
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test G: FC 84 TMS / CTS Update ---');
    const tmsRes = await netsService.tmsUpdate(3000);
    assert.strictEqual(tmsRes.success, true);
    console.log('  ✅ TMS Update command triggered successfully!');

    // ─────────────────────────────────────────────────────────────
    // TEST H: POS-Displayed QR Flow (Q1 & Q2)
    // ─────────────────────────────────────────────────────────────
    console.log('\n--- Test H: POS-Displayed QR Flow (Q1 & Q2) ---');
    const q1Res = await netsService.requestQrPayload({ amount: 15.50, ecrRef: 'QR-1001', timeoutMs: 3000 });
    assert.strictEqual(q1Res.success, true);
    assert.ok(q1Res.qrPayload.length > 20, 'QR payload must be returned');
    assert.strictEqual(q1Res.qrTimerSeconds, 180);
    console.log('  ✅ Q1 returned QR Payload & Timer successfully!');

    const q2Res = await netsService.queryQrPayment({
      amount: 15.50,
      qrPayload: q1Res.qrPayload,
      ecrRef: 'QR-1001',
      timeoutMs: 3000
    });
    assert.strictEqual(q2Res.success, true);
    assert.strictEqual(q2Res.approvalCode, '112233');
    console.log('  ✅ Q2 confirmed QR payment approval successfully!');

    console.log('\n🏆 ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS! 🎯');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  } finally {
    server.close(() => {
      console.log('🛑 Simulated server closed.');
      process.exit(0);
    });
  }
});
