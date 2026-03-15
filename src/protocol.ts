import b4a from 'b4a'

// Simple length-prefixed JSON-RPC over the encrypted stream.
// Each message: [4-byte LE length][JSON payload]

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse

export function encode (obj: JsonRpcMessage): Buffer {
  const json = JSON.stringify(obj)
  const payload = b4a.from(json, 'utf8') as Buffer
  const header = b4a.allocUnsafe(4) as Buffer
  header.writeUInt32LE(payload.byteLength, 0)
  return b4a.concat([header, payload]) as Buffer
}

export class Decoder {
  private _buf: Buffer
  private _messages: JsonRpcMessage[]

  constructor () {
    this._buf = b4a.alloc(0) as Buffer
    this._messages = []
  }

  push (chunk: Buffer): this {
    this._buf = b4a.concat([this._buf, chunk]) as Buffer
    while (this._buf.byteLength >= 4) {
      const len = this._buf.readUInt32LE(0)
      if (this._buf.byteLength < 4 + len) break
      const payload = this._buf.subarray(4, 4 + len)
      this._buf = this._buf.subarray(4 + len) as Buffer
      this._messages.push(JSON.parse(b4a.toString(payload, 'utf8')) as JsonRpcMessage)
    }
    return this
  }

  drain (): JsonRpcMessage[] {
    const msgs = this._messages
    this._messages = []
    return msgs
  }
}

let _idCounter = 0

export function request (method: string, params: Record<string, unknown> = {}): Buffer {
  return encode({ jsonrpc: '2.0', id: ++_idCounter, method, params })
}

export function response (id: number, result: unknown): Buffer {
  return encode({ jsonrpc: '2.0', id, result })
}

export function error (id: number, code: number, message: string): Buffer {
  return encode({ jsonrpc: '2.0', id, error: { code, message } })
}
