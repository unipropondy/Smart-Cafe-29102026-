/**
 * netsProtocol.js
 * NETS ECR II Terminal Interface Protocol Engine
 * Reference: NETS ECR II Terminal Interface Technical Specification Document Version 1.27.005
 */

const STX = 0x02;
const ETX = 0x03;
const ACK = 0x06;
const NAK = 0x15;
const FS  = 0x1C; // Field Separator

/**
 * Converts a decimal number into a 2-byte BCD buffer.
 * e.g., 18 -> 0x00, 0x18; 254 -> 0x02, 0x54
 */
function toBcd2(num) {
  const str = Math.max(0, Math.min(9999, Math.floor(num))).toString().padStart(4, '0');
  const b1 = (parseInt(str[0], 10) << 4) | parseInt(str[1], 10);
  const b2 = (parseInt(str[2], 10) << 4) | parseInt(str[3], 10);
  return Buffer.from([b1, b2]);
}

/**
 * Parses a 2-byte BCD buffer into a decimal integer.
 */
function fromBcd2(buf, offset = 0) {
  const b1 = buf[offset];
  const b2 = buf[offset + 1];
  const d1 = (b1 >> 4) & 0x0F;
  const d2 = b1 & 0x0F;
  const d3 = (b2 >> 4) & 0x0F;
  const d4 = b2 & 0x0F;
  return d1 * 1000 + d2 * 100 + d3 * 10 + d4;
}

/**
 * Validates whether 2 bytes starting at offset form a valid 2-byte BCD integer.
 * In BCD, all 4 nibbles must be decimal digits 0 through 9.
 */
function isValidBcd2(buf, offset = 0) {
  if (!buf || buf.length < offset + 2) return false;
  const b1 = buf[offset];
  const b2 = buf[offset + 1];
  const d1 = (b1 >> 4) & 0x0F;
  const d2 = b1 & 0x0F;
  const d3 = (b2 >> 4) & 0x0F;
  const d4 = b2 & 0x0F;
  return d1 <= 9 && d2 <= 9 && d3 <= 9 && d4 <= 9;
}

/**
 * Computes Longitudinal Redundancy Check (LRC) via XOR across all bytes in buffer.
 */
function computeLrc(buffer, start = 0, end = buffer.length) {
  let lrc = 0;
  for (let i = start; i < end; i++) {
    lrc ^= buffer[i];
  }
  return lrc;
}

/**
 * Builds the standard 18-byte Request Message Header:
 * - ECN: 12 ASCII digits (zero-padded)
 * - Function Code: 2 ASCII characters
 * - Version Code: 2 ASCII characters (default "01")
 * - RFU: 1 ASCII character ('0')
 * - Separator: 1 byte (0x1C)
 */
function buildRequestHeader(ecn, functionCode, version = '01') {
  const ecnStr = String(ecn || '1').padStart(12, '0').slice(-12);
  const fcStr = String(functionCode || '').padEnd(2, ' ').slice(0, 2);
  const verStr = String(version || '01').padEnd(2, '0').slice(0, 2);
  const rfuStr = '0';

  const buf = Buffer.alloc(18);
  buf.write(ecnStr, 0, 12, 'ascii');
  buf.write(fcStr, 12, 2, 'ascii');
  buf.write(verStr, 14, 2, 'ascii');
  buf.write(rfuStr, 16, 1, 'ascii');
  buf[17] = FS;
  return buf;
}

/**
 * Encodes a list of data fields into a Message Data buffer.
 * Each field consists of:
 * - Field Code (2 bytes ASCII)
 * - Length (2 bytes BCD)
 * - Data (variable length, ASCII or raw Buffer)
 * - Separator (1 byte 0x1C)
 */
function encodeFields(fields = []) {
  const buffers = [];
  for (const f of fields) {
    if (!f || !f.code) continue;
    const codeBuf = Buffer.alloc(2);
    codeBuf.write(String(f.code).padEnd(2, ' ').slice(0, 2), 0, 2, 'ascii');

    let dataBuf;
    if (Buffer.isBuffer(f.data)) {
      dataBuf = f.data;
    } else {
      dataBuf = Buffer.from(String(f.data ?? ''), 'ascii');
    }

    const lenBcd = toBcd2(dataBuf.length);
    const sep = Buffer.from([FS]);
    buffers.push(Buffer.concat([codeBuf, lenBcd, dataBuf, sep]));
  }
  return Buffer.concat(buffers);
}

/**
 * Decodes fields from a buffer starting at offset until ETX or end of buffer.
 */
