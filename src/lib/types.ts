export interface SyncFile {
  id: string;
  name: string;
  mimeType: string;
  source: "gdrive" | "email-outlook" | "email-gmail";
  date: string;
  size?: string;
  sizeBytes?: number;
  downloadUrl?: string;
  starred?: boolean;
  folder?: string;
  emailSubject?: string;
  emailFrom?: string;
  tags?: string[];
  previewUrl?: string;
}

export interface IndexedFile extends SyncFile {
  category: string;
  accountingStatus: string;
  period: string | null;
  notes: string | null;
  vendor: string | null;
  amount: string | null;
  currency: string;
  referenceNo: string | null;
  autoCategorized: boolean;
}

export interface SyncStatus {
  gdrive: ConnectionStatus;
  outlook: ConnectionStatus;
  gmail: ConnectionStatus;
}

export interface ConnectionStatus {
  connected: boolean;
  email?: string;
  lastSync?: string;
  fileCount?: number;
}

export interface ActivityEntry {
  id: string;
  action: "sync" | "download" | "star" | "unstar" | "delete" | "connect" | "disconnect";
  source: string;
  details: string;
  timestamp: string;
  fileCount?: number;
}

export interface SyncResult {
  source: string;
  filesAdded: number;
  filesUpdated: number;
  errors: string[];
  timestamp: string;
}
