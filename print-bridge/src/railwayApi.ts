import axios, { AxiosInstance } from 'axios';
import { config } from './config';
import { PrintJob } from './types';
import { logger } from './logger';

export class BackendInstance {
  name: string;
  url: string;
  enabled: boolean;
  storeId: string;
  bridgeToken: string;

  authenticated: boolean = false;
  connected: boolean = false;
  lastHeartbeat: string | null = null;
  lastConnectedTime: string | null = null;
  jobsProcessed: number = 0;
  private client: AxiosInstance;

  constructor(name: string, url: string, enabled: boolean, storeId: string, bridgeToken: string) {
    this.name = name;
    this.url = url;
    this.enabled = enabled;
    this.storeId = storeId;
    this.bridgeToken = bridgeToken;

    this.client = axios.create({
      baseURL: url,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${bridgeToken}`,
        'x-store-id': storeId,
        'Content-Type': 'application/json'
      }
    });
  }

  logPrefix(): string {
    return `[${this.name}]`;
  }

  async authenticate(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      logger.info(`${this.logPrefix()} Authenticating bridge against backend: ${this.url}`);
      const res = await this.client.post('/api/print-jobs/auth');
      const success = res.data && res.data.success === true;
      this.authenticated = success;
      this.connected = success;
      if (success) {
        this.lastHeartbeat = new Date().toISOString();
        this.lastConnectedTime = new Date().toISOString();
      }
      return success;
    } catch (err: any) {
      logger.error(`${this.logPrefix()} Authentication failed: ${err.message}`);
      this.authenticated = false;
      this.connected = false;
      return false;
    }
  }

  async fetchPendingJobs(): Promise<PrintJob[]> {
    if (!this.enabled) return [];
    try {
      const res = await this.client.get('/api/print-jobs/pending');
      this.connected = true;
      this.lastHeartbeat = new Date().toISOString();
      this.lastConnectedTime = new Date().toISOString();
      if (res.data && res.data.success && Array.isArray(res.data.data)) {
        return res.data.data;
      }
      return [];
    } catch (err: any) {
      this.connected = false;
      logger.error(`${this.logPrefix()} Error polling for pending print jobs: ${err.message}`);
      return [];
    }
  }

  async markComplete(jobId: string): Promise<boolean> {
    try {
      const res = await this.client.post(`/api/print-jobs/${jobId}/complete`);
      const success = res.data && res.data.success === true;
      if (success) {
        this.jobsProcessed++;
      }
      return success;
    } catch (err: any) {
      logger.error(`${this.logPrefix()} Error marking job ${jobId} as completed: ${err.message}`);
      return false;
    }
  }

  async markFailed(jobId: string, errorMessage: string): Promise<boolean> {
    try {
      const res = await this.client.post(`/api/print-jobs/${jobId}/failed`, { errorMessage });
      return res.data && res.data.success === true;
    } catch (err: any) {
      logger.error(`${this.logPrefix()} Error marking job ${jobId} as failed: ${err.message}`);
      return false;
    }
  }
}

// Keep an in-memory instance cache to prevent losing stats/status fields
const instanceCache = new Map<string, BackendInstance>();

export function getBackendInstances(): BackendInstance[] {
  const currentBackends = config.backends || [];
  
  // Clean up cache for removed URLs
  const currentUrls = new Set(currentBackends.map(b => b.url));
  for (const url of instanceCache.keys()) {
    if (!currentUrls.has(url)) {
      instanceCache.delete(url);
    }
  }

  // Add/update current backends
  for (const b of currentBackends) {
    const existing = instanceCache.get(b.url);
    const enabled = b.enabled !== false;
    if (existing) {
      existing.name = b.name;
      existing.enabled = enabled;
      existing.storeId = config.storeId;
      existing.bridgeToken = config.bridgeToken;
    } else {
      const instance = new BackendInstance(
        b.name,
        b.url,
        enabled,
        config.storeId,
        config.bridgeToken
      );
      instanceCache.set(b.url, instance);
    }
  }

  return Array.from(instanceCache.values());
}

