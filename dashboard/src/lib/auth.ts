import { randomBytes, createHmac } from 'node:crypto'
import { cookies } from 'next/headers'
import type { SessionPayload } from './schemas'

const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex')
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000

// Nonce store (in-memory)
const nonces = new Map<string, number>()
const NONCE_EXPIRY_MS = 5 * 60 * 1000

export function createNonce (): string {
  const now = Date.now()
  for (const [n, t] of nonces) { if (now - t > NONCE_EXPIRY_MS) nonces.delete(n) }
  const nonce = randomBytes(16).toString('hex')
  nonces.set(nonce, now)
  return nonce
}

export function consumeNonce (nonce: string): boolean {
  if (!nonces.has(nonce)) return false
  nonces.delete(nonce)
  return true
}

export function createToken (payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyToken (token: string): SessionPayload | null {
  const [data, sig] = token.split('.')
  if (!data || !sig) return null
  const expected = createHmac('sha256', SESSION_SECRET).update(data).digest('base64url')
  if (sig !== expected) return null
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as SessionPayload
    if (Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function makeSessionPayload (eth: string, status: SessionPayload['status'], role?: SessionPayload['role'], name?: string): SessionPayload {
  return { eth, status, role, name, exp: Date.now() + SESSION_EXPIRY_MS }
}

export async function getSession (): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('hv-session')?.value
  if (!token) return null
  return verifyToken(token)
}
