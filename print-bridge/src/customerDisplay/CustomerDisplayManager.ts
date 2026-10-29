import { BrowserWindow } from 'electron';
import * as path from 'path';
import { getSecondaryDisplay } from './MonitorService';
import { logger } from '../logger';
import { config } from '../config';

let displayWindow: BrowserWindow | null = null;

// Paths differ depending on whether we run in development (src/) or production packaged (dist/)
const getUIPath = () => {
  const { app } = require('electron');
  return path.join(app.getAppPath(), 'customer-display-web', 'index.html');
};

/**
 * Launches the customer display window on the secondary display (if detected).
 */
export function launchCustomerDisplay() {
  const secondary = getSecondaryDisplay();
  if (!secondary) {
    logger.warn('[CustomerDisplay] No secondary monitor found — aborting launch.');
    return;
  }

  if (displayWindow && !displayWindow.isDestroyed()) {
    logger.info('[CustomerDisplay] Window already open.');
    return;
  }

  const { x, y, width, height } = secondary.bounds;
  displayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const uiPath = getUIPath();
  const exists = require('fs').existsSync(uiPath);
  logger.info(`[CustomerDisplay] Loading UI from: ${uiPath} (File Exists: ${exists})`);

  // Open DevTools automatically for debugging if in development
  if (!require('electron').app.isPackaged) {
    displayWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Event Listeners for thorough tracking
  displayWindow.webContents.on('did-start-loading', () => {
    logger.info('[CustomerDisplay Event] did-start-loading');
  });

  displayWindow.webContents.on('did-finish-load', () => {
    logger.info('[CustomerDisplay Event] did-finish-load');
  });

  displayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    logger.error(`[CustomerDisplay Event] did-fail-load: code=${errorCode}, desc=${errorDescription}, url=${validatedURL}`);
  });

  displayWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error(`[CustomerDisplay Event] render-process-gone: reason=${details.reason}`);
  });

  displayWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    logger.info(`[CustomerDisplay Console] [level=${level}] ${message} (at ${sourceId}:${line})`);
  });

  // Load the standalone Expo route via local Express server to resolve absolute path assets correctly
  // (Omit the .html extension so Expo Router matches the route pathname exactly)
  const url = `http://localhost:${config.port}/customer-display-standalone`;
  logger.info(`[CustomerDisplay] Loading UI from URL: ${url}`);

  displayWindow.loadURL(url)
    .then(() => {
      logger.info('[CustomerDisplay] loadURL promise resolved successfully');
    })
    .catch((err) => {
      logger.error(`[CustomerDisplay] loadURL promise rejected: ${err.message}`);
    });

  displayWindow.on('closed', () => {
    logger.warn('[CustomerDisplay] Window was closed.');
    displayWindow = null;
  });

  logger.info(`[CustomerDisplay] Window opened successfully on monitor (${width}x${height}).`);
}

/**
 * Closes the customer display window.
 */
export function closeCustomerDisplay() {
  if (displayWindow && !displayWindow.isDestroyed()) {
    displayWindow.close();
  }
  displayWindow = null;
  logger.info('[CustomerDisplay] Window closed.');
}

/**
 * Pushes customer display state data directly into the React Native Web app inside the BrowserWindow
 * using window.postMessage.
 */
export function pushStateToDisplay(state: any) {
  if (!displayWindow || displayWindow.isDestroyed()) return;

  const payload = JSON.stringify({
    __source: 'electron-print-bridge',
    payload: state,
  });

  displayWindow.webContents
    .executeJavaScript(`window.postMessage(${payload}, '*')`)
    .catch((err) => logger.error(`[CustomerDisplay] Failed to push state to display: ${err.message}`));
}

// 10s Heartbeat watcher: ensures that if the window was closed but the monitor is still attached, it gets relaunched.
setInterval(() => {
  if (getSecondaryDisplay() && (!displayWindow || displayWindow.isDestroyed())) {
    logger.warn('[CustomerDisplay] Heartbeat: window not found but monitor connected. Relaunching...');
    launchCustomerDisplay();
  }
}, 10000);
