import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

let userDataPath = '';
try {
  if (app) {
    userDataPath = app.getPath('userData');
  }
} catch (e) {
  // app might not be initialized yet
}

if (!userDataPath) {
  userDataPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'UniPro Print Bridge')
    : process.cwd();
}

const STATE_FILE = path.join(userDataPath, 'customer-display-state.json');

let currentState: any = { active: false, paymentSuccess: false };

/**
 * Caches display state in memory and persists to disk.
 */
export function updateState(newState: any) {
  currentState = newState;
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
  } catch (err: any) {
    logger.error(`[DisplayStateStore] Failed to write state: ${err.message}`);
  }
}

/**
 * Returns current state.
 */
export function getCurrentState() {
  return currentState;
}

/**
 * Loads persisted state on startup.
 */
export function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      currentState = JSON.parse(raw);
      logger.info('[DisplayStateStore] Successfully loaded persisted customer display state.');
    }
  } catch (err: any) {
    logger.warn(`[DisplayStateStore] Could not load persisted state: ${err.message}`);
  }
}
