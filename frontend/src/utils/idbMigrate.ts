// Сайт атауы ауысқанда ескі IndexedDB деректерін жаңа базаға бір рет көшіру

export async function migrateLegacyDb(legacyName: string, target: IDBDatabase, storeName: string): Promise<void> {
  try {
    // Ескі база жоқ болса, оны open() арқылы бос күйде жасап қоймау үшін алдын ала тексереміз
    if (indexedDB.databases) {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === legacyName)) return;
    }

    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(legacyName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (legacy.objectStoreNames.contains(storeName)) {
      const records = await new Promise<unknown[]>((resolve, reject) => {
        const req = legacy.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      await new Promise<void>((resolve, reject) => {
        const tx = target.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        records.forEach((record) => store.put(record));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    legacy.close();
    indexedDB.deleteDatabase(legacyName);
  } catch (error) {
    console.warn('Ескі IndexedDB деректерін көшіру сәтсіз:', error);
  }
}
