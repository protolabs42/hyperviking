import Hyperswarm from 'hyperswarm'
import type { Duplex } from 'node:stream'
import { watch, type FSWatcher } from 'node:fs'
import b4a from 'b4a'
import { Decoder, response, error as rpcError } from './protocol.js'
import { getOrCreateKeypair, loadAllowlist } from './keys.js'
import { loadRoleList, saveRoleList, getMember, addMember, removeMember, updateRole, listMembers, isAllowed } from './roles.js'
import { AuditLog } from './audit.js'
import { RateLimiter } from './ratelimit.js'
import type { Role, RoleList, Member } from './roles.js'
import type { AuditEntry } from './audit.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HV_DIR = join(homedir(), '.hyperviking')
const ALLOWLIST_PATH = join(HV_DIR, 'allowlist.json')
const MEMBERS_PATH = join(HV_DIR, 'members.json')
const AUDIT_PATH = join(HV_DIR, 'audit.jsonl')

// ── Options ──

export interface RolesConfig {
  path?: string
  auditPath?: string
  rateLimits?: Partial<Record<Role, number>>
  rateWindowMs?: number
}

export interface ServerOptions {
  name?: string
  openVikingUrl?: string
  allowlistPath?: string
  /** Enable RBAC mode. When provided, replaces the simple allowlist with role-based access control. */
  roles?: RolesConfig
  onConnection?: (conn: Duplex, info: { publicKey: Buffer; member?: Member | null }) => void
  onError?: (err: Error) => void
}

export interface HyperVikingServer {
  swarm: Hyperswarm
  publicKey: Buffer
  publicKeyHex: string
  connections: Set<Duplex>
  /** Present in RBAC mode */
  roleList?: RoleList
  /** Present in RBAC mode */
  audit?: AuditLog
  /** Reload role list from disk (RBAC mode only) */
  reloadRoleList?: () => void
  close: () => Promise<void>
}

interface RpcRequest {
  id: number
  method: string
  params: Record<string, unknown>
}

