import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let userDataPath = '';
try {
  if (app) {
    userDataPath = app.getPath('userData');
  }
} catch (e) {
  // app might not be initialized or available in dev/testing contexts
}

if (!userDataPath) {
  userDataPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'UniPro Print Bridge')
    : process.cwd();
}

const logDir = path.join(userDataPath, 'logs');
const logFile = path.join(logDir, 'app.log');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

export const logger = {
  info(message: string) {
    const log = `[INFO] [${new Date().toISOString()}] ${message}`;
    console.log(log);
    fs.appendFileSync(logFile, log + '\n');
  },
  error(message: string, error?: any) {
    const errorMsg = error ? ` - Error: ${error.message || error}` : '';
    const log = `[ERROR] [${new Date().toISOString()}] ${message}${errorMsg}`;
    console.error(log);
    fs.appendFileSync(logFile, log + '\n');
  },
  warn(message: string) {
    const log = `[WARN] [${new Date().toISOString()}] ${message}`;
    console.log(log);
    fs.appendFileSync(logFile, log + '\n');
  }
};
