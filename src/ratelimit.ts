import type { Role } from './roles.js'

interface Window {
  timestamps: number[]
}

const DEFAULT_LIMITS: Record<Role, number> = {
  reader: 100,      // 100 requests per window
  contributor: 200,  // 200 requests per window
  admin: 0           // 0 = unlimited
}

const DEFAULT_WINDOW_MS = 60_000 // 1 minute

export class RateLimiter {
  private _windows: Map<string, Window> = new Map()
  private _limits: Record<Role, number>
  private _windowMs: number

  constructor (limits?: Partial<Record<Role, number>>, windowMs?: number) {
    this._limits = { ...DEFAULT_LIMITS, ...limits }
    this._windowMs = windowMs ?? DEFAULT_WINDOW_MS
  }

  /** Returns true if the request is allowed, false if rate-limited */
  check (pubkey: string, role: Role): boolean {
    const limit = this._limits[role]
    if (limit === 0) return true // unlimited

    const now = Date.now()
    const cutoff = now - this._windowMs

    let win = this._windows.get(pubkey)
    if (!win) {
      win = { timestamps: [] }
      this._windows.set(pubkey, win)
    }

    // Prune old timestamps
    win.timestamps = win.timestamps.filter(t => t > cutoff)

    if (win.timestamps.length >= limit) return false

    win.timestamps.push(now)
    return true
  }

  /** Cleanup stale windows (call periodically) */
  cleanup (): void {
    const cutoff = Date.now() - this._windowMs
    for (const [key, win] of this._windows) {
      win.timestamps = win.timestamps.filter(t => t > cutoff)
      if (win.timestamps.length === 0) this._windows.delete(key)
    }
  }
}
