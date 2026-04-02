import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, existsSync, unlinkSync, rmSync } from 'node:fs'
import { loadRoleList, saveRoleList, addMember, removeMember, updateRole, getMember, listMembers, isAllowed } from '../dist/roles.js'
import { AuditLog } from '../dist/audit.js'
import { RateLimiter } from '../dist/ratelimit.js'
import { loadRequests, saveRequests, submitRequest, approveRequest, denyRequest, listPendingRequests, listAllRequests } from '../dist/requests.js'

const TMP = join(tmpdir(), `hv-rbac-test-${Date.now()}`)
mkdirSync(TMP, { recursive: true })

// ── Roles ──

describe('Roles module', () => {
  const membersPath = join(TMP, 'members.json')

  it('loadRoleList returns empty list when file missing', () => {
    const rl = loadRoleList(join(TMP, 'nonexistent.json'))
    assert.deepEqual(Object.keys(rl.members), [])
  })

  it('addMember + saveRoleList + loadRoleList roundtrip', () => {
    const rl = loadRoleList(membersPath)
    addMember(rl, 'aabbccdd', {
      role: 'admin',
      name: 'Alice',
      eth: '0x1234',
      addedAt: new Date().toISOString(),
      addedBy: 'test'
    })
    saveRoleList(membersPath, rl)

    const loaded = loadRoleList(membersPath)
    assert.equal(loaded.members['aabbccdd'].name, 'Alice')
    assert.equal(loaded.members['aabbccdd'].role, 'admin')
  })

  it('getMember returns member or null', () => {
    const rl = loadRoleList(membersPath)
    assert.equal(getMember(rl, 'aabbccdd')?.name, 'Alice')
    assert.equal(getMember(rl, 'nonexistent'), null)
  })

  it('updateRole changes role', () => {
    const rl = loadRoleList(membersPath)
    const ok = updateRole(rl, 'aabbccdd', 'reader')
    assert.equal(ok, true)
    assert.equal(rl.members['aabbccdd'].role, 'reader')
  })

  it('updateRole returns false for unknown member', () => {
    const rl = loadRoleList(membersPath)
    assert.equal(updateRole(rl, 'unknown', 'admin'), false)
  })

  it('removeMember removes and returns true', () => {
    const rl = loadRoleList(membersPath)
    addMember(rl, 'toremove', {
      role: 'reader',
      name: 'Bob',
      addedAt: new Date().toISOString(),
      addedBy: 'test'
    })
    assert.equal(removeMember(rl, 'toremove'), true)
    assert.equal(getMember(rl, 'toremove'), null)
  })

  it('removeMember returns false for unknown member', () => {
    const rl = loadRoleList(membersPath)
    assert.equal(removeMember(rl, 'ghost'), false)
  })

  it('listMembers returns array with pubkey', () => {
    const rl = loadRoleList(membersPath)
    const list = listMembers(rl)
    assert.ok(Array.isArray(list))
    assert.ok(list.some(m => m.pubkey === 'aabbccdd'))
  })
})

// ── Permissions ──

