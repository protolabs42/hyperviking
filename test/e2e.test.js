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
