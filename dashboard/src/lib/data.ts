import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RoleList, Member, JoinRequest, AuditEntry, Role } from './schemas'

const HV_DIR = process.env.HV_DATA_DIR || join(process.env.HOME || '/root', '.hyperviking')
const ROLE_LIST_PATH = join(HV_DIR, 'members.json')
const REQUESTS_PATH = join(HV_DIR, 'requests.json')
const AUDIT_LOG_PATH = join(HV_DIR, 'audit.jsonl')
const OV_URL = process.env.OPENVIKING_URL || 'http://127.0.0.1:1933'

function ensureDir (path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ── Members ──

export function loadRoleList (): RoleList {
  if (!existsSync(ROLE_LIST_PATH)) return { members: {}, updatedAt: new Date().toISOString() }
  return JSON.parse(readFileSync(ROLE_LIST_PATH, 'utf8'))
}

export function saveRoleList (rl: RoleList) {
  ensureDir(ROLE_LIST_PATH)
  rl.updatedAt = new Date().toISOString()
  writeFileSync(ROLE_LIST_PATH, JSON.stringify(rl, null, 2))
}

export function listMembers (): Array<{ pubkey: string } & Member> {
  const rl = loadRoleList()
  return Object.entries(rl.members).map(([pubkey, m]) => ({ pubkey, ...m }))
}

export function findMemberByEth (eth: string): { pubkey: string, member: Member } | null {
  const rl = loadRoleList()
  const lower = eth.toLowerCase()
  for (const [pubkey, m] of Object.entries(rl.members)) {
    if (m.eth?.toLowerCase() === lower) return { pubkey, member: m }
  }
  return null
}

export function addMember (pubkey: string, member: Member) {
  const rl = loadRoleList()
  rl.members[pubkey] = member
  saveRoleList(rl)
}

export function removeMember (pubkey: string): boolean {
  const rl = loadRoleList()
  if (!(pubkey in rl.members)) return false
  delete rl.members[pubkey]
  saveRoleList(rl)
  return true
}

export function updateRole (pubkey: string, role: Role): boolean {
  const rl = loadRoleList()
  const m = rl.members[pubkey]
  if (!m) return false
  m.role = role
  saveRoleList(rl)
  return true
}

// ── Requests ──

interface RequestStore { requests: Record<string, JoinRequest> }
const DENIED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

function loadRequests (): RequestStore {
  if (!existsSync(REQUESTS_PATH)) return { requests: {} }
  return JSON.parse(readFileSync(REQUESTS_PATH, 'utf8'))
}

function saveRequests (store: RequestStore) {
  ensureDir(REQUESTS_PATH)
  writeFileSync(REQUESTS_PATH, JSON.stringify(store, null, 2))
}

export function getRequestByEth (eth: string): JoinRequest | null {
  return loadRequests().requests[eth.toLowerCase()] ?? null
}

export function listAllRequests (): JoinRequest[] {
  return Object.values(loadRequests().requests)
}

export function submitRequest (eth: string, data: { name: string; message: string; pubkey: string }): { ok: boolean; error?: string } {
  const store = loadRequests()
  const key = eth.toLowerCase()
  const existing = store.requests[key]

  if (existing?.status === 'pending') return { ok: false, error: 'You already have a pending request' }
  if (existing?.status === 'approved') return { ok: false, error: 'You are already approved' }
  if (existing?.status === 'denied' && existing.deniedCooldownUntil) {
    if (new Date(existing.deniedCooldownUntil).getTime() > Date.now()) {
      return { ok: false, error: 'Request denied. You can reapply after the cooldown period.' }
    }
  }

  store.requests[key] = { ...data, eth, requestedAt: new Date().toISOString(), status: 'pending' }
  saveRequests(store)
  return { ok: true }
}

export function approveRequest (eth: string, decidedBy: string): JoinRequest | null {
  const store = loadRequests()
  const key = eth.toLowerCase()
  const req = store.requests[key]
  if (!req || req.status !== 'pending') return null
  req.status = 'approved'
  req.decidedAt = new Date().toISOString()
  req.decidedBy = decidedBy
  saveRequests(store)
  return req
}

export function denyRequest (eth: string, decidedBy: string): JoinRequest | null {
  const store = loadRequests()
  const key = eth.toLowerCase()
  const req = store.requests[key]
  if (!req || req.status !== 'pending') return null
  req.status = 'denied'
  req.decidedAt = new Date().toISOString()
  req.decidedBy = decidedBy
  req.deniedCooldownUntil = new Date(Date.now() + DENIED_COOLDOWN_MS).toISOString()
  saveRequests(store)
  return req
}

// ── Audit ──

export function readAuditLog (count: number = 100): AuditEntry[] {
  if (!existsSync(AUDIT_LOG_PATH)) return []
  const content = readFileSync(AUDIT_LOG_PATH, 'utf8')
  const lines = content.trim().split('\n').filter(Boolean)
  return lines.slice(-count).map(l => JSON.parse(l))
}

// ── OpenViking proxy ──

export async function ovFetch (path: string, init?: RequestInit) {
  const res = await fetch(`${OV_URL}${path}`, init)
  if (!res.ok) throw new Error(`OpenViking ${res.status}`)
  return res.json()
}

// ── User resolution ──

export function resolveUserStatus (eth: string): { status: 'admin' | 'member' | 'pending' | 'denied' | 'unknown'; role?: Role; name?: string } {
  const found = findMemberByEth(eth)
  if (found) {
    return { status: found.member.role === 'admin' ? 'admin' : 'member', role: found.member.role as Role, name: found.member.name }
  }
  const req = getRequestByEth(eth)
  if (req?.status === 'pending') return { status: 'pending', name: req.name }
  if (req?.status === 'denied') return { status: 'denied', name: req.name }
  return { status: 'unknown' }
}

// ── Server pubkey ──

export function getServerPubkey (): string {
  try {
    const keyPath = join(process.env.HOME || '/root', '.hyperviking', 'keys', 'server.json')
    const data = JSON.parse(readFileSync(keyPath, 'utf8'))
    return data.publicKey as string
  } catch {
    return 'not-configured'
  }
}
