import * as localforageNamespace from 'localforage';

// handle both CJS/ESModule shapes of localforage at runtime
const lf: typeof localforageNamespace & { default?: any } =
  (localforageNamespace as any)?.default ? (localforageNamespace as any).default : (localforageNamespace as any);

interface SessionData {
  id: string;
  candidateName: string;
  startTime: string;
  endTime?: string;
  events: Array<any>;
  recordingChunks?: Array<any>;
  remoteSessionId?: string;
}

interface BackendUser {
  _id: string;
  uniqueId: string;
  name: string;
  email?: string;
  createdAt?: string;
}

interface BackendSession {
  _id: string;
  user: string;
  startedAt: string;
  endedAt?: string;
  metadata?: any;
  createdAt?: string;
}

class StorageManager {
  private static instance: StorageManager;
  private dbName = 'ProctoringApp';
  private storeName = 'sessions';
  private backendBaseUrl: string | null = null;

  private constructor() {
    this.initializeStorage();
  }

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  private initializeStorage(): void {
    // Use the runtime-compatible lf reference
    lf.config({
      driver: lf.INDEXEDDB,
      name: this.dbName,
      version: 1.0,
      storeName: this.storeName,
      description: 'Storage for proctoring session data'
    });
  }

  setBackendBaseUrl(url: string | null) {
    if (!url) {
      this.backendBaseUrl = null;
      return;
    }
    this.backendBaseUrl = url.replace(/\/+$/, '');
  }

