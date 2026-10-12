type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface RememberedSwitch {
  read(storage: Storage): boolean
  write(storage: Storage, enabled: boolean): void
}

// A switch the browser remembers under `key`, off until the Operator switches it on.
export function rememberedSwitch(key: string): RememberedSwitch {
  return {
    read(storage) {
      try {
        return storage.getItem(key) === 'on'
      } catch {
        // A browser that keeps nothing: off, and asked again next time.
        return false
      }
    },
    write(storage, enabled) {
      try {
        if (enabled) storage.setItem(key, 'on')
        else storage.removeItem(key)
      } catch {
        // Not kept: it still holds for this page.
      }
    },
  }
}
