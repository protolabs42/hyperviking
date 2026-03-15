import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

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
  }

  tail (count: number = 100): AuditEntry[] {
    if (!existsSync(this._path)) return []
    const content = readFileSync(this._path, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    return lines.slice(-count).map(l => JSON.parse(l) as AuditEntry)
  }

  get path (): string {
    return this._path
  }
}