export async function createServer (opts: ServerOptions = {}): Promise<HyperVikingServer> {
  const {
    name = 'server',
    openVikingUrl = 'http://127.0.0.1:1933',
    allowlistPath = ALLOWLIST_PATH,
    roles: rolesConfig,
    onConnection,
    onError
  } = opts

  const keyPair = getOrCreateKeypair(name)
  const useRbac = !!rolesConfig

  // ── Access control setup ──
  let roleList: RoleList | undefined
  let audit: AuditLog | undefined
  let limiter: RateLimiter | undefined
  let allowlist: Set<string> | null = null
  let fileWatcher: FSWatcher | null = null
  let reloadDebounce: ReturnType<typeof setTimeout> | null = null
  let cleanupInterval: ReturnType<typeof setInterval> | undefined

  const roleListPath = rolesConfig?.path ?? MEMBERS_PATH
  const auditLogPath = rolesConfig?.auditPath ?? AUDIT_PATH

  // Track active connections + in-flight requests per peer for revocation
  const peerAbortControllers = new Map<string, Set<AbortController>>()
  const peerConnections = new Map<string, Duplex>()

  if (useRbac) {
    roleList = loadRoleList(roleListPath)
    audit = new AuditLog(auditLogPath)
    limiter = new RateLimiter(rolesConfig?.rateLimits, rolesConfig?.rateWindowMs)

    // Watch members.json for hot-reload
    try {
      fileWatcher = watch(roleListPath, () => {
        if (reloadDebounce) clearTimeout(reloadDebounce)
        reloadDebounce = setTimeout(() => {
          try {
            const updated = loadRoleList(roleListPath)
            const oldMembers = new Set(Object.keys(roleList!.members))
            roleList = updated
            const newMembers = new Set(Object.keys(roleList!.members))

            // Evict removed members: abort in-flight requests + destroy connections
            for (const key of oldMembers) {
              if (!newMembers.has(key)) {
                const controllers = peerAbortControllers.get(key)
                if (controllers) {
                  for (const ac of controllers) ac.abort()
                  peerAbortControllers.delete(key)
                }
                const conn = peerConnections.get(key)
                if (conn) {
                  console.log(`[hyperviking] evicting revoked peer: ${key.slice(0, 12)}...`)
                  conn.destroy()
                  peerConnections.delete(key)
                }
              }
            }

            if (oldMembers.size !== newMembers.size) {
              console.log(`[hyperviking] role-list reloaded: ${newMembers.size} members (was ${oldMembers.size})`)
            }
          } catch (err) {
            console.error(`[hyperviking] failed to reload role-list:`, (err as Error).message)
          }
        }, 500)
      })
    } catch {
      // file watching not available
    }

    cleanupInterval = setInterval(() => limiter!.cleanup(), 60_000)
  } else {
    allowlist = loadAllowlist(allowlistPath)
  }

  // ── Swarm ──

  const swarm = new Hyperswarm({
    keyPair,
    firewall: (remotePublicKey: Buffer) => {
      const hex = b4a.toString(remotePublicKey, 'hex')
      if (useRbac) {
        return !roleList!.members[hex] // reject if not a member
      }
      if (!allowlist) return false // no allowlist = allow all
      return !allowlist.has(hex)   // reject if not in allowlist
    }
  })

  const connections = new Set<Duplex>()

  swarm.on('connection', (conn: Duplex, info: { publicKey: Buffer }) => {
    const remoteKey = b4a.toString(info.publicKey, 'hex')
    const member = useRbac ? getMember(roleList!, remoteKey) : null
    const peerName = member?.name ?? remoteKey.slice(0, 12)

    console.log(`[hyperviking] peer connected: ${peerName} (${remoteKey.slice(0, 12)}...)${member ? ` role=${member.role}` : ''}`)
    connections.add(conn)
    if (useRbac) {
      peerConnections.set(remoteKey, conn)
      peerAbortControllers.set(remoteKey, new Set())
    }

    const decoder = new Decoder()

    conn.on('data', async (chunk: Buffer) => {
      // Decode with protocol-level error handling — destroy socket on bad frames
      try {
        decoder.push(chunk)
      } catch (err) {
        console.error(`[hyperviking] protocol error from ${peerName}: ${(err as Error).message}`)
        conn.destroy()
        return
      }

      for (const msg of decoder.drain()) {
        const req = msg as RpcRequest

        // Sanitize method for logging (prevent audit disk fill)
        const safeMethod = typeof req.method === 'string' ? req.method.slice(0, 256) : 'invalid'

        // ── RBAC mode: full middleware stack ──
        if (useRbac) {
          // Re-resolve member from current roleList on every request (not cached from connect time)
          const currentMember = getMember(roleList!, remoteKey)

          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            peer: remoteKey.slice(0, 12),
            peerName: currentMember?.name ?? 'unknown',
            role: currentMember?.role ?? 'none',
            method: safeMethod,
            status: 'allowed'
          }

          try {
            if (!currentMember) {
              entry.status = 'denied'
              entry.error = 'not a member'
              audit!.log(entry)
              // Flush-safe eviction: end() sends the frame then closes cleanly
              const errBuf = rpcError(req.id, -32001, 'Access denied: not a member')
              conn.end(errBuf)
              return
            }

            if (!limiter!.check(remoteKey, currentMember.role)) {
              entry.status = 'rate-limited'
              audit!.log(entry)
              conn.write(rpcError(req.id, -32002, 'Rate limit exceeded'))
              continue
            }

            if (!isAllowed(currentMember.role, req.method)) {
              entry.status = 'denied'
              entry.error = `role '${currentMember.role}' cannot call '${safeMethod}'`
              audit!.log(entry)
              conn.write(rpcError(req.id, -32003, `Permission denied: ${currentMember.role} cannot call ${safeMethod}`))
              continue
            }

            // Handle member management methods
            if (req.method.startsWith('hv.')) {
              const result = handleHvMethod(req, remoteKey, currentMember, roleList!, roleListPath, audit!)
              audit!.log(entry)
              conn.write(response(req.id, result))
              continue
            }

            // Strip privileged params for readers
            if (currentMember.role === 'reader') {
              if (req.method === 'ov.session.get') {
                delete req.params.auto_create // readers cannot create sessions via get
              }
            }

            // Proxy to OpenViking with per-peer abort tracking
            const ac = new AbortController()
            const peerAcs = peerAbortControllers.get(remoteKey)
            if (peerAcs) peerAcs.add(ac)

            let result: unknown
            try {
              result = await proxyToOpenViking(req, openVikingUrl, ac.signal)
            } finally {
              if (peerAcs) peerAcs.delete(ac)
            }

            // Re-check membership after await — closes TOCTOU revocation window
            if (!getMember(roleList!, remoteKey)) {
              entry.status = 'denied'
              entry.error = 'revoked during request'
              audit!.log(entry)
              conn.end(rpcError(req.id, -32001, 'Access revoked'))
              return
            }

            audit!.log(entry)
            conn.write(response(req.id, result))
          } catch (err) {
            entry.status = 'error'
            entry.error = (err as Error).message.slice(0, 512)
            audit!.log(entry)
            console.error(`[hyperviking] request error:`, (err as Error).message)
            conn.write(rpcError(req.id, -32000, 'Internal server error'))
          }
        } else {
          // ── Simple mode: direct proxy ──
          try {
            const result = await proxyToOpenViking(req, openVikingUrl)
            conn.write(response(req.id, result))
          } catch (err) {
            console.error(`[hyperviking] request error:`, (err as Error).message)
            conn.write(rpcError(req.id, -32000, 'Internal server error'))
          }
        }
      }
    })

    conn.on('close', () => {
      console.log(`[hyperviking] peer disconnected: ${peerName} (${remoteKey.slice(0, 12)}...)`)
      connections.delete(conn)
      peerConnections.delete(remoteKey)
      // Abort any in-flight requests for this peer
      const acs = peerAbortControllers.get(remoteKey)
      if (acs) {
        for (const ac of acs) ac.abort()
        peerAbortControllers.delete(remoteKey)
      }
    })

    conn.on('error', (err: Error) => {
      console.error(`[hyperviking] connection error:`, err.message)
      connections.delete(conn)
      peerConnections.delete(remoteKey)
      // Abort in-flight requests on error (same as close handler)
      const acs = peerAbortControllers.get(remoteKey)
      if (acs) {
        for (const ac of acs) ac.abort()
        peerAbortControllers.delete(remoteKey)
      }
      if (onError) onError(err)
    })

    if (onConnection) onConnection(conn, { publicKey: info.publicKey, member })
  })

  // Join a topic derived from the server's public key so clients can find us
  const topic = b4a.allocUnsafe(32) as Buffer
  b4a.copy(keyPair.publicKey, topic, 0, 0, 32)

  const discovery = swarm.join(topic, { server: true, client: false })
  await discovery.flushed()

  const pubKeyHex = b4a.toString(keyPair.publicKey, 'hex')
  console.log(`[hyperviking] server listening`)
  console.log(`[hyperviking] public key: ${pubKeyHex}`)
  console.log(`[hyperviking] proxying to: ${openVikingUrl}`)
  if (useRbac) {
    console.log(`[hyperviking] mode: RBAC (${Object.keys(roleList!.members).length} members)`)
  } else if (allowlist) {
    console.log(`[hyperviking] mode: allowlist (${allowlist.size} keys)`)
  } else {
    console.log(`[hyperviking] mode: open (all peers accepted)`)
  }

  return {
    swarm,
    publicKey: keyPair.publicKey,
    publicKeyHex: pubKeyHex,
    connections,
    ...(useRbac ? {
      roleList,
      audit,
      reloadRoleList () {
        roleList = loadRoleList(roleListPath)
      }
    } : {}),
    async close () {
      if (cleanupInterval) clearInterval(cleanupInterval)
      if (reloadDebounce) clearTimeout(reloadDebounce)
      if (fileWatcher) fileWatcher.close()
      for (const conn of connections) conn.destroy()
      await swarm.destroy()
    }
  }
}

