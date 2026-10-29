// Utility for storing images with localStorage quota management and IndexedDB fallback

import { migrateLegacyDb } from './idbMigrate';

class ImageStorage {
  private dbName = 'codo-hub-images';
  private legacyDbName = 'kazakh-hub-images';
  private dbVersion = 1;
  private storeName = 'profile-backgrounds';
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('IndexedDB ашу қатесі:', request.error);
        reject(request.error);
      };

      request.onsuccess = async () => {
        this.db = request.result;
        await migrateLegacyDb(this.legacyDbName, this.db, this.storeName);
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

  /**
   * Check available localStorage quota
   */
  private async getLocalStorageQuota(): Promise<{ used: number; available: number; total: number }> {
    let used = 0;
    let available = 0;

    try {
      // Calculate used space
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          used += localStorage[key].length + key.length;
        }
      }

      // Try to get actual quota if available
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        try {
          const estimate = await navigator.storage.estimate();
          if (estimate.quota) {
            const quota = estimate.quota;
            const usage = estimate.usage || 0;
            available = quota - usage;
            return { used, available, total: used + available };
          }
        } catch {
          // Fallback to estimate if quota API fails
        }
      }

      // Fallback: conservative estimate of 5MB
      const estimatedTotal = 5 * 1024 * 1024; // 5MB
      available = estimatedTotal - used;
    } catch (e) {
      console.warn('Could not calculate localStorage quota:', e);
    }

    return { used, available, total: used + available };
  }

  /**
   * Save image to storage (localStorage or IndexedDB)
   */
  async saveImage(key: string, imageData: string): Promise<void> {
    const imageSize = new Blob([imageData]).size;
    const quota = await this.getLocalStorageQuota();

    // If image is larger than 1MB or would exceed available quota, use IndexedDB
    const maxLocalStorageSize = 1 * 1024 * 1024; // 1MB
    const shouldUseIndexedDB = imageSize > maxLocalStorageSize || imageSize > quota.available * 0.8;
    
    if (shouldUseIndexedDB) {
      // Use IndexedDB for large images
      return this.saveToIndexedDB(key, imageData);
    } else {
      // Try localStorage first
      try {
        localStorage.setItem(key, imageData);
        // Also store a flag indicating it's in localStorage
        localStorage.setItem(`${key}_storage`, 'localStorage');
        return;
      } catch (error: any) {
        // If localStorage fails (quota exceeded), fallback to IndexedDB
        if (error.name === 'QuotaExceededError' || error.code === 22) {
          console.warn('localStorage quota exceeded, using IndexedDB for image storage');
          // Remove the flag if it was set
          try {
            localStorage.removeItem(`${key}_storage`);
          } catch (e) {
            // Ignore
          }
          return this.saveToIndexedDB(key, imageData);
        }
        throw error;
      }
    }
  }

  /**
   * Save image to IndexedDB
   */
  private async saveToIndexedDB(key: string, imageData: string): Promise<void> {
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
      const request = store.put({ id: key, imageData, timestamp: Date.now() });

      request.onsuccess = () => {
        // Store flag indicating it's in IndexedDB
        try {
          localStorage.setItem(`${key}_storage`, 'indexedDB');
        } catch (e) {
          // Ignore if localStorage is full
        }
        resolve();
      };

      request.onerror = () => {
        console.error('IndexedDB сақтау қатесі:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get image from storage
   */
  async getImage(key: string): Promise<string | null> {
    // Check where the image is stored
    const storageType = localStorage.getItem(`${key}_storage`);
    
    if (storageType === 'localStorage') {
      return localStorage.getItem(key);
    } else if (storageType === 'indexedDB') {
      return this.getFromIndexedDB(key);
    } else {
      // Try localStorage first (for backward compatibility)
      const localImage = localStorage.getItem(key);
      if (localImage) {
        return localImage;
      }
      // Then try IndexedDB
      return this.getFromIndexedDB(key);
    }
  }

  /**
   * Get image from IndexedDB
   */
  private async getFromIndexedDB(key: string): Promise<string | null> {
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
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.imageData : null);
      };

      request.onerror = () => {
        console.error('IndexedDB оқу қатесі:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Remove image from storage
   */
  async removeImage(key: string): Promise<void> {
    // Remove from localStorage
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}_storage`);
    } catch (e) {
      // Ignore errors
    }

    // Remove from IndexedDB
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve(); // If DB not initialized, assume nothing to remove
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        console.error('IndexedDB жою қатесі:', request.error);
        reject(request.error);
      };
    });
  }
}

export const imageStorage = new ImageStorage();
