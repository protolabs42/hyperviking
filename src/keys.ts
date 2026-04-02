import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import DHT from 'hyperdht'
import b4a from 'b4a'

export interface KeyPair {
  publicKey: Buffer
  secretKey: Buffer
}

export interface KeyInfo {
  name: string
  publicKey: string
  createdAt: string
}

interface StoredKey {
  name: string
  publicKey: string
  secretKey: string
  createdAt: string
}

interface AllowlistData {
  keys: string[]
  updatedAt: string
}

const KEYS_DIR = join(homedir(), '.hyperviking', 'keys')

export function ensureKeysDir (): void {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 })
}

export function generateKeypair (name: string): KeyPair {
  ensureKeysDir()
  const keyPair = DHT.keyPair()
  const data: StoredKey = {
    name,
    publicKey: b4a.toString(keyPair.publicKey, 'hex'),
    secretKey: b4a.toString(keyPair.secretKey, 'hex'),
    createdAt: new Date().toISOString()
  }
  writeFileSync(join(KEYS_DIR, `${name}.json`), JSON.stringify(data, null, 2), { mode: 0o600 })
  return keyPair
}

export function loadKeypair (name: string): KeyPair | null {
  const path = join(KEYS_DIR, `${name}.json`)
  if (!existsSync(path)) return null
  const data = JSON.parse(readFileSync(path, 'utf8')) as StoredKey
  return {
    publicKey: b4a.from(data.publicKey, 'hex') as Buffer,
    secretKey: b4a.from(data.secretKey, 'hex') as Buffer
  }
}

export function getOrCreateKeypair (name: string): KeyPair {
  return loadKeypair(name) || generateKeypair(name)
}

export function listKeys (): KeyInfo[] {
  ensureKeysDir()
  return readdirSync(KEYS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const data = JSON.parse(readFileSync(join(KEYS_DIR, f), 'utf8')) as StoredKey
      return { name: data.name, publicKey: data.publicKey, createdAt: data.createdAt }
    })
}

export function loadAllowlist (path: string): Set<string> | null {
  if (!existsSync(path)) return null
  const data = JSON.parse(readFileSync(path, 'utf8')) as AllowlistData
  return new Set(data.keys || [])
}

export function saveAllowlist (path: string, keys: Set<string>): void {
  writeFileSync(path, JSON.stringify({ keys: [...keys], updatedAt: new Date().toISOString() }, null, 2))
}
