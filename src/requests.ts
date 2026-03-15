import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type RequestStatus = 'pending' | 'approved' | 'denied'

export interface JoinRequest {
  name: string
  message: string
  pubkey: string
  eth: string
  requestedAt: string
  status: RequestStatus
  decidedAt?: string
  decidedBy?: string
  deniedCooldownUntil?: string
}

export interface RequestStore {
  requests: Record<string, JoinRequest> // keyed by lowercase ETH address
}

const DENIED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function loadRequests (path: string): RequestStore {
  if (!existsSync(path)) return { requests: {} }
  return JSON.parse(readFileSync(path, 'utf8')) as RequestStore
}

export function saveRequests (path: string, store: RequestStore): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2))
}

export function getRequest (store: RequestStore, eth: string): JoinRequest | null {
  return store.requests[eth.toLowerCase()] ?? null
}

export function submitRequest (
  store: RequestStore,
  eth: string,
  data: { name: string; message: string; pubkey: string }
): { ok: boolean; error?: string } {
  const key = eth.toLowerCase()
  const existing = store.requests[key]

  if (existing?.status === 'pending') {
    return { ok: false, error: 'You already have a pending request' }
  }

  if (existing?.status === 'approved') {
    return { ok: false, error: 'You are already approved' }
  }

  if (existing?.status === 'denied' && existing.deniedCooldownUntil) {
    if (new Date(existing.deniedCooldownUntil).getTime() > Date.now()) {
      return { ok: false, error: 'Request denied. You can reapply after the cooldown period.' }
    }
  }

  store.requests[key] = {
    name: data.name,
    message: data.message,
    pubkey: data.pubkey,
    eth,
    requestedAt: new Date().toISOString(),
    status: 'pending'
  }

  return { ok: true }
}

export function approveRequest (store: RequestStore, eth: string, decidedBy: string): JoinRequest | null {
  const key = eth.toLowerCase()
  const req = store.requests[key]
  if (!req || req.status !== 'pending') return null
  req.status = 'approved'
  req.decidedAt = new Date().toISOString()
  req.decidedBy = decidedBy
  return req
}

export function denyRequest (store: RequestStore, eth: string, decidedBy: string): JoinRequest | null {
  const key = eth.toLowerCase()
  const req = store.requests[key]
  if (!req || req.status !== 'pending') return null
  req.status = 'denied'
  req.decidedAt = new Date().toISOString()
  req.decidedBy = decidedBy
  req.deniedCooldownUntil = new Date(Date.now() + DENIED_COOLDOWN_MS).toISOString()
  return req
}

export function listPendingRequests (store: RequestStore): JoinRequest[] {
  return Object.values(store.requests).filter(r => r.status === 'pending')
}

export function listAllRequests (store: RequestStore): JoinRequest[] {
  return Object.values(store.requests)
}
