import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import { logger } from './logger';

/**
 * Parses tags like [C], [L], [R], <B>, </B>, <font size='big'> to ESC/POS binary buffers.
 */
function parseFormatting(content: string): Buffer {
  const chunks: Buffer[] = [];
  
  // Tag translation regex
  const tagRegex = /(\[C\]|\[L\]|\[R\]|<\/?B>|<font size='big'>|<font size='normal'>|<\/font>)/gi;
  const parts = content.split(tagRegex);
  
  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower === '[c]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x01])); // Align center
    } else if (lower === '[l]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x00])); // Align left
    } else if (lower === '[r]') {
      chunks.push(Buffer.from([0x1B, 0x61, 0x02])); // Align right
    } else if (lower === '<b>') {
      chunks.push(Buffer.from([0x1B, 0x45, 0x01])); // Bold on
    } else if (lower === '</b>') {
      chunks.push(Buffer.from([0x1B, 0x45, 0x00])); // Bold off
    } else if (lower === "<font size='big'>" || lower === "<font size=\"big\">") {
      chunks.push(Buffer.from([0x1D, 0x21, 0x11])); // Double width + double height
    } else if (lower === "<font size='normal'>" || lower === "<font size=\"normal\">" || lower === '</font>') {
      chunks.push(Buffer.from([0x1D, 0x21, 0x00])); // Reset font size
    } else {
      chunks.push(Buffer.from(part, 'utf-8'));
    }
  }
  
  // Append line feeds and paper cut command (GS V 66 0)
  chunks.push(Buffer.from([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00]));
  
  return Buffer.concat(chunks);
}

/**
 * Verifies that the destination printer is reachable using a short TCP connection check.
 * Checks the actual ESC/POS port (9100) with a 750ms timeout. Returns true if reachable, false otherwise.
 * Does not throw exceptions for expected offline printers.
 */
export function checkPrinterReachable(ip: string, port: number = 9100, timeoutMs: number = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeoutMs);

    socket.connect(port, ip, () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(true);
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(false);
      }
    });
  });
}

/**
 * Sends a raw data payload to a LAN/Wi-Fi thermal printer using a TCP socket connection.
 * Supports both base64 binary encoding and standard UTF-8 string encoding with tag translation.
 */
// Known cash drawer base64 payloads — these must be sent as raw binary with
// NO printer initialization (ESC @) or line feeds prepended, as that causes
// the printer to advance paper before executing the drawer-open pulse.
const CASH_DRAWER_PAYLOADS = new Set([
  'G3AAGRk=',   // ESC p 0 25 25 — standard drawer open
  'EBQBAAU=',   // DLE DC4 1 0 5 — real-time drawer open (no paper feed)
]);

export async function sendToPrinter(ip: string, port: number, content: string, jobId: string | number): Promise<void> {
  const targetPort = port || 9100;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const client = new net.Socket();
    const timeoutVal = 30000;
    const connectTimeoutMs = 3000; // 3 seconds connection timeout limit

    client.setTimeout(timeoutVal);

    let payload: Buffer;
    
    // Quick heuristic to check if content is base64 encoded binary
    const trimmed = content.trim();
    const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && (trimmed.length % 4 === 0);
    const isCashDrawerCommand = CASH_DRAWER_PAYLOADS.has(trimmed);

    if (isCashDrawerCommand) {
      // Decode the drawer command to pure binary — no extra bytes, no init
      payload = Buffer.from(trimmed, 'base64');
      console.log(`\n[CashDrawer] Opening drawer (raw binary only, no paper feed)\n`);
    } else if (isBase64) {
      payload = Buffer.from(trimmed, 'base64');
    } else {
      payload = parseFormatting(content);
    }

    if (!isCashDrawerCommand) {
      console.log(`\n[Print]\nStarted...\n`);
    }

    const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip.trim());

    if (!isIp && ip.trim().length > 0) {
      logger.info(`[Print Bridge] USB/Named printer detected: '${ip.trim()}'. Sending via Win32 RawPrinter.`);
      sendToWindowsPrinter(ip.trim(), payload)
        .then(() => resolve())
        .catch((err) => reject(err));
      return;
    }

    let resolved = false;
    const connectTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        console.log(`Status: FAILED\nError: Connection to printer timed out\n`);
        reject(new Error('Connection to printer timed out'));
      }
    }, connectTimeoutMs);

    client.connect(targetPort, ip, () => {
      clearTimeout(connectTimer);
      client.write(payload, () => {
        client.end();
      });
    });

    client.on('close', () => {
      clearTimeout(connectTimer);
      if (!resolved) {
        resolved = true;
        const duration = Date.now() - startTime;
        console.log(`Completed\nDuration: ${duration}ms\nStatus: COMPLETED\n`);
        resolve();
      }
    });

    client.on('error', (err: any) => {
      clearTimeout(connectTimer);
      if (!resolved) {
        resolved = true;
        client.destroy();
        console.log(`Status: FAILED\nError: ${err.message || 'TCP Socket Connection Failed'}\n`);
        reject(err);
      }
    });

    client.on('timeout', () => {
      clearTimeout(connectTimer);
      if (!resolved) {
        resolved = true;
        client.destroy();
        console.log(`Status: FAILED\nError: Connection timed out\n`);
        reject(new Error(`Connection to printer timed out`));
      }
    });
  });
}