  private get headers() {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  async createOrGetUser(uniqueId: string, name: string, email?: string): Promise<BackendUser | null> {
    if (!uniqueId || !name) throw new Error('uniqueId and name required');

    if (!this.backendBaseUrl) return null;

    try {
      const res = await fetch(`${this.backendBaseUrl}/api/users`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ uniqueId, name, email })
      });
      if (!res.ok) {
        console.warn('createOrGetUser backend returned non-ok:', res.status);
        return null;
      }
      const user = (await res.json()) as BackendUser;
      return user;
    } catch (err) {
      console.warn('createOrGetUser failed; offline fallback:', err);
      return null;
    }
  }

  async startSession(uniqueId: string, candidateName: string, metadata?: any): Promise<SessionData> {
    const localId = `${uniqueId}-${Date.now()}`;
    const session: SessionData = {
      id: localId,
      candidateName,
      startTime: new Date().toISOString(),
      events: [],
      recordingChunks: []
    };

    // Save locally first
    await this.saveSession(session);

    if (!this.backendBaseUrl) return session;

    try {
      const res = await fetch(`${this.backendBaseUrl}/api/sessions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ uniqueId, metadata: metadata || {} })
      });

      if (!res.ok) {
        console.warn('startSession backend returned non-ok:', res.status);
        return session;
      }

      const backendSession = (await res.json()) as BackendSession;
      session.remoteSessionId = backendSession._id;
      await this.saveSession(session);
      return session;
    } catch (err) {
      console.warn('startSession failed; offline fallback:', err);
      return session;
    }
  }

  async sendLogs(localSessionId: string, logsArray: any | any[]): Promise<{ inserted?: number } | null> {
    const items = Array.isArray(logsArray) ? logsArray : [logsArray];

    // always append locally first
    try {
      const session = await this.getSession(localSessionId);
      if (session) {
        for (const it of items) {
          session.events.push({
            type: it.type || 'unknown',
            timestamp: it.timestamp || new Date().toISOString(),
            payload: it.payload || {}
          });
        }
        await this.saveSession(session);
      }
    } catch (err) {
      console.warn('sendLogs local save failed:', err);
    }

    if (!this.backendBaseUrl) return null;

    const session = await this.getSession(localSessionId);
    if (!session) return null;

    // If remoteSessionId is missing, attempt to create remote session once
    if (!session.remoteSessionId) {
      try {
        // Try to create remote session using candidateName as unique key fallback
        // (Prefer to use stored backend user data when available)
        const storedUser = localStorage.getItem('focustrack_user');
        let uniqueIdForRemote = (storedUser ? JSON.parse(storedUser).uniqueId : null) || session.candidateName;
        const resCreate = await fetch(`${this.backendBaseUrl}/api/sessions`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ uniqueId: uniqueIdForRemote, metadata: {} })
        });
        if (resCreate.ok) {
          const bs = await resCreate.json();
          session.remoteSessionId = bs._id;
          await this.saveSession(session);
        }
      } catch (err) {
        console.warn('sendLogs: failed to create remote session on-the-fly:', err);
      }
    }

    if (!session.remoteSessionId) return null;

    try {
      const res = await fetch(`${this.backendBaseUrl}/api/sessions/${session.remoteSessionId}/logs`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(items)
      });

      if (!res.ok) {
        console.warn('sendLogs backend non-ok', res.status);
        return null;
      }
      const body = await res.json();
      return body as { inserted?: number };
    } catch (err) {
      console.warn('sendLogs backend failed:', err);
      return null;
    }
  }

  async endSession(localSessionId: string): Promise<SessionData | null> {
    try {
      const session = await this.getSession(localSessionId);
      if (!session) return null;

      session.endTime = new Date().toISOString();
      await this.saveSession(session);

      if (this.backendBaseUrl && session.remoteSessionId) {
        try {
          const res = await fetch(`${this.backendBaseUrl}/api/sessions/${session.remoteSessionId}/end`, {
            method: 'PATCH',
            headers: this.headers
          });
          if (!res.ok) {
            console.warn('endSession backend non-ok', res.status);
          } else {
            // optional: refresh local remoteSessionId or other fields if backend returns updated doc
            // const updated = await res.json();
          }
        } catch (err) {
          console.warn('endSession backend failed:', err);
        }
      }

      return session;
    } catch (err) {
      console.error('endSession failed:', err);
      return null;
    }
  }

  async saveSession(sessionData: SessionData): Promise<void> {
    try {
      await lf.setItem(sessionData.id, sessionData);
      console.log(`Session ${sessionData.id} saved successfully`);
    } catch (error) {
      console.error('Failed to save session:', error);
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const session = await lf.getItem(sessionId);
      return session as SessionData | null;
    } catch (error) {
      console.error('Failed to retrieve session:', error);
      return null;
    }
  }

  async getAllSessions(): Promise<SessionData[]> {
    try {
      const sessions: SessionData[] = [];
      await lf.iterate((value: any) => {
        sessions.push(value as SessionData);
      });
      return sessions.sort((a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );
    } catch (error) {
      console.error('Failed to retrieve sessions:', error);
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await lf.removeItem(sessionId);
      console.log(`Session ${sessionId} deleted successfully`);
    } catch (error) {
      console.error('Failed to delete session:', error);
      throw error;
    }
  }

  async clearAllSessions(): Promise<void> {
    try {
      await lf.clear();
      console.log('All sessions cleared successfully');
    } catch (error) {
      console.error('Failed to clear sessions:', error);
      throw error;
    }
  }

  async getStorageUsage(): Promise<{ used: number; quota: number }> {
    try {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
          used: estimate.usage || 0,
          quota: estimate.quota || 0
        };
      }
      return { used: 0, quota: 0 };
    } catch (error) {
      console.error('Failed to get storage usage:', error);
      return { used: 0, quota: 0 };
    }
  }

  async saveEvent(sessionId: string, event: any): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        session.events.push(event);
        await this.saveSession(session);
        // also attempt to send to backend if remote session exists
        await this.sendLogs(sessionId, event).catch(() => { /* ignore */ });
      }
    } catch (error) {
      console.error('Failed to save event:', error);
    }
  }

  async checkStorageQuota(): Promise<{ warning: boolean; percentage: number }> {
    const { used, quota } = await this.getStorageUsage();
    if (quota === 0) return { warning: false, percentage: 0 };

    const percentage = (used / quota) * 100;
    return {
      warning: percentage > 80,
      percentage
    };
  }

  async cleanupOldSessions(daysToKeep: number = 7): Promise<number> {
    try {
      const sessions = await this.getAllSessions();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let deletedCount = 0;
      for (const session of sessions) {
        const sessionDate = new Date(session.startTime);
        if (sessionDate < cutoffDate) {
          await this.deleteSession(session.id);
          deletedCount++;
        }
      }

      console.log(`Cleaned up ${deletedCount} old sessions`);
      return deletedCount;
    } catch (error) {
      console.error('Failed to cleanup old sessions:', error);
      return 0;
    }
  }

  private isObjectIdLike(id: string | undefined | null): boolean {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
  }
}

export default StorageManager;
