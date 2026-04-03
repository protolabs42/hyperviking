import Hyperswarm from 'hyperswarm'
import DHT from 'hyperdht'
import type { Duplex } from 'node:stream'
import b4a from 'b4a'
import { Decoder, request, type JsonRpcResponse } from './protocol.js'
import { getOrCreateKeypair } from './keys.js'

export interface ClientOptions {
  name?: string
  /** Use an ephemeral keypair (not saved to disk). Avoids key file pollution and same-key conflicts. */
  ephemeral?: boolean
  serverPublicKey: string | Buffer
  connectTimeout?: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface HyperVikingClient {
  swarm: Hyperswarm
  call: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>
  health: () => Promise<unknown>
  ls: (uri?: string) => Promise<unknown>
  find: (query: string, opts?: Record<string, unknown>) => Promise<unknown>
  read: (uri: string) => Promise<unknown>
  overview: (uri: string) => Promise<unknown>
  status: () => Promise<unknown>
  addResource: (path: string, targetUri?: string) => Promise<unknown>
  close: () => Promise<void>
}

export async function createClient (opts: ClientOptions): Promise<HyperVikingClient> {
  const {
    name = 'client',
    serverPublicKey
  } = opts

  if (!serverPublicKey) throw new Error('serverPublicKey is required')

  const serverKey = typeof serverPublicKey === 'string'
    ? b4a.from(serverPublicKey, 'hex') as Buffer
    : serverPublicKey as Buffer

  const keyPair = opts.ephemeral ? DHT.keyPair() : getOrCreateKeypair(name)
  // Disable local connection optimization to prevent duplicate connection races
  // when client and server run on the same machine
  const dht = new DHT({ keyPair, localConnection: false })
  const swarm = new Hyperswarm({ keyPair, dht })

  let conn: Duplex | null = null
  let decoder = new Decoder()
  const pending = new Map<number, PendingRequest>()

  const connected = new Promise<void>((resolve, reject) => {
    const timeoutMs = opts.connectTimeout || 30000
    const timeout = setTimeout(async () => {
      await swarm.destroy().catch(() => {})
      reject(new Error('Connection timeout'))
    }, timeoutMs)

    swarm.on('connection', (socket: Duplex) => {
      clearTimeout(timeout)
      conn = socket
      decoder = new Decoder()

      conn.on('data', (chunk: Buffer) => {
        try {
          decoder.push(chunk)
        } catch (err) {
          console.error('[hyperviking-client] protocol error:', (err as Error).message)
          conn!.destroy()
          return
        }
        for (const msg of decoder.drain()) {
          const res = msg as JsonRpcResponse
          const p = pending.get(res.id)
          if (!p) continue
          clearTimeout(p.timer)
          pending.delete(res.id)
          if (res.error) p.reject(new Error(res.error.message))
          else p.resolve(res.result)
        }
      })

      conn.on('close', () => {
        conn = null
        for (const [id, p] of pending) {
          clearTimeout(p.timer)
          p.reject(new Error('Connection closed'))
        }
        pending.clear()
      })

      conn.on('error', (err: Error) => {
        if (err.message === 'Duplicate connection') return
        console.error('[hyperviking-client] error:', err.message)
      })

      resolve()
    })
  })

  // Connect by joining the topic derived from server's public key
  const topic = b4a.allocUnsafe(32) as Buffer
  b4a.copy(serverKey, topic, 0, 0, 32)
  swarm.join(topic, { server: false, client: true })
  await swarm.flush()
  await connected

  async function call (method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<unknown> {
    if (!conn) throw new Error('Not connected')
    const buf = request(method, params)
    // Parse the id from the buffer we just encoded
    const idBuf = buf.subarray(4)
    const msg = JSON.parse(b4a.toString(idBuf, 'utf8')) as { id: number }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(msg.id)
        reject(new Error(`Request timeout: ${method}`))
      }, timeoutMs)
      pending.set(msg.id, { resolve, reject, timer })
      conn!.write(buf)
    })
  }

  return {
    swarm,
    call,
    health: () => call('ov.health'),
    ls: (uri = 'viking://') => call('ov.ls', { uri }),
    find: (query: string, opts: Record<string, unknown> = {}) => call('ov.find', { query, ...opts }),
    read: (uri: string) => call('ov.read', { uri }),
    overview: (uri: string) => call('ov.overview', { uri }),
    status: () => call('ov.status'),
    addResource: (path: string, targetUri?: string) => call('ov.add-resource', { path, targetUri }),
    async close () {
      for (const [, p] of pending) {
        clearTimeout(p.timer)
        p.reject(new Error('Client closing'))
      }
      pending.clear()
      if (conn) conn.destroy()
      await swarm.destroy()
    }
  }
}
