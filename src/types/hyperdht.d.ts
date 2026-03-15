declare module 'hyperdht' {
  import type { Buffer } from 'node:buffer'

  interface KeyPair {
    publicKey: Buffer
    secretKey: Buffer
  }

  interface DHTOptions {
    bootstrap?: Array<{ host: string; port: number }>
    keyPair?: KeyPair
  }

  class DHT {
    constructor(opts?: DHTOptions)
    static keyPair(seed?: Buffer): KeyPair
    destroy(): Promise<void>
  }

  export = DHT
}