// ── Member management RPC methods (RBAC mode) ──

function handleHvMethod (
  req: RpcRequest,
  callerKey: string,
  caller: Member,
  roleList: RoleList,
  roleListPath: string,
  audit: AuditLog
): unknown {
  switch (req.method) {
    case 'hv.whoami':
      return {
        pubkey: callerKey,
        name: caller.name,
        role: caller.role,
        eth: caller.eth
      }

    case 'hv.members':
      return { members: listMembers(roleList) }

    case 'hv.add-member': {
      const { pubkey, role, name, eth } = req.params as {
        pubkey: string; role: Role; name: string; eth?: string
      }
      if (!pubkey || !role || !name) {
        throw new Error('Missing required params: pubkey, role, name')
      }
      if (!['reader', 'contributor', 'admin'].includes(role)) {
        throw new Error('Invalid role. Must be: reader, contributor, or admin')
      }
      addMember(roleList, pubkey, {
        role,
        name,
        eth,
        addedAt: new Date().toISOString(),
        addedBy: callerKey.slice(0, 12)
      })
      saveRoleList(roleListPath, roleList)
      return { ok: true, member: getMember(roleList, pubkey) }
    }

    case 'hv.remove-member': {
      const { pubkey } = req.params as { pubkey: string }
      if (!pubkey) throw new Error('Missing required param: pubkey')
      if (pubkey === callerKey) throw new Error('Cannot remove yourself')
      const removed = removeMember(roleList, pubkey)
      if (!removed) throw new Error('Member not found')
      saveRoleList(roleListPath, roleList)
      return { ok: true }
    }

    case 'hv.update-role': {
      const { pubkey, role } = req.params as { pubkey: string; role: Role }
      if (!pubkey || !role) throw new Error('Missing required params: pubkey, role')
      if (!['reader', 'contributor', 'admin'].includes(role)) {
        throw new Error('Invalid role. Must be: reader, contributor, or admin')
      }
      const updated = updateRole(roleList, pubkey, role)
      if (!updated) throw new Error('Member not found')
      saveRoleList(roleListPath, roleList)
      return { ok: true, member: getMember(roleList, pubkey) }
    }

    case 'hv.audit': {
      const count = (req.params.count as number) || 100
      return { entries: audit.tail(count) }
    }

    default:
      throw new Error(`Unknown method: ${req.method}`)
  }
}