function decodeFields(buffer, startOffset = 0, endOffset = buffer.length) {
  const fields = {};
  const rawFields = [];
  let offset = startOffset;

  while (offset + 4 <= endOffset) {
    // Check if next byte is ETX (for RS232) or FS at end
    if (buffer[offset] === ETX) {
      break;
    }

    const fieldCode = buffer.toString('ascii', offset, offset + 2);
    const fieldLen = fromBcd2(buffer, offset + 2);
    offset += 4;

    if (offset + fieldLen > endOffset) {
      // Malformed or truncated field length, protect against overflow
      const remainingData = buffer.slice(offset, endOffset);
      fields[fieldCode] = remainingData.toString('ascii');
      rawFields.push({ code: fieldCode, length: remainingData.length, data: remainingData });
      break;
    }

    const fieldDataBuf = buffer.slice(offset, offset + fieldLen);
    offset += fieldLen;

    // Skip trailing separator FS if present
    if (offset < endOffset && buffer[offset] === FS) {
      offset++;
    }

    const textValue = fieldDataBuf.toString('ascii');
    fields[fieldCode] = textValue;
    rawFields.push({ code: fieldCode, length: fieldLen, data: fieldDataBuf, text: textValue });
  }

  return { fields, rawFields, nextOffset: offset };
}

/**
 * Builds a complete Request Packet for LAN mode:
 * [Length (2 bytes BCD = MessageBody.length + 1)] [MessageBody] [LRC (1 byte)]
 */
function buildLanPacket(ecn, functionCode, fields = [], version = '01') {
  const header = buildRequestHeader(ecn, functionCode, version);
  const data = encodeFields(fields);
  const messageBody = Buffer.concat([header, data]);

  // In LAN mode, Length field represents total length of message body + 1 (LRC)
  const totalLength = messageBody.length + 1;
  const lenBcd = toBcd2(totalLength);

  const lrc = computeLrc(messageBody);
  const lrcBuf = Buffer.from([lrc]);

  return Buffer.concat([lenBcd, messageBody, lrcBuf]);
}

/**
 * Builds a complete Request Packet for RS232 mode:
 * [STX (0x02)] [Length (2 bytes BCD = MessageBody.length)] [MessageBody] [ETX (0x03)] [LRC (1 byte)]
 * LRC is computed over: Length bytes + MessageBody + ETX
 */
function buildRs232Packet(ecn, functionCode, fields = [], version = '01') {
  const header = buildRequestHeader(ecn, functionCode, version);
  const data = encodeFields(fields);
  const messageBody = Buffer.concat([header, data]);

  const lenBcd = toBcd2(messageBody.length);
  const etxBuf = Buffer.from([ETX]);

  // LRC includes Length + Message Body + ETX
  const lrcBytes = Buffer.concat([lenBcd, messageBody, etxBuf]);
  const lrc = computeLrc(lrcBytes);
  const lrcBuf = Buffer.from([lrc]);

  const stxBuf = Buffer.from([STX]);
  return Buffer.concat([stxBuf, lenBcd, messageBody, etxBuf, lrcBuf]);
}

/**
 * Parses a Response Packet from LAN mode:
 * Expects buffer: [Length (2 bytes BCD)] [MessageBody] [LRC (1 byte)]
 */
function parseLanResponse(buffer) {
  if (!buffer || buffer.length < 21) {
    throw new Error(`LAN packet too short: ${buffer ? buffer.length : 0} bytes (min 21 required)`);
  }

  if (!isValidBcd2(buffer, 0)) {
    throw new Error(`Invalid BCD length bytes (0x${buffer.slice(0, 2).toString('hex')}). The endpoint did not return a valid NETS ECR frame.`);
  }

  const declaredLength = fromBcd2(buffer, 0);
  if (buffer.length < declaredLength + 2) {
    throw new Error(`Incomplete LAN packet: received ${buffer.length} bytes, expected ${declaredLength + 2}`);
  }

  const messageBody = buffer.slice(2, 2 + declaredLength - 1);
  const receivedLrc = buffer[2 + declaredLength - 1];
  const calculatedLrc = computeLrc(messageBody);

  const lrcValid = receivedLrc === calculatedLrc;
  if (!lrcValid) {
    console.warn(`⚠️ [NETS] LAN LRC mismatch! Received: 0x${receivedLrc.toString(16)}, Calculated: 0x${calculatedLrc.toString(16)}`);
  }

  // Header is 18 bytes:
  // ECN (12), Function Code (2), Response Code (2), RFU (1), Separator (1)
  const ecn = messageBody.toString('ascii', 0, 12);
  const functionCode = messageBody.toString('ascii', 12, 14);
  const responseCode = messageBody.toString('ascii', 14, 16);
  const rfu = messageBody.toString('ascii', 16, 17);

  const { fields, rawFields } = decodeFields(messageBody, 18, messageBody.length);

  return {
    mode: 'LAN',
    valid: lrcValid,
    declaredLength,
    ecn,
    functionCode,
    responseCode,
    rfu,
    isApproved: responseCode === '00',
    fields,
    rawFields,
    rawHex: buffer.toString('hex').toUpperCase()
  };
}

