import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'
import { Decoder } from '../dist/protocol.js'
import { isAllowed } from '../dist/roles.js'

describe('Security: protocol decoder', () => {
  it('rejects messages exceeding 16MB', () => {
    const decoder = new Decoder()
    // Craft a 4-byte header claiming 100MB payload
    const header = Buffer.alloc(4)
    header.writeUInt32LE(100 * 1024 * 1024, 0) // 100MB
    assert.throws(
      () => decoder.push(header),
      /Message too large/
    )
    // Decoder buffer should be reset — not accumulating
    const msgs = decoder.drain()
    assert.equal(msgs.length, 0)
  })

  it('rejects messages at the 4GB uint32 max', () => {
    const decoder = new Decoder()
    const header = Buffer.alloc(4)
    header.writeUInt32LE(0xFFFFFFFF, 0) // 4GB
    assert.throws(
      () => decoder.push(header),
      /Message too large/
    )
  })

  it('allows messages under 16MB', () => {
    const decoder = new Decoder()
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' })
    const buf = b4a.from(payload, 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(buf.byteLength, 0)
    decoder.push(b4a.concat([header, buf]))
    const msgs = decoder.drain()
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0].id, 1)
  })

  it('recovers after rejecting oversized message', () => {
    const decoder = new Decoder()
    // Send oversized header — should throw and reset
    const badHeader = Buffer.alloc(4)
    badHeader.writeUInt32LE(50 * 1024 * 1024, 0)
    assert.throws(() => decoder.push(badHeader), /Message too large/)

    // Now send a valid message — decoder should work again
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'recovered' })
    const buf = b4a.from(payload, 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(buf.byteLength, 0)
    decoder.push(b4a.concat([header, buf]))
    const msgs = decoder.drain()
    assert.equal(msgs.length, 1)
    assert.equal(msgs[0].id, 2)
  })
})

describe('Security: path injection prevention', () => {
  // Import the validator indirectly by testing the behavior
  // The validatePathParam function is not exported, so we test via RPC behavior

  it('RBAC blocks unknown methods (no bypass via crafted names)', () => {
    assert.equal(isAllowed('reader', '../../admin'), false)
    assert.equal(isAllowed('contributor', 'ov.session.commit/../../delete'), false)
    assert.equal(isAllowed('admin', ''), false)
    assert.equal(isAllowed('reader', 'ov.find\x00ov.delete'), false)
  })

  it('RBAC allows exact method names only', () => {
    assert.equal(isAllowed('reader', 'ov.find'), true)
    assert.equal(isAllowed('reader', 'ov.find '), false) // trailing space
    assert.equal(isAllowed('reader', ' ov.find'), false) // leading space
    assert.equal(isAllowed('reader', 'OV.FIND'), false) // case sensitive
  })
})

describe('Security: method truncation for audit safety', () => {
  it('methods longer than 256 chars would be truncated in audit', () => {
    const longMethod = 'x'.repeat(1000)
    // The truncation happens in server.ts before logging
    // Here we verify the RBAC correctly denies absurdly long methods
    assert.equal(isAllowed('admin', longMethod), false)
    assert.equal(isAllowed('reader', longMethod), false)
  })
})
