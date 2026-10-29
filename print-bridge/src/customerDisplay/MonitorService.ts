import { screen } from 'electron';
import { EventEmitter } from 'events';
import { logger } from '../logger';

export const monitorEvents = new EventEmitter();

/**
 * Returns the secondary display bounds/metrics.
 * If only one display is connected, returns null.
 */
export function getSecondaryDisplay() {
  const primary = screen.getPrimaryDisplay();
  const all = screen.getAllDisplays();
  const secondary = all.find(d => d.id !== primary.id) ?? null;
  if (secondary) {
    logger.info(
      `[Monitor] Secondary display detected: ${secondary.bounds.width}x${secondary.bounds.height} at (${secondary.bounds.x}, ${secondary.bounds.y})`
    );
  }
  return secondary;
}

/**
 * Initializes listeners on Electron screen APIs to detect monitor additions/removals.
 */
export function startMonitorWatcher() {
  const onChange = () => {
    logger.info('[Monitor] Display configuration changed — re-evaluating displays...');
    monitorEvents.emit('display-changed');
  };

  screen.on('display-added', onChange);
  screen.on('display-removed', onChange);
  screen.on('display-metrics-changed', onChange);
  logger.info('[Monitor] Screen watcher initialized.');
}