/**
 * Parses a Response Packet from RS232 mode:
 * Expects: [STX (0x02)] [Length (2 bytes BCD)] [MessageBody] [ETX (0x03)] [LRC (1 byte)]
 */
function parseRs232Response(buffer) {
  if (!buffer || buffer.length < 23) {
    throw new Error(`RS232 packet too short: ${buffer ? buffer.length : 0} bytes (min 23 required)`);
  }

  if (buffer[0] !== STX) {
    throw new Error(`Invalid RS232 packet: missing STX (0x02) at byte 0`);
  }

  const declaredBodyLen = fromBcd2(buffer, 1);
  const expectedTotalLen = 1 + 2 + declaredBodyLen + 1 + 1; // STX + LEN + Body + ETX + LRC
  if (buffer.length < expectedTotalLen) {
    throw new Error(`Incomplete RS232 packet: received ${buffer.length} bytes, expected ${expectedTotalLen}`);
  }

  const messageBody = buffer.slice(3, 3 + declaredBodyLen);
  const etxByte = buffer[3 + declaredBodyLen];
  if (etxByte !== ETX) {
    console.warn(`⚠️ [NETS] RS232 packet missing ETX at expected position, found: 0x${etxByte.toString(16)}`);
  }

  const receivedLrc = buffer[3 + declaredBodyLen + 1];
  const lrcBytes = buffer.slice(1, 3 + declaredBodyLen + 1); // Length + Body + ETX
  const calculatedLrc = computeLrc(lrcBytes);

  const lrcValid = receivedLrc === calculatedLrc;
  if (!lrcValid) {
    console.warn(`⚠️ [NETS] RS232 LRC mismatch! Received: 0x${receivedLrc.toString(16)}, Calculated: 0x${calculatedLrc.toString(16)}`);
  }

  const ecn = messageBody.toString('ascii', 0, 12);
  const functionCode = messageBody.toString('ascii', 12, 14);
  const responseCode = messageBody.toString('ascii', 14, 16);
  const rfu = messageBody.toString('ascii', 16, 17);

  const { fields, rawFields } = decodeFields(messageBody, 18, messageBody.length);

  return {
    mode: 'RS232',
    valid: lrcValid,
    declaredLength: declaredBodyLen,
    ecn,
    functionCode,
    responseCode,
    rfu,
    isApproved: responseCode === '00',
    fields,
    rawFields,
    rawHex: buffer.toString('hex').toUpperCase()
  };
}

/**
 * Human-readable mapping for NETS Annex C Response Codes.
 */
const RESPONSE_CODE_MESSAGES = {
  '00': 'Approved',
  '01': 'Requested function is not available',
  '02': 'Terminal is in pre-activation mode',
  '03': 'Contactless reader not connected or faulty',
  '04': 'Contact reader not connected or faulty',
  '51': 'Host has declined authorization request',
  'C0': 'Unable to detect or read card',
  'C1': 'Invalid card',
  'HS': 'Terminal encountered connection problem',
  'LR': 'Logon is required',
  'TO': 'Timeout during authorization request',
  'CE': 'Card expired',
  'IP': 'Invalid PIN',
  'MA': 'Transaction aborted on terminal',
  'UT': 'User cancelled transaction',
  'TA': 'Terminal already busy'
};

function getResponseDescription(code) {
  return RESPONSE_CODE_MESSAGES[code] || `Terminal Response Code ${code}`;
}

module.exports = {
  STX,
  ETX,
  ACK,
  NAK,
  FS,
  toBcd2,
  fromBcd2,
  isValidBcd2,
  computeLrc,
  buildRequestHeader,
  encodeFields,
  decodeFields,
  buildLanPacket,
  buildRs232Packet,
  parseLanResponse,
  parseRs232Response,
  getResponseDescription,
  RESPONSE_CODE_MESSAGES
};
