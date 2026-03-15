#!/usr/bin/env node
import { createServer } from './server.js'
import { createClient } from './client.js'
import { generateKeypair, getOrCreateKeypair, listKeys, saveAllowlist } from './keys.js'
import { loadRoleList, saveRoleList, addMember, removeMember, updateRole, listMembers } from './roles.js'
import { setupServer, selfUpdate, doctor } from './setup.js'
import type { Role } from './roles.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import b4a from 'b4a'

const HV_DIR = join(homedir(), '.hyperviking')
const ALLOWLIST_PATH = join(HV_DIR, 'allowlist.json')
const MEMBERS_PATH = join(HV_DIR, 'members.json')

const [,, cmd, ...args] = process.argv

const SUBCOMMANDS = new Set([
  'ls', 'find', 'read', 'overview', 'status', 'grep', 'glob',
  'tree', 'abstract', 'health', 'queue', 'add', 'remove'
])

const commands: Record<string, () => Promise<void> | void> = {
  async init () {
    const isServer = args.includes('--server')
    const name = isServer ? 'server' : 'default'

    const kp = getOrCreateKeypair(name)
    const pubKey = b4a.toString(kp.publicKey, 'hex')

    if (isServer) {
      console.log(`
  HyperViking Server Setup
  ────────────────────────

  Your server public key:
    ${pubKey}

  Share this key with agents who need access.

  Simple mode (allowlist):
    hv allow <agent-pubkey-1> <agent-pubkey-2> ...
    hv serve

  RBAC mode (roles + audit + rate limiting):
    hv add-member <pubkey> admin "Your Name"
    hv serve --roles
`)
    } else {
      console.log(`
  HyperViking Agent Setup
  ───────────────────────

  Your public key:
    ${pubKey}

  Send this key to the server operator to get access.

  Once added, configure MCP:

  Claude Code (~/.claude/settings.json) or Cursor (mcp.json):
    {
      "mcpServers": {
        "hyperviking": {
          "command": "hv",
          "args": ["mcp", "<SERVER_PUBKEY>"]
        }
      }
    }

  Codex (~/.codex/config.toml):
    [mcp_servers.hyperviking]
    command = "hv"
    args = ["mcp", "<SERVER_PUBKEY>"]

  Replace <SERVER_PUBKEY> with the server's public key.
`)
    }
  },

  async serve () {
    const ovUrl = args.find(a => a.startsWith('--ov-url='))?.split('=')[1] || 'http://127.0.0.1:1933'
    const useRoles = args.includes('--roles')
    const membersPath = args.find(a => a.startsWith('--members='))?.split('=')[1]

    const server = await createServer({
      openVikingUrl: ovUrl,
      ...(useRoles ? {
        roles: {
          path: membersPath || MEMBERS_PATH
        }
      } : {})
    })
    process.on('SIGINT', async () => {
      console.log('\n[hyperviking] shutting down...')
      await server.close()
      process.exit(0)
    })
  },

  async connect () {
    // If first arg is a known subcommand, use HV_SERVER_KEY for the key
    let serverKey: string | undefined
    let subArgs: string[]
    if (args[0] && SUBCOMMANDS.has(args[0]) && process.env.HV_SERVER_KEY) {
      serverKey = process.env.HV_SERVER_KEY
      subArgs = args
    } else {
      serverKey = args[0] || process.env.HV_SERVER_KEY
      subArgs = args.slice(1)
    }
    if (!serverKey) {
      console.error('Usage: hv connect <server-public-key> [subcommand] [args...]\n  Or set HV_SERVER_KEY env var.')
      return
    }

    const client = await createClient({ serverPublicKey: serverKey })
    console.error('[hv] connected to server')

    const sub = subArgs[0]
    if (!sub) {
      const health = await client.health()
      console.log(JSON.stringify(health, null, 2))
      await client.close()
      return
    }

    let result: unknown
    switch (sub) {
      case 'ls':
        result = await client.ls(subArgs[1])
        break
      case 'find':
        result = await client.find(subArgs[1], { limit: parseInt(subArgs[2]) || 10 })
        break
      case 'read':
        result = await client.read(subArgs[1])
        break
      case 'overview':
        result = await client.overview(subArgs[1])
        break
      case 'status':
        result = await client.status()
        break
      case 'grep':
        result = await client.call('ov.grep', { pattern: subArgs[1], uri: subArgs[2] })
        break
      case 'glob':
        result = await client.call('ov.glob', { pattern: subArgs[1], uri: subArgs[2] })
        break
      case 'tree':
        result = await client.call('ov.tree', { uri: subArgs[1] })
        break
      case 'abstract':
        result = await client.call('ov.abstract', { uri: subArgs[1] })
        break
      case 'health':
        result = await client.health()
        break
      case 'queue':
        result = await client.call('ov.observer.queue', {})
        break
      case 'add':
        result = await client.call('ov.add-resource', { path: subArgs[1], target: subArgs[2] })
        break
      case 'remove':
        result = await client.call('ov.delete', { uri: subArgs[1], recursive: true })
        break
      default:
        console.error(`Unknown subcommand: ${sub}`)
        await client.close()
        process.exit(1)
    }
    console.log(JSON.stringify(result, null, 2))
    await client.close()
  },

  async mcp () {
    const serverKey = args[0] || process.env.HV_SERVER_KEY
    if (!serverKey) {
      console.error('Usage: hv mcp <server-public-key>\n  Or set HV_SERVER_KEY env var.')
      return
    }
    // Hand off to the MCP stdio server
    const mcpPath = new URL('./mcp.js', import.meta.url).pathname
    const child = spawn(process.execPath, [mcpPath, serverKey], {
      stdio: 'inherit'
    })
    child.on('exit', (code) => process.exit(code || 0))
    process.on('SIGINT', () => child.kill('SIGINT'))
    process.on('SIGTERM', () => child.kill('SIGTERM'))
  },

  async proxy () {
    const serverKey = args[0] || process.env.HV_SERVER_KEY
    if (!serverKey) {
      console.error('Usage: hv proxy <server-public-key> [--port=1934]\n  Or set HV_SERVER_KEY env var.')
      return
    }
    const proxyPath = new URL('./proxy.js', import.meta.url).pathname
    const child = spawn(process.execPath, [proxyPath, serverKey, ...args.slice(1)], {
      stdio: 'inherit'
    })
    child.on('exit', (code) => process.exit(code || 0))
    process.on('SIGINT', () => child.kill('SIGINT'))
    process.on('SIGTERM', () => child.kill('SIGTERM'))
  },

  keygen () {
    const name = args[0] || 'default'
    const kp = generateKeypair(name)
    console.log(`Generated keypair "${name}"`)
    console.log(`Public key: ${b4a.toString(kp.publicKey, 'hex')}`)
  },

  keys () {
    const keys = listKeys()
    if (keys.length === 0) { console.log('No keys found. Run: hv keygen <name>'); return }
    for (const k of keys) {
      console.log(`  ${k.name}: ${k.publicKey} (${k.createdAt})`)
    }
  },

  allow () {
    if (args.length === 0) { console.error('Usage: hv allow <pubkey1> [pubkey2] ...'); return }
    const keys = new Set(args)
    saveAllowlist(ALLOWLIST_PATH, keys)
    console.log(`Allowlist saved with ${keys.size} key(s) to ${ALLOWLIST_PATH}`)
  },

  // ── Member management (RBAC mode) ──

  'add-member' () {
    const [pubkey, role, ...nameParts] = args
    const name = nameParts.join(' ')
    if (!pubkey || !role || !name) {
      console.error('Usage: hv add-member <pubkey> <role> <name>')
      console.error('Roles: reader, contributor, admin')
      return
    }
    if (!['reader', 'contributor', 'admin'].includes(role)) {
      console.error('Invalid role. Must be: reader, contributor, or admin')
      return
    }
    const roleList = loadRoleList(MEMBERS_PATH)
    addMember(roleList, pubkey, {
      role: role as Role,
      name,
      addedAt: new Date().toISOString(),
      addedBy: 'cli'
    })
    saveRoleList(MEMBERS_PATH, roleList)
    console.log(`Added ${name} as ${role} (${pubkey.slice(0, 12)}...)`)
  },

  'remove-member' () {
    const [pubkey] = args
    if (!pubkey) {
      console.error('Usage: hv remove-member <pubkey>')
      return
    }
    const roleList = loadRoleList(MEMBERS_PATH)
    const removed = removeMember(roleList, pubkey)
    if (!removed) {
      console.error('Member not found')
      return
    }
    saveRoleList(MEMBERS_PATH, roleList)
    console.log(`Removed member ${pubkey.slice(0, 12)}...`)
  },

  'update-role' () {
    const [pubkey, role] = args
    if (!pubkey || !role) {
      console.error('Usage: hv update-role <pubkey> <role>')
      console.error('Roles: reader, contributor, admin')
      return
    }
    if (!['reader', 'contributor', 'admin'].includes(role)) {
      console.error('Invalid role. Must be: reader, contributor, or admin')
      return
    }
    const roleList = loadRoleList(MEMBERS_PATH)
    const updated = updateRole(roleList, pubkey, role as Role)
    if (!updated) {
      console.error('Member not found')
      return
    }
    saveRoleList(MEMBERS_PATH, roleList)
    console.log(`Updated ${pubkey.slice(0, 12)}... to ${role}`)
  },

  members () {
    const roleList = loadRoleList(MEMBERS_PATH)
    const members = listMembers(roleList)
    if (members.length === 0) {
      console.log('No members. Add one: hv add-member <pubkey> <role> <name>')
      return
    }
    console.log(`Members (${members.length}):`)
    for (const m of members) {
      console.log(`  ${m.name} [${m.role}] ${m.pubkey.slice(0, 12)}...${m.eth ? ` (${m.eth.slice(0, 10)}...)` : ''}`)
    }
  },

  // ── Setup & maintenance ──

  'setup-server' () {
    const solo = args.includes('--solo')
    return setupServer(solo)
  },

  async update () {
    return selfUpdate()
  },

  async doctor () {
    return doctor()
  },

  help () {
    console.log(`
hyperviking - P2P encrypted knowledge brain for AI agents

Setup:
  hv init                                First-time agent setup (keygen + MCP config)
  hv init --server                       First-time server setup
  hv setup-server                        Full server setup (OpenViking + RBAC, needs Docker)
  hv setup-server --solo                 Solo server setup (OpenViking + allowlist)
  hv update                              Update HyperViking to latest version
  hv doctor                              Check system health

Server:
  hv serve [--ov-url=URL]                Start server with simple allowlist
  hv serve --roles [--ov-url=URL]        Start server with RBAC (roles + audit + rate limiting)
  hv allow <key1> [key2] ...             Set peer allowlist (simple mode)

Members (RBAC mode):
  hv add-member <pubkey> <role> <name>   Add member (reader/contributor/admin)
  hv remove-member <pubkey>              Remove member
  hv update-role <pubkey> <role>         Change member's role
  hv members                             List all members

Agent (MCP):
  hv mcp <server-key>                    Start MCP stdio server (for Claude Code / Cursor)
  hv proxy <server-key> [--port=1934]    Start local HTTP proxy

CLI (all subcommands also work with HV_SERVER_KEY env var instead of <server-key>):
  hv connect <server-key>                Connect and check health
  hv connect <server-key> ls [uri]       List directory contents
  hv connect <server-key> find <query>   Semantic search
  hv connect <server-key> read <uri>     Read file content
  hv connect <server-key> grep <pat>     Regex search across content
  hv connect <server-key> glob <pat>     Find files by name pattern
  hv connect <server-key> tree <uri>     Full directory tree
  hv connect <server-key> overview <uri> Medium-detail directory overview
  hv connect <server-key> abstract <uri> One-line summary
  hv connect <server-key> status         System status (vectors, VLM)
  hv connect <server-key> health         Server health check
  hv connect <server-key> queue          Embedding queue status
  hv connect <server-key> add <path> [target]  Index a path into the brain
  hv connect <server-key> remove <uri>   Remove a resource

Keys:
  hv keygen [name]                       Generate keypair
  hv keys                                List keypairs

Environment:
  HV_SERVER_KEY    Server public key (used when <server-key> arg is omitted)

Access Control:
  Simple mode:  hv allow <keys> + hv serve (binary in/out)
  RBAC mode:    hv add-member + hv serve --roles (3-tier permissions + audit + rate limiting)

Security:
  All connections use Noise protocol (Curve25519 + ChaCha20-Poly1305).
  Identity is a 32-byte public key. No ports, no DNS, no certs.
  Firewall rejects unknown peers before handshake completes.
`)
  }
}

if (cmd === '--version' || cmd === '-v') {
  console.log('0.4.0')
  process.exit(0)
}

const handler = commands[cmd]
if (!handler) {
  if (cmd) console.error(`Unknown command: ${cmd}`)
  commands.help()
  process.exit(cmd ? 1 : 0)
}

try {
  await handler()
} catch (err) {
  console.error(`Error: ${(err as Error).message}`)
  process.exit(1)
}
