import * as fs from 'fs';
import * as path from 'path';
import { BridgeConfig } from './types';
import { logger } from './logger';

const CONFIG_FILENAME = 'config.json';

const execDir = path.dirname(process.execPath);
const execConfigPath = path.join(execDir, CONFIG_FILENAME);
const localConfigPath = path.join(process.cwd(), CONFIG_FILENAME);

function getElectronApp(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    return electron?.app || null;
  } catch (e) {
    return null;
  }
}

let appPath = '';
try {
  const electronApp = getElectronApp();
  if (electronApp) {
    appPath = electronApp.getAppPath();
  }
} catch (e) {
  // app might not be initialized or available in dev/testing contexts
}

const packageConfigPath = appPath ? path.join(appPath, CONFIG_FILENAME) : '';
let finalConfigPath = '';

// Check if a path is writable
function isWritable(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) {
      // Check if parent directory is writable
      const dir = path.dirname(filePath);
      fs.accessSync(dir, fs.constants.W_OK);
      return true;
    }
    fs.accessSync(filePath, fs.constants.W_OK);
    return true;
  } catch (e) {
    return false;
  }
}

// Fallback user config path (similar to logger logs directory)
let userConfigPath = '';
try {
  const electronApp = getElectronApp();
  if (electronApp) {
    userConfigPath = path.join(electronApp.getPath('userData'), CONFIG_FILENAME);
  }
} catch (e) {}
if (!userConfigPath) {
  userConfigPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'UniPro Print Bridge', CONFIG_FILENAME)
    : path.join(process.cwd(), CONFIG_FILENAME);
}

// Determine best writable config path
if (fs.existsSync(execConfigPath) && isWritable(execConfigPath)) {
  finalConfigPath = execConfigPath;
} else if (fs.existsSync(localConfigPath) && isWritable(localConfigPath)) {
  finalConfigPath = localConfigPath;
} else if (packageConfigPath && fs.existsSync(packageConfigPath) && isWritable(packageConfigPath)) {
  finalConfigPath = packageConfigPath;
} else {
  // If we can't write to any of the standard locations (like when installed in Program Files),
  // copy the template config to the writable user data directory if it doesn't exist yet.
  finalConfigPath = userConfigPath;
  const parentDir = path.dirname(userConfigPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  
  if (!fs.existsSync(userConfigPath)) {
    // Attempt to copy template from read-only locations
    let templateSource = '';
    if (fs.existsSync(execConfigPath)) templateSource = execConfigPath;
    else if (fs.existsSync(localConfigPath)) templateSource = localConfigPath;
    else if (packageConfigPath && fs.existsSync(packageConfigPath)) templateSource = packageConfigPath;

    if (templateSource) {
      try {
        fs.copyFileSync(templateSource, userConfigPath);
      } catch (err) {}
    }
  }
}

const defaultConfig: BridgeConfig = {
  storeId: 'STORE_001',
  bridgeToken: 'unipro-pos-bridge-token-2026',
  pollIntervalMs: 500,
  port: 3050,
  backends: [
    {
      name: 'RN POS',
      url: 'https://pos-v-20-production.up.railway.app',
      enabled: true
    },
    {
      name: 'QR POS',
      url: 'https://online-qr-production.up.railway.app',
      enabled: true
    }
  ]
  
};

function loadConfig(): BridgeConfig {
  if (!fs.existsSync(finalConfigPath)) {
    logger.warn(`Could not find config.json in any path. Using built-in defaults.`);
    return defaultConfig;
  }

  try {
    const raw = fs.readFileSync(finalConfigPath, 'utf8');
    const parsed = JSON.parse(raw) as BridgeConfig;

    // Backward compatibility conversion:
    if (!parsed.backends || !Array.isArray(parsed.backends)) {
      const url = parsed.apiUrl || parsed.backendUrl || 'https://pos-v-20-production.up.railway.app';
      parsed.backends = [
        {
          name: 'Default',
          url: url,
          enabled: true
        }
      ];
      logger.info(`Conversions: Mapped legacy URL configuration into multi-backends.`);
    }

    logger.info(`Loaded configurations successfully from: ${finalConfigPath}`);
    return parsed;
  } catch (err: any) {
    logger.error(`Error reading config.json: ${err.message}. Using built-in defaults.`);
    return defaultConfig;
  }
}

export function saveConfig(newConfig: BridgeConfig): boolean {
  try {
    // Ensure all backends are correctly formatted
    const cleanBackends = (newConfig.backends || []).map(b => ({
      name: b.name || 'Unnamed',
      url: b.url || '',
      enabled: b.enabled !== false
    }));

    const toSave: BridgeConfig = {
      storeId: newConfig.storeId,
      bridgeToken: newConfig.bridgeToken,
      pollIntervalMs: newConfig.pollIntervalMs || 500,
      port: newConfig.port || 3050,
      backends: cleanBackends,
      customerDisplay: newConfig.customerDisplay
    };

    fs.writeFileSync(finalConfigPath, JSON.stringify(toSave, null, 2), 'utf8');
    logger.info(`Saved config.json successfully to: ${finalConfigPath}`);
    
    // Dynamically update the exported configuration object fields in memory
    Object.assign(config, toSave);
    return true;
  } catch (err: any) {
    logger.error(`Error saving config.json: ${err.message}`);
    return false;
  }
}

export const config = loadConfig();