describe('Permission matrix', () => {
  it('reader can call read-only methods', () => {
    assert.equal(isAllowed('reader', 'ov.find'), true)
    assert.equal(isAllowed('reader', 'ov.ls'), true)
    assert.equal(isAllowed('reader', 'ov.read'), true)
    assert.equal(isAllowed('reader', 'hv.whoami'), true)
    assert.equal(isAllowed('reader', 'hv.members'), true)
  })

  it('reader can access aggregate stats and task polling', () => {
    assert.equal(isAllowed('reader', 'ov.stats.memories'), true)
    assert.equal(isAllowed('reader', 'ov.task.status'), true)
  })

  it('reader cannot access session metadata', () => {
    assert.equal(isAllowed('reader', 'ov.session.get'), false)
    assert.equal(isAllowed('reader', 'ov.session.list'), false)
    assert.equal(isAllowed('reader', 'ov.session.stats'), false)
  })

  it('reader cannot write or use session methods', () => {
    assert.equal(isAllowed('reader', 'ov.add-resource'), false)
    assert.equal(isAllowed('reader', 'ov.delete'), false)
    assert.equal(isAllowed('reader', 'hv.add-member'), false)
    assert.equal(isAllowed('reader', 'ov.write'), false)
    assert.equal(isAllowed('reader', 'ov.session.used'), false)
  })

  it('contributor can read and write resources', () => {
    assert.equal(isAllowed('contributor', 'ov.find'), true)
    assert.equal(isAllowed('contributor', 'ov.add-resource'), true)
    assert.equal(isAllowed('contributor', 'ov.add-skill'), true)
  })

  it('contributor can write content, record usage, and access sessions', () => {
    assert.equal(isAllowed('contributor', 'ov.write'), true)
    assert.equal(isAllowed('contributor', 'ov.session.used'), true)
    assert.equal(isAllowed('contributor', 'ov.session.get'), true)
    assert.equal(isAllowed('contributor', 'ov.session.list'), true)
    assert.equal(isAllowed('contributor', 'ov.session.stats'), true)
    assert.equal(isAllowed('contributor', 'ov.stats.memories'), true)
    assert.equal(isAllowed('contributor', 'ov.task.status'), true)
  })

  it('contributor cannot manage members', () => {
    assert.equal(isAllowed('contributor', 'hv.add-member'), false)
    assert.equal(isAllowed('contributor', 'ov.delete'), false)
    assert.equal(isAllowed('contributor', 'hv.audit'), false)
  })

  it('admin can do everything', () => {
    assert.equal(isAllowed('admin', 'ov.find'), true)
    assert.equal(isAllowed('admin', 'ov.add-resource'), true)
    assert.equal(isAllowed('admin', 'ov.delete'), true)
    assert.equal(isAllowed('admin', 'hv.add-member'), true)
    assert.equal(isAllowed('admin', 'hv.remove-member'), true)
    assert.equal(isAllowed('admin', 'hv.update-role'), true)
    assert.equal(isAllowed('admin', 'hv.audit'), true)
    assert.equal(isAllowed('admin', 'ov.write'), true)
    assert.equal(isAllowed('admin', 'ov.session.used'), true)
    assert.equal(isAllowed('admin', 'ov.stats.memories'), true)
    assert.equal(isAllowed('admin', 'ov.task.status'), true)
  })

  it('unknown method is denied for all roles', () => {
    assert.equal(isAllowed('reader', 'ov.nuke'), false)
    assert.equal(isAllowed('contributor', 'ov.nuke'), false)
    assert.equal(isAllowed('admin', 'ov.nuke'), false)
  })
})

// ── Audit ──

describe('AuditLog', () => {
  const auditPath = join(TMP, 'audit.jsonl')

  it('log appends entries and tail reads them', () => {
    const log = new AuditLog(auditPath)
    log.log({ timestamp: '2026-01-01', peer: 'aabb', peerName: 'Alice', role: 'admin', method: 'ov.find', status: 'allowed' })
    log.log({ timestamp: '2026-01-02', peer: 'ccdd', peerName: 'Bob', role: 'reader', method: 'ov.delete', status: 'denied', error: 'no permission' })

    const entries = log.tail(10)
    assert.equal(entries.length, 2)
    assert.equal(entries[0].peer, 'aabb')
    assert.equal(entries[1].status, 'denied')
  })

  it('tail returns empty for missing file', () => {
    const log = new AuditLog(join(TMP, 'nonexistent-audit.jsonl'))
    assert.deepEqual(log.tail(), [])
  })

  it('tail respects count limit', () => {
    const log = new AuditLog(auditPath)
    const entries = log.tail(1)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].peer, 'ccdd') // last entry
  })
})

