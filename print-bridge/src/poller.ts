import { config } from './config';
import { getBackendInstances, BackendInstance } from './railwayApi';
import { sendToPrinter } from './printer';
import { logger } from './logger';
import { HealthStatus } from './types';

const pollingUrls = new Set<string>();

export const pollerStats = {
  getHealth(): HealthStatus {
    const backends = getBackendInstances();
    const enabledBackends = backends.filter(b => b.enabled !== false);
    
    // Connected if at least one enabled backend is connected (or all if preferred, let's use some/any)
    const connected = enabledBackends.length > 0 ? enabledBackends.some(b => b.connected) : false;
    const totalJobs = backends.reduce((sum, b) => sum + b.jobsProcessed, 0);

    return {
      connected,
      jobsProcessed: totalJobs,
      backends: backends.map(b => ({
        name: b.name,
        url: b.url,
        enabled: b.enabled !== false,
        connected: b.connected,
        authenticated: b.authenticated,
        lastHeartbeat: b.lastHeartbeat,
        lastConnectedTime: b.lastConnectedTime,
        jobsProcessed: b.jobsProcessed
      }))
    };
  }
};

async function processJob(backend: BackendInstance, job: any) {
  try {
    console.log(`\n[${backend.name}] [Job Received]\nJobId: ${job.JobId}\nPrinter: ${job.PrinterName || 'Receipt Printer'}\n`);
    
    // Connect & Print via TCP socket
    await sendToPrinter(job.PrinterIp, job.PrinterPort, job.Content, job.JobId);
    
    // Report success to backend
    await backend.markComplete(job.JobId);
    logger.info(`[${backend.name}] Job ${job.JobId} printed and reported completed successfully.`);
  } catch (err: any) {
    const errorMsg = err.message || 'TCP Socket Connection Failed';
    logger.error(`[${backend.name}] Printing job ${job.JobId} failed: ${errorMsg}`);
    
    // Report failure to backend
    await backend.markFailed(job.JobId, errorMsg);
  }
}

async function pollBackend(backend: BackendInstance) {
  if (backend.enabled === false) return;

  // Authenticate if not already authenticated
  if (!backend.authenticated) {
    const success = await backend.authenticate();
    if (!success) {
      logger.warn(`[${backend.name}] Authentication failed. Will retry in the next cycle.`);
      return;
    }
  }

  try {
    const jobs = await backend.fetchPendingJobs();
    if (jobs.length > 0) {
      logger.info(`[${backend.name}] Retrieved ${jobs.length} pending print job(s) from Railway.`);
      // Process all jobs in parallel
      for (const job of jobs) { await processJob(backend, job); }
    }
  } catch (err: any) {
    logger.error(`[${backend.name}] Poll cycle encountered an error: ${err.message}`);
  }
}

async function pollCycle() {
  const backends = getBackendInstances();

  await Promise.all(backends.map(async (backend) => {
    if (backend.enabled === false) return;
    if (pollingUrls.has(backend.url)) return; // Prevent concurrent cycles for same backend

    pollingUrls.add(backend.url);
    try {
      await pollBackend(backend);
    } finally {
      pollingUrls.delete(backend.url);
    }
  }));

  // Reschedule the polling cycle
  setTimeout(pollCycle, config.pollIntervalMs);
}

export async function startPoller() {
  logger.info('Initializing UniPro Print Bridge Poller...');
  
  const backends = getBackendInstances();
  logger.info(`Found ${backends.length} configured backend(s). Initializing startup authentication...`);

  await Promise.all(backends.map(async (backend) => {
    if (backend.enabled === false) return;
    const success = await backend.authenticate();
    if (success) {
      logger.info(`[${backend.name}] Successfully authenticated on startup.`);
    } else {
      logger.warn(`[${backend.name}] Startup authentication failed. Will retry in background.`);
    }
  }));

  // Start the polling loop
  pollCycle();
}

