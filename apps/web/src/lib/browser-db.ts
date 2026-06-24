type StoreName = "settings" | "jobs" | "artifacts" | "artifactBlobs";

interface MemoryDatabase {
  settings: Map<string, unknown>;
  jobs: Map<string, unknown>;
  artifacts: Map<string, unknown>;
  artifactBlobs: Map<string, Blob>;
}

const DB_NAME = "video-affiliate-browser-db";
const DB_VERSION = 1;

let databasePromise: Promise<IDBDatabase | MemoryDatabase> | null = null;

function createMemoryDatabase(): MemoryDatabase {
  return {
    settings: new Map<string, unknown>(),
    jobs: new Map<string, unknown>(),
    artifacts: new Map<string, unknown>(),
    artifactBlobs: new Map<string, Blob>()
  };
}

function isMemoryDatabase(database: IDBDatabase | MemoryDatabase): database is MemoryDatabase {
  return "settings" in database;
}

function openIndexedDatabase(): Promise<IDBDatabase | MemoryDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(createMemoryDatabase());
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Gagal membuka IndexedDB."));
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of ["settings", "jobs", "artifacts", "artifactBlobs"] as StoreName[]) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function getDatabase(): Promise<IDBDatabase | MemoryDatabase> {
  databasePromise ??= openIndexedDatabase();
  return databasePromise;
}

export async function dbGet<T>(storeName: StoreName, key: string): Promise<T | undefined> {
  const db = await getDatabase();
  if (isMemoryDatabase(db)) {
    return db[storeName].get(key) as T | undefined;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onerror = () => reject(request.error ?? new Error(`Gagal membaca ${storeName}.`));
    request.onsuccess = () => resolve(request.result as T | undefined);
  });
}

export async function dbSet<T>(storeName: StoreName, key: string, value: T): Promise<void> {
  const db = await getDatabase();
  if (isMemoryDatabase(db)) {
    db[storeName].set(key, value as unknown as Blob & unknown);
    return;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.put(value, key);
    request.onerror = () => reject(request.error ?? new Error(`Gagal menyimpan ${storeName}.`));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Gagal menyimpan ${storeName}.`));
  });
}

export async function dbDelete(storeName: StoreName, key: string): Promise<void> {
  const db = await getDatabase();
  if (isMemoryDatabase(db)) {
    db[storeName].delete(key);
    return;
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onerror = () => reject(request.error ?? new Error(`Gagal menghapus ${storeName}.`));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error(`Gagal menghapus ${storeName}.`));
  });
}