// ── Rate limiter ──

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new RateLimiter({ reader: 3 }, 1000)
    assert.equal(limiter.check('peer1', 'reader'), true)
    assert.equal(limiter.check('peer1', 'reader'), true)
    assert.equal(limiter.check('peer1', 'reader'), true)
  })

  it('rejects requests over limit', () => {
    const limiter = new RateLimiter({ reader: 2 }, 1000)
    limiter.check('peer2', 'reader')
    limiter.check('peer2', 'reader')
    assert.equal(limiter.check('peer2', 'reader'), false)
  })

  it('admin is unlimited', () => {
    const limiter = new RateLimiter({ admin: 0 }, 1000)
    for (let i = 0; i < 1000; i++) {
      assert.equal(limiter.check('admin1', 'admin'), true)
    }
  })

  it('different peers have separate windows', () => {
    const limiter = new RateLimiter({ reader: 1 }, 1000)
    assert.equal(limiter.check('a', 'reader'), true)
    assert.equal(limiter.check('b', 'reader'), true)
    assert.equal(limiter.check('a', 'reader'), false) // a is over
    assert.equal(limiter.check('b', 'reader'), false) // b is over
  })

  it('cleanup removes stale windows', () => {
    const limiter = new RateLimiter({ reader: 100 }, 1) // 1ms window
    limiter.check('stale', 'reader')
    // Wait for window to expire
    const start = Date.now()
    while (Date.now() - start < 5) {} // busy wait 5ms
    limiter.cleanup()
    // Should be clean — next check should work
    assert.equal(limiter.check('stale', 'reader'), true)
  })
})

// ── Requests ──

describe('Join requests', () => {
  const reqPath = join(TMP, 'requests.json')

  it('loadRequests returns empty store for missing file', () => {
    const store = loadRequests(join(TMP, 'nonexistent-req.json'))
    assert.deepEqual(store.requests, {})
  })

  it('submitRequest creates pending request', () => {
    const store = loadRequests(reqPath)
    const result = submitRequest(store, '0xAlice', { name: 'Alice', message: 'Let me in!', pubkey: 'aabb' })
    assert.equal(result.ok, true)
    saveRequests(reqPath, store)

    const loaded = loadRequests(reqPath)
    assert.equal(loaded.requests['0xalice'].status, 'pending')
    assert.equal(loaded.requests['0xalice'].name, 'Alice')
  })

  it('submitRequest rejects duplicate pending', () => {
    const store = loadRequests(reqPath)
    const result = submitRequest(store, '0xAlice', { name: 'Alice', message: 'Again!', pubkey: 'aabb' })
    assert.equal(result.ok, false)
    assert.ok(result.error?.includes('pending'))
  })

  it('approveRequest changes status to approved', () => {
    const store = loadRequests(reqPath)
    const approved = approveRequest(store, '0xAlice', 'admin1')
    assert.ok(approved)
    assert.equal(approved?.status, 'approved')
    assert.equal(approved?.decidedBy, 'admin1')
    saveRequests(reqPath, store)
  })

  it('submitRequest rejects already approved', () => {
    const store = loadRequests(reqPath)
    const result = submitRequest(store, '0xAlice', { name: 'Alice', message: 'Re-apply', pubkey: 'aabb' })
    assert.equal(result.ok, false)
    assert.ok(result.error?.includes('approved'))
  })

  it('denyRequest sets cooldown', () => {
    const store = loadRequests(reqPath)
    submitRequest(store, '0xBob', { name: 'Bob', message: 'Plz', pubkey: 'bbcc' })
    const denied = denyRequest(store, '0xBob', 'admin1')
    assert.ok(denied)
    assert.equal(denied?.status, 'denied')
    assert.ok(denied?.deniedCooldownUntil)
    saveRequests(reqPath, store)
  })

  it('submitRequest rejects during cooldown', () => {
    const store = loadRequests(reqPath)
    const result = submitRequest(store, '0xBob', { name: 'Bob', message: 'Again', pubkey: 'bbcc' })
    assert.equal(result.ok, false)
    assert.ok(result.error?.includes('cooldown'))
  })

  it('listPendingRequests returns only pending', () => {
    const store = loadRequests(reqPath)
    submitRequest(store, '0xCharlie', { name: 'Charlie', message: 'Hi', pubkey: 'ccdd' })
    saveRequests(reqPath, store)
    const pending = listPendingRequests(store)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].name, 'Charlie')
  })

  it('listAllRequests returns all', () => {
    const store = loadRequests(reqPath)
    const all = listAllRequests(store)
    assert.ok(all.length >= 3) // Alice (approved), Bob (denied), Charlie (pending)
  })
})

// Cleanup
after(() => {
  try { rmSync(TMP, { recursive: true }) } catch {}
})
