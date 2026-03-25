import { SyncFile, ActivityEntry, ConnectionStatus } from "./types";

// In-memory store (replace with database in production)
class Store {
  private files: Map<string, SyncFile> = new Map();
  private activity: ActivityEntry[] = [];
  private connections: Record<string, ConnectionStatus> = {
    gdrive: { connected: false },
    outlook: { connected: false },
    gmail: { connected: false },
  };

  // Files
  getFiles(): SyncFile[] {
    return Array.from(this.files.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  getFile(id: string): SyncFile | undefined {
    return this.files.get(id);
  }

  upsertFiles(files: SyncFile[]): { added: number; updated: number } {
    let added = 0;
    let updated = 0;
    for (const f of files) {
      if (this.files.has(f.id)) {
        updated++;
      } else {
        added++;
      }
      this.files.set(f.id, { ...this.files.get(f.id), ...f });
    }
    return { added, updated };
  }

  deleteFile(id: string): boolean {
    return this.files.delete(id);
  }

  toggleStar(id: string): boolean {
    const file = this.files.get(id);
    if (!file) return false;
    file.starred = !file.starred;
    return file.starred;
  }

  getStarredFiles(): SyncFile[] {
    return this.getFiles().filter((f) => f.starred);
  }

  searchFiles(query: string, filters?: { source?: string; mimeType?: string; dateFrom?: string; dateTo?: string }): SyncFile[] {
    const q = query.toLowerCase();
    return this.getFiles().filter((f) => {
      const matchesQuery =
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.emailSubject?.toLowerCase().includes(q) ||
        f.emailFrom?.toLowerCase().includes(q) ||
        f.folder?.toLowerCase().includes(q) ||
        f.tags?.some((t) => t.toLowerCase().includes(q));

      const matchesSource = !filters?.source || f.source === filters.source;
      const matchesMime = !filters?.mimeType || f.mimeType.includes(filters.mimeType);
      const matchesDateFrom = !filters?.dateFrom || f.date >= filters.dateFrom;
      const matchesDateTo = !filters?.dateTo || f.date <= filters.dateTo;

      return matchesQuery && matchesSource && matchesMime && matchesDateFrom && matchesDateTo;
    });
  }

  // Activity
  addActivity(entry: Omit<ActivityEntry, "id" | "timestamp">) {
    this.activity.unshift({
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    if (this.activity.length > 200) this.activity = this.activity.slice(0, 200);
  }

  getActivity(limit = 50): ActivityEntry[] {
    return this.activity.slice(0, limit);
  }

  // Connections
  getConnection(source: string): ConnectionStatus {
    return this.connections[source] || { connected: false };
  }

  getAllConnections() {
    return { ...this.connections };
  }

  setConnection(source: string, status: Partial<ConnectionStatus>) {
    this.connections[source] = { ...this.connections[source], ...status };
  }

  // Stats
  getStats() {
    const files = this.getFiles();
    const totalSize = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
    return {
      totalFiles: files.length,
      totalSize: formatBytes(totalSize),
      gdriveFiles: files.filter((f) => f.source === "gdrive").length,
      outlookFiles: files.filter((f) => f.source === "email-outlook").length,
      gmailFiles: files.filter((f) => f.source === "email-gmail").length,
      starredFiles: files.filter((f) => f.starred).length,
      recentFiles: files.slice(0, 5),
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Singleton
export const store = new Store();
