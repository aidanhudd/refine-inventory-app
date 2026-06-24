type StorageKind = "local" | "session"

function getNativeStorage(kind: StorageKind): Storage | null {
  if (typeof window === "undefined") return null

  try {
    return kind === "local" ? window.localStorage : window.sessionStorage
  } catch (error) {
    console.warn(`[storage] ${kind}Storage is unavailable:`, error)
    return null
  }
}

export function safeGetItem(kind: StorageKind, key: string): string | null {
  const storage = getNativeStorage(kind)
  if (!storage) return null

  try {
    return storage.getItem(key)
  } catch (error) {
    console.warn(`[storage] getItem failed for "${key}":`, error)
    return null
  }
}

export function safeSetItem(kind: StorageKind, key: string, value: string): boolean {
  const storage = getNativeStorage(kind)
  if (!storage) return false

  try {
    storage.setItem(key, value)
    return true
  } catch (error) {
    console.warn(`[storage] setItem failed for "${key}":`, error)
    return false
  }
}

export function safeRemoveItem(kind: StorageKind, key: string): void {
  const storage = getNativeStorage(kind)
  if (!storage) return

  try {
    storage.removeItem(key)
  } catch (error) {
    console.warn(`[storage] removeItem failed for "${key}":`, error)
  }
}

export function createSafeAuthStorage() {
  return {
    getItem: (key: string) => safeGetItem("local", key),
    setItem: (key: string, value: string) => {
      safeSetItem("local", key, value)
    },
    removeItem: (key: string) => {
      safeRemoveItem("local", key)
    },
  }
}
