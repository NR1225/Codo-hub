// Offline storage utility using IndexedDB for large file caching

interface PendingUpload {
  id: string;
  type: 'file' | 'folder';
  files: File[];  // Always use File[] — FileList cannot be stored in IndexedDB
  metadata: {
    title?: string;
    description?: string;
    tags?: string[];
    language?: string;
  };
  timestamp: number;
  retryCount: number;
}

class OfflineStorage {
  private dbName = 'kazakh-hub-uploads';
  private dbVersion = 1;
  private storeName = 'pending-uploads';
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('IndexedDB ашу қатесі:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
    });
  }

  async savePendingUpload(upload: PendingUpload): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(upload);

      request.onsuccess = () => {
        console.log('Жүктеу кэштеуге сақталды:', upload.id);
        resolve();
      };

      request.onerror = () => {
        console.error('Кэштеуге сақтау қатесі:', request.error);
        reject(request.error);
      };
    });
  }

  async getPendingUploads(): Promise<PendingUpload[]> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        console.error('Кэштен оқу қатесі:', request.error);
        reject(request.error);
      };
    });
  }

  async removePendingUpload(id: string): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log('Кэштен жүктеу жойылды:', id);
        resolve();
      };

      request.onerror = () => {
        console.error('Кэштен жою қатесі:', request.error);
        reject(request.error);
      };
    });
  }
}

export const offlineStorage = new OfflineStorage();
export type { PendingUpload };