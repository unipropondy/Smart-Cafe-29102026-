export interface CustomerDisplayConfig {
  enabled: boolean;
  fullscreen: boolean;
  autoRecovery: boolean;
}

export interface BackendConfig {
  name: string;
  url: string;
  enabled?: boolean;
}

export interface BridgeConfig {
  storeId: string;
  bridgeToken: string;
  apiUrl?: string;       // Keep for backward compatibility
  backendUrl?: string;   // Keep for backward compatibility
  backends?: BackendConfig[];
  pollIntervalMs: number;
  port: number;
  customerDisplay?: CustomerDisplayConfig;
}

export interface PrintJob {
  JobId: string;
  StoreId: string;
  PrinterName?: string;
  PrinterIp: string;
  PrinterPort: number;
  Content: string; // Plain ESC/POS or base64
  Status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  Attempts: number;
}

export interface HealthStatus {
  connected: boolean;
  lastPoll?: string;
  jobsProcessed: number;
  backends?: Array<{
    name: string;
    url: string;
    enabled: boolean;
    connected: boolean;
    authenticated: boolean;
    lastHeartbeat: string | null;
    lastConnectedTime: string | null;
    jobsProcessed: number;
  }>;
}