// ── OpenViking proxy ──

function validatePathParam (value: unknown, name: string): string {
  const s = String(value ?? '')
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) {
    throw new Error(`Invalid ${name}: must be alphanumeric, dash, dot, or underscore`)
  }
  return s
}

async function proxyToOpenViking (req: RpcRequest, baseUrl: string, signal?: AbortSignal): Promise<unknown> {
  const { method, params } = req

  function qs (obj: Record<string, unknown>): string {
    const entries = Object.entries(obj).filter(([, v]) => v != null)
    return entries.length ? '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString() : ''
  }

  // Signal-aware fetch: abort in-flight requests when peer is revoked
  const f = (input: string | URL, init?: RequestInit) =>
    fetch(input, signal ? { ...init, signal } : init)

  const routes: Record<string, () => Promise<Response>> = {
    'ov.health': () => f(`${baseUrl}/health`),
    'ov.ls': () => f(`${baseUrl}/api/v1/fs/ls${qs({ uri: (params.uri as string) || 'viking://', limit: (params.limit as number) || 256 })}`),
    'ov.find': () => f(`${baseUrl}/api/v1/search/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: params.query, uri: params.uri, limit: (params.limit as number) || 10, include_provenance: params.include_provenance })
    }),
    'ov.read': () => f(`${baseUrl}/api/v1/content/read${qs({ uri: params.uri })}`),
    'ov.overview': () => f(`${baseUrl}/api/v1/content/overview${qs({ uri: params.uri })}`),
    'ov.status': () => f(`${baseUrl}/api/v1/system/status`),
    'ov.add-resource': () => f(`${baseUrl}/api/v1/resources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: params.path, target: params.target })
    }),
    'ov.grep': () => f(`${baseUrl}/api/v1/search/grep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: params.pattern, uri: params.uri, limit: params.limit })
    }),
    'ov.glob': () => f(`${baseUrl}/api/v1/search/glob`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: params.pattern, uri: params.uri, limit: params.limit })
    }),
    'ov.abstract': () => f(`${baseUrl}/api/v1/content/abstract${qs({ uri: params.uri })}`),
    'ov.write': () => f(`${baseUrl}/api/v1/content/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uri: params.uri, content: params.content, mode: params.mode ?? 'replace', wait: params.wait ?? false, timeout: params.timeout })
    }),
    'ov.tree': () => f(`${baseUrl}/api/v1/fs/tree${qs({ uri: params.uri })}`),
    'ov.observer.queue': () => f(`${baseUrl}/api/v1/observer/queue`),
    'ov.observer.system': () => f(`${baseUrl}/api/v1/observer/system`),
    'ov.observer.vikingdb': () => f(`${baseUrl}/api/v1/observer/vikingdb`),
    'ov.stats.memories': () => f(`${baseUrl}/api/v1/stats/memories${qs({ category: params.category })}`),
    'ov.session.stats': () => f(`${baseUrl}/api/v1/stats/sessions/${validatePathParam(params.session_id, 'session_id')}`),
    'ov.delete': () => f(`${baseUrl}/api/v1/fs${qs({ uri: params.uri, recursive: params.recursive })}`, { method: 'DELETE' }),

    // Skills
    'ov.add-skill': () => f(`${baseUrl}/api/v1/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: params.data, wait: params.wait ?? true })
    }),
    'ov.list-skills': () => f(`${baseUrl}/api/v1/fs/ls${qs({ uri: 'viking://agent/skills/', limit: (params.limit as number) || 256 })}`),
    'ov.read-skill': () => f(`${baseUrl}/api/v1/content/read${qs({ uri: params.uri })}`),

    // Sessions
    'ov.session.create': () => f(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: params.session_id })
    }),
    'ov.session.message': () => f(`${baseUrl}/api/v1/sessions/${validatePathParam(params.session_id, 'session_id')}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: params.role, content: params.content, parts: params.parts })
    }),
    'ov.session.commit': () => f(`${baseUrl}/api/v1/sessions/${validatePathParam(params.session_id, 'session_id')}/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extract_skills: params.extract_skills, extract_memories: params.extract_memories })
    }),
    'ov.session.used': () => f(`${baseUrl}/api/v1/sessions/${validatePathParam(params.session_id, 'session_id')}/used`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contexts: params.contexts, skill: params.skill })
    }),
    'ov.task.status': () => f(`${baseUrl}/api/v1/tasks/${validatePathParam(params.task_id, 'task_id')}`),
    'ov.session.get': () => f(`${baseUrl}/api/v1/sessions/${validatePathParam(params.session_id, 'session_id')}${qs({ auto_create: params.auto_create })}`),
    'ov.session.list': () => f(`${baseUrl}/api/v1/sessions${qs({ limit: params.limit })}`)
  }

  const handler = routes[method]
  if (!handler) throw new Error(`Unknown method: ${method}`)

  const MAX_RESPONSE_SIZE = 8 * 1024 * 1024 // 8 MB

  // Check abort signal before starting the fetch
  if (signal?.aborted) throw new Error('Request aborted: access revoked')

  const res = await handler()
  if (!res.ok) {
    const errChunks: Uint8Array[] = []
    let errLen = 0
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      errLen += chunk.byteLength
      if (errLen <= 1024) errChunks.push(chunk)
      else break
    }
    const errText = Buffer.concat(errChunks).toString('utf8')
    throw new Error(`OpenViking ${res.status}: ${errText}`)
  }

  // Stream-read with incremental size enforcement — never buffer more than MAX_RESPONSE_SIZE
  const chunks: Uint8Array[] = []
  let totalLen = 0
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    totalLen += chunk.byteLength
    if (totalLen > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large: >${MAX_RESPONSE_SIZE} bytes`)
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
}
