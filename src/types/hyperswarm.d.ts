declare module 'hyperswarm' {
  import { Duplex } from 'node:stream'
  import type { Buffer } from 'node:buffer'

  interface KeyPair {
    publicKey: Buffer
    secretKey: Buffer
  }

  interface PeerInfo {
    publicKey: Buffer
    topics: Buffer[]
    client: boolean
  }

  interface SwarmOptions {
    keyPair?: KeyPair
    dht?: import('hyperdht')
    firewall?: (remotePublicKey: Buffer) => boolean
    maxConnections?: number
    maxPeers?: number
  }

  interface JoinOptions {
    server?: boolean
    client?: boolean
  }

  interface Discovery {
    flushed(): Promise<void>
    destroy(): Promise<void>
  }

  class Hyperswarm {
    constructor(opts?: SwarmOptions)
    join(topic: Buffer, opts?: JoinOptions): Discovery
    leave(topic: Buffer): Promise<void>
    flush(): Promise<void>
    destroy(): Promise<void>
    on(event: 'connection', listener: (socket: Duplex, info: PeerInfo) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
  }

  export = Hyperswarm
}
