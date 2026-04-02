import { describe, it, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../dist/server.js'
import { createClient } from '../dist/client.js'
import { generateKeypair, saveAllowlist } from '../dist/keys.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync, mkdirSync } from 'node:fs'
import b4a from 'b4a'

const OV_URL = 'http://127.0.0.1:1933'

// Check if OpenViking is running before tests
async function ovHealthy () {
  try {
    const res = await fetch(`${OV_URL}/health`)
    return res.ok
  } catch { return false }
}

describe('HyperViking E2E', async () => {
  let server, client

  before(async () => {
    const healthy = await ovHealthy()
    if (!healthy) {
      console.log('  SKIP: OpenViking not running at', OV_URL)
      process.exit(0)
    }
  })

  after(async () => {
    if (client) await client.close()
    if (server) await server.close()
  })

  it('server starts and exposes public key', async () => {
    server = await createServer({
      name: 'test-server-' + Date.now(),
      openVikingUrl: OV_URL
    })
    assert.ok(server.publicKey)
    assert.equal(server.publicKeyHex.length, 64)
    console.log(`  server key: ${server.publicKeyHex.slice(0, 16)}...`)
  })

  it('client connects to server via public key', async () => {
    client = await createClient({
      name: 'test-client-' + Date.now(),
      serverPublicKey: server.publicKeyHex
    })
    assert.ok(client)
    console.log('  client connected')
  })

  it('health check through P2P tunnel', async () => {
    const health = await client.health()
    assert.ok(health.status === 'ok' || health.healthy === true)
    console.log('  health:', health.status)
  })

  it('ls root filesystem through P2P tunnel', async () => {
    const result = await client.ls('viking://')
    assert.ok(result)
    console.log('  ls result entries:', Array.isArray(result.entries) ? result.entries.length : 'ok')
  })

  it('semantic search through P2P tunnel', async () => {
    const result = await client.find('context layers L0 L1 L2')
    assert.ok(result)
    console.log('  find results:', JSON.stringify(result).slice(0, 100) + '...')
  })

  it('status through P2P tunnel', async () => {
    const result = await client.status()
    assert.ok(result)
    console.log('  status:', typeof result)
  })

  // ── v0.5.0 new endpoints ──

  it('find with include_provenance', async () => {
    const result = await client.call('ov.find', { query: 'test', limit: 3, include_provenance: true })
    assert.ok(result)
    console.log('  find+provenance:', JSON.stringify(result).slice(0, 120) + '...')
  })

  it('memory stats through P2P tunnel', async () => {
    const result = await client.call('ov.stats.memories')
    assert.ok(result)
    assert.ok('total_memories' in result || 'by_category' in result || typeof result === 'object')
    console.log('  memory stats:', JSON.stringify(result).slice(0, 120) + '...')
  })

  it('session create + message + used + commit (async) + task status', async () => {
    // Create session — OV wraps in { status, result: { session_id } }
    const session = await client.call('ov.session.create', {})
    const sid = session.result?.session_id || session.session_id || session.id
    assert.ok(sid)
    console.log('  session created:', sid)

    // Add a message
    const msg = await client.call('ov.session.message', {
      session_id: sid,
      role: 'user',
      content: 'HyperViking v0.5.0 e2e test message'
    })
    assert.ok(msg)
    console.log('  message added')

    // Record usage
    const used = await client.call('ov.session.used', {
      session_id: sid,
      contexts: [],
      skill: null
    })
    assert.ok(used)
    console.log('  usage recorded')

    // Async commit — should return accepted + task_id
    const commit = await client.call('ov.session.commit', { session_id: sid })
    assert.ok(commit)
    console.log('  commit result:', JSON.stringify(commit).slice(0, 150))

    // If we got a task_id, poll it
    if (commit.task_id) {
      const task = await client.call('ov.task.status', { task_id: commit.task_id })
      assert.ok(task)
      console.log('  task status:', JSON.stringify(task).slice(0, 120))
    }

    // Session stats
    const stats = await client.call('ov.session.stats', { session_id: sid })
    assert.ok(stats)
    console.log('  session stats:', JSON.stringify(stats).slice(0, 120))
  })

  it('session.get with auto_create', async () => {
    const result = await client.call('ov.session.get', {
      session_id: 'hv-e2e-autocreate-test',
      auto_create: true
    })
    assert.ok(result)
    console.log('  session.get auto_create:', JSON.stringify(result).slice(0, 100) + '...')
  })
})

describe('Firewall allowlist', async () => {
  let server, goodClient, rejectedClient

  after(async () => {
    if (goodClient) await goodClient.close().catch(() => {})
    if (rejectedClient) await rejectedClient.close().catch(() => {})
    if (server) await server.close()
  })

  it('rejects peers not on allowlist', async () => {
    const ts = Date.now()

    // Generate keypairs — use fixed names so createClient reloads the same key
    const goodName = `test-allowed-${ts}`
    const badName = `test-rejected-${ts}`
    const goodKp = generateKeypair(goodName)
    generateKeypair(badName)

    // Create allowlist with only the good key
    const tmpAllowlist = join(tmpdir(), `hv-allowlist-${ts}.json`)
    saveAllowlist(tmpAllowlist, [b4a.toString(goodKp.publicKey, 'hex')])

    server = await createServer({
      name: `test-fw-server-${ts}`,
      openVikingUrl: OV_URL,
      allowlistPath: tmpAllowlist
    })

    // Good client should connect (reuses the same named keypair)
    goodClient = await createClient({
      name: goodName,
      serverPublicKey: server.publicKeyHex
    })
    const health = await goodClient.health()
    assert.ok(health.status === 'ok' || health.healthy === true)
    console.log('  allowed client: connected and healthy')

    // Bad client should fail to connect (timeout)
    try {
      rejectedClient = await createClient({
        name: badName,
        serverPublicKey: server.publicKeyHex,
        connectTimeout: 8000
      })
      assert.fail('Should have been rejected')
    } catch (err) {
      assert.ok(err.message.includes('timeout') || err.message.includes('Connection'))
      console.log('  rejected client: correctly denied -', err.message)
    }
  })
})
