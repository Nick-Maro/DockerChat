
export class IndexedDBHelper {
  private dbName = 'ChatAppDB';
  private version = 1;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores
        if (!db.objectStoreNames.contains('keyValue')) {
          db.createObjectStore('keyValue', { keyPath: 'key' });
        }
        
        if (!db.objectStoreNames.contains('ecdhKeys')) {
          db.createObjectStore('ecdhKeys', { keyPath: 'peerId' });
        }
      };
    });
  }

  async setItem(key: string, value: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keyValue'], 'readwrite');
      const store = transaction.objectStore('keyValue');
      const request = store.put({ key, value });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keyValue'], 'readonly');
      const store = transaction.objectStore('keyValue');
      const request = store.get(key);
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async removeItem(key: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keyValue'], 'readwrite');
      const store = transaction.objectStore('keyValue');
      const request = store.delete(key);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async setECDHKey(peerId: string, key: string): Promise<void> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['ecdhKeys'], 'readwrite');
      const store = transaction.objectStore('ecdhKeys');
      const request = store.put({ peerId, key });
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getECDHKey(peerId: string): Promise<string | null> {
    if (!this.db) await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['ecdhKeys'], 'readonly');
      const store = transaction.objectStore('ecdhKeys');
      const request = store.get(peerId);
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.key : null);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Create a singleton instance
export const indexedDBHelper = new IndexedDBHelper();