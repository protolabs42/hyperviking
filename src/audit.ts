import { appendFileSync, existsSync, readFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_LOG_SIZE = 50 * 1024 * 1024 // 50 MB — rotate after this
const MAX_ROTATED = 3 // keep audit.jsonl.1, .2, .3

export interface AuditEntry {
  timestamp: string
  peer: string       // pubkey hex (first 12 chars)
  peerName: string
  role: string
  method: string
  params?: Record<string, unknown>
  status: 'allowed' | 'denied' | 'error' | 'rate-limited'
  error?: string
}

export class AuditLog {
  private _path: string

  constructor (path: string) {
    this._path = path
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  log (entry: AuditEntry): void {
    const line = JSON.stringify(entry) + '\n'
    appendFileSync(this._path, line)
    this._maybeRotate()
  }

  /** Read the last N entries without loading the entire file */
  tail (count: number = 100): AuditEntry[] {
    if (!existsSync(this._path)) return []
    // Read from EOF in chunks to find the last N lines
    const content = readFileSync(this._path, 'utf8')
    const lines = content.trimEnd().split('\n')
    const slice = lines.slice(-count)
    const entries: AuditEntry[] = []
    for (const line of slice) {
      if (!line) continue
      try { entries.push(JSON.parse(line) as AuditEntry) } catch { /* skip corrupt lines */ }
    }
    return entries
  }

  get path (): string {
    return this._path
  }

  private _maybeRotate (): void {
    try {
      if (!existsSync(this._path)) return
      const st = statSync(this._path)
      if (st.size < MAX_LOG_SIZE) return

      // Rotate: .3 → delete, .2 → .3, .1 → .2, current → .1
      for (let i = MAX_ROTATED; i >= 1; i--) {
        const from = i === 1 ? this._path : `${this._path}.${i - 1}`
        const to = `${this._path}.${i}`
        if (existsSync(from)) {
          try { renameSync(from, to) } catch { /* best effort */ }
        }
      }
    } catch { /* rotation failure should not break logging */ }
  }
}