/**
 * Sends raw ESC/POS binary buffer directly to a Windows printer spooler by name.
 * Uses winspool.drv via PowerShell C# Win32 API.
 */
export function sendToWindowsPrinter(printerName: string, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let cleanName = printerName.trim();
    if (cleanName.toLowerCase().startsWith('\\\\localhost\\')) {
      cleanName = cleanName.substring(13);
    } else if (cleanName.startsWith('\\\\')) {
      const parts = cleanName.split('\\').filter(Boolean);
      if (parts.length === 1) {
        cleanName = parts[0];
      }
    }

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `unipro_print_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.bin`);

    try {
      fs.writeFileSync(tmpFile, payload);
    } catch (fsErr: any) {
      return reject(new Error(`Failed to write temp print file: ${fsErr.message}`));
    }

    // Try fast pre-compiled C# binary RawPrint.exe (Instant ~30ms execution)
    const candidatePaths = [
      path.join(__dirname, 'RawPrint.exe'),
      path.join(__dirname, '..', 'src', 'RawPrint.exe'),
      path.join(process.cwd(), 'dist', 'RawPrint.exe'),
      path.join(process.cwd(), 'src', 'RawPrint.exe'),
      path.join(process.cwd(), 'RawPrint.exe')
    ];
    const exePath = candidatePaths.find(p => fs.existsSync(p));

    if (exePath) {
      execFile(exePath, [cleanName, tmpFile], (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        if (err || !stdout.includes('SUCCESS')) {
          let errorMsg = stderr.trim() || stdout.trim() || (err ? err.message : 'Printer not reachable');
          logger.error(`[Print Bridge] USB Printer '${cleanName}' print failed: ${errorMsg}`);
          reject(new Error(`USB Printer '${cleanName}' is not connected or printing failed. (${errorMsg})`));
        } else {
          logger.info(`[Print Bridge] USB Printer '${cleanName}' print completed INSTANTLY via RawPrint.exe.`);
          resolve();
        }
      });
      return;
    }

    // Fallback: PowerShell C# Win32 API
    const safePrinterName = cleanName.replace(/'/g, "''");
    const safeFilePath = tmpFile.replace(/'/g, "''");

    const psScript = `
$p = '${safePrinterName}';
$f = '${safeFilePath}';
if (-not (Test-Path $f)) { Write-Host 'NO_FILE'; exit 1 }
$b = [System.IO.File]::ReadAllBytes($f);
$c = @'
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO1 { public string pDocName; public string pOutputFile; public string pDataType; }
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, DOCINFO1 pDocInfo);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static bool SendBytes(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        DOCINFO1 di = new DOCINFO1(); di.pDocName = "UniPro POS Receipt"; di.pDataType = "RAW";
        if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
        if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
        int written = 0; bool ok = WritePrinter(hPrinter, bytes, bytes.Length, out written);
        EndPagePrinter(hPrinter); EndDocPrinter(hPrinter); ClosePrinter(hPrinter);
        return ok && (written == bytes.Length);
    }
}
'@;
if (-not ([System.Management.Automation.PSTypeName]'RawPrinter').Type) { Add-Type -TypeDefinition $c }
if ([RawPrinter]::SendBytes($p, $b)) { Write-Host "SUCCESS" } else { Write-Host "FAILED"; exit 1 }
`;

    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;

    exec(command, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err || stdout.trim() !== 'SUCCESS') {
        let errorMsg = stderr.trim() || stdout.trim() || (err ? err.message : 'Printer not reachable');
        if (errorMsg.includes('CLIXML')) {
          errorMsg = 'Printer handle could not be opened or printer is offline/disconnected';
        }
        logger.error(`[Print Bridge] USB Printer '${cleanName}' print failed: ${errorMsg}`);
        reject(new Error(`USB Printer '${cleanName}' is not connected or printing failed. (${errorMsg})`));
      } else {
        logger.info(`[Print Bridge] USB Printer '${cleanName}' print completed successfully.`);
        resolve();
      }
    });
  });
}

/**
 * Returns installed printers on Windows OS
 */
export function getInstalledPrinters(): Promise<Array<{ name: string; port: string; status: string; isUsb: boolean }>> {
  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, PrinterStatus, PortName, DriverName | ConvertTo-Json"`;
    exec(cmd, (err, stdout) => {
      if (err || !stdout.trim()) {
        return resolve([]);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const printers = list.map((p: any) => ({
          name: p.Name || '',
          port: p.PortName || '',
          status: p.PrinterStatus || 'Unknown',
          isUsb: String(p.PortName || '').toUpperCase().startsWith('USB'),
        }));
        resolve(printers);
      } catch (e) {
        resolve([]);
      }
    });
  });
}

