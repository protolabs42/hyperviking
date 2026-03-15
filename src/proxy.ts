#!/usr/bin/env node
/**
 * Local HTTP proxy for HyperViking.
 * Listens on localhost and proxies all OpenViking API calls through
 * encrypted P2P to a remote HyperViking server.
 *
 * Usage: node proxy.js <server-pubkey> [--port 1934]
 *
 * Then point ov CLI at: http://localhost:1934
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createClient, type HyperVikingClient } from './client.js'

const args = process.argv.slice(2)
const serverKey = args.find(a => !a.startsWith('--'))
const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1] || '1934')

if (!serverKey) {
  console.error('Usage: node proxy.js <server-public-key> [--port=1934]')
  process.exit(1)
}

console.log(`[hv-proxy] connecting to server ${serverKey.slice(0, 12)}...`)
const client = await createClient({ serverPublicKey: serverKey })
console.log(`[hv-proxy] P2P connected`)

// Map OpenViking HTTP API paths to HyperViking RPC methods
function routeRequest (
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  rpc: HyperVikingClient
): Promise<unknown> {
  const u = new URL(url, 'http://localhost')
  const p = u.pathname

  // Health
  if (p === '/health') return rpc.call('ov.health')

  // FS
  if (p === '/api/v1/fs/ls') {
    return rpc.call('ov.ls', {
      uri: u.searchParams.get('uri') || 'viking://',
      limit: parseInt(u.searchParams.get('limit') || '256')
    })
  }

  // Search
  if (p === '/api/v1/search/find' && method === 'POST') {
    return rpc.call('ov.find', body as Record<string, unknown>)
  }

  // Content
  if (p === '/api/v1/content/read') {
    return rpc.call('ov.read', { uri: u.searchParams.get('uri') })
  }
  if (p === '/api/v1/content/overview') {
    return rpc.call('ov.overview', { uri: u.searchParams.get('uri') })
  }

  // System
  if (p === '/api/v1/system/status') return rpc.call('ov.status')

  // Resources
  if (p === '/api/v1/resources' && method === 'POST') {
    return rpc.call('ov.add-resource', {
      path: body?.path || body?.source_path,
      target: body?.target_uri || body?.target
    })
  }

  // Grep
  if (p === '/api/v1/search/grep' && method === 'POST') {
    return rpc.call('ov.grep', body as Record<string, unknown>)
  }

  // Abstract
  if (p === '/api/v1/content/abstract') {
    return rpc.call('ov.abstract', { uri: u.searchParams.get('uri') })
  }

  // Glob
  if (p === '/api/v1/search/glob' && method === 'POST') {
    return rpc.call('ov.glob', body as Record<string, unknown>)
  }

  // Tree
  if (p === '/api/v1/fs/tree') {
    return rpc.call('ov.tree', { uri: u.searchParams.get('uri') })
  }

  // Observer
  if (p === '/api/v1/observer/queue') return rpc.call('ov.observer.queue')
  if (p === '/api/v1/observer/system') return rpc.call('ov.observer.system')
  if (p === '/api/v1/observer/vikingdb') return rpc.call('ov.observer.vikingdb')

  // Delete
  if (p === '/api/v1/fs' && method === 'DELETE') {
    return rpc.call('ov.delete', {
      uri: u.searchParams.get('uri'),
      recursive: u.searchParams.get('recursive') === 'true'
    })
  }

  throw new Error(`Unknown route: ${method} ${p}`)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    let body: Record<string, unknown> | null = null
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>
    }

    const result = await routeRequest(req.method!, req.url!, body, client)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: (err as Error).message }))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[hv-proxy] listening on http://127.0.0.1:${port}`)
  console.log(`[hv-proxy] configure ov CLI: echo '{"url":"http://localhost:${port}"}' > ~/.openviking/ovcli.conf`)
})

process.on('SIGINT', async () => {
  console.log('\n[hv-proxy] shutting down...')
  server.close()
  await client.close()
  process.exit(0)
})
