/**
 * 极简 IndexedDB 封装（本地数据库）。
 *
 * 为什么用它而不是 localStorage：
 *   - 结构化存储（keyPath），一条快捷回复就是一个对象
 *   - 容量比 localStorage 大
 *   - 异步 API，下面是 Promise 包装
 *
 * 用法：
 *   const db = await idbOpen('yunhu', 1)
 *   await idbPut(db, { id: 'my-uid', text: '好的' })
 *   const all = await idbAll(db)
 *   await idbDel(db, 'my-uid')
 */
export function idbOpen(name: string, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction('kv', mode).objectStore('kv')
}

export function idbPut<T = any>(db: IDBDatabase, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = store(db, 'readwrite').put(value)
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
  })
}

export function idbAll<T = any>(db: IDBDatabase): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = store(db, 'readonly').getAll()
    r.onsuccess = () => resolve((r.result || []) as T[])
    r.onerror = () => reject(r.error)
  })
}

export function idbDel(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = store(db, 'readwrite').delete(id)
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
  })
}

export function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = store(db, 'readwrite').clear()
    r.onsuccess = () => resolve()
    r.onerror = () => reject(r.error)
  })
}
