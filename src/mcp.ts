#!/usr/bin/env node
// MCP stdio server for HyperViking — zero extra dependencies
// Implements MCP protocol (JSON-RPC 2.0 over newline-delimited stdin/stdout)
// All logging goes to stderr (stdout is protocol-only)

import { createClient, type HyperVikingClient } from './client.js'
import { createInterface } from 'node:readline'

const SERVER_KEY = process.argv[2]
if (!SERVER_KEY) {
  process.stderr.write('Usage: hv mcp <server-public-key>\n')
  process.exit(1)
}

/* -- Tool schema types -------------------------------------------------- */

interface ToolInputSchema {
  type: 'object'
  properties: Record<string, {
    type: string
    description?: string
    default?: unknown
    enum?: string[]
  }>
  required?: string[]
}

interface ToolDefinition {
  name: string
  description: string
  inputSchema: ToolInputSchema
}

interface McpRequest {
  id?: number
  method: string
  params?: {
    name?: string
    arguments?: Record<string, unknown>
  }
}

type RpcMapper = (args: Record<string, unknown>) => [string, Record<string, unknown>]

/* -- Tool definitions --------------------------------------------------- */

const TOOLS: ToolDefinition[] = [
  // ── Knowledge operations ──
  {
    name: 'viking_find',
    description: 'Semantic search across indexed knowledge. Finds content by meaning, not exact match. Use for concept-based queries like "how does auth work" or "database connection patterns".',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        uri: { type: 'string', description: 'Scope search to a URI (e.g. viking://resources/my-repo)' },
        limit: { type: 'number', description: 'Max results (default 10)', default: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'viking_grep',
    description: 'Exact text/regex search across indexed content. Use when you know the specific keyword, function name, or error string.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex supported)' },
        uri: { type: 'string', description: 'Scope to URI' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'viking_glob',
    description: 'Find files by name pattern. Use to enumerate files like "**/*.py" or "test_*.ts".',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.ts)' },
        uri: { type: 'string', description: 'Scope to URI' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'viking_read',
    description: 'Read the full content of a file. Use after finding a relevant file via search.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'Viking URI of the file to read' }
      },
      required: ['uri']
    }
  },
  {
    name: 'viking_ls',
    description: 'List contents of a Viking URI directory.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'Directory URI to list', default: 'viking://' }
      }
    }
  },
  {
    name: 'viking_tree',
    description: 'Show full directory tree of a Viking URI.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'Root URI for tree' }
      },
      required: ['uri']
    }
  },
  {
    name: 'viking_overview',
    description: 'Get a medium-detail overview of a directory. Shows structure and key points without full content.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'Viking URI of the directory' }
      },
      required: ['uri']
    }
  },
  {
    name: 'viking_abstract',
    description: 'Get a brief one-line summary of a directory or file.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'Viking URI' }
      },
      required: ['uri']
    }
  },
  {
    name: 'viking_add_resource',
    description: 'Index a local path or URL into the knowledge base. The resource will be parsed, embedded, and made searchable.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Local file/directory path or URL to index' },
        target_uri: { type: 'string', description: 'Target URI in viking:// namespace' }
      },
      required: ['path']
    }
  },
  {
    name: 'viking_remove',
    description: 'Remove a resource from the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'Viking URI to remove' },
        recursive: { type: 'boolean', description: 'Remove recursively', default: true }
      },
      required: ['uri']
    }
  },
  {
    name: 'viking_health',
    description: 'Check if the OpenViking knowledge server is healthy and reachable.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'viking_status',
    description: 'Get system status including queue processing, vector index health, and VLM usage.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'viking_queue',
    description: 'Check the embedding and semantic processing queue status.',
    inputSchema: { type: 'object', properties: {} }
  },

  // ── Skills ──
  {
    name: 'viking_add_skill',
    description: 'Add a skill to the knowledge base. Skills are agent capabilities with structured metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Skill content (SKILL.md format)' },
        wait: { type: 'boolean', description: 'Wait for indexing to complete', default: true }
      },
      required: ['data']
    }
  },
  {
    name: 'viking_list_skills',
    description: 'List all indexed skills.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results', default: 256 }
      }
    }
  },

  // ── Sessions ──
  {
    name: 'viking_session_create',
    description: 'Create a new conversational session for multi-turn knowledge ingestion.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'viking_session_message',
    description: 'Add a message to an existing session.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        role: { type: 'string', description: 'Message role (user/assistant)' },
        content: { type: 'string', description: 'Message content' }
      },
      required: ['session_id', 'role', 'content']
    }
  },
  {
    name: 'viking_session_commit',
    description: 'Commit a session to the knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        wait: { type: 'boolean', description: 'Wait for indexing', default: true }
      },
      required: ['session_id']
    }
  },

  // ── Member management (RBAC mode) ──
  {
    name: 'viking_whoami',
    description: 'Get your identity on this server: pubkey, name, role, eth address.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'viking_members',
    description: 'List all members of this knowledge brain.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'viking_add_member',
    description: 'Add a member to the brain (admin only).',
    inputSchema: {
      type: 'object',
      properties: {
        pubkey: { type: 'string', description: 'Member public key (64-char hex)' },
        role: { type: 'string', description: 'Role to assign', enum: ['reader', 'contributor', 'admin'] },
        name: { type: 'string', description: 'Display name' },
        eth: { type: 'string', description: 'Ethereum address (optional)' }
      },
      required: ['pubkey', 'role', 'name']
    }
  },
  {
    name: 'viking_remove_member',
    description: 'Remove a member from the brain (admin only).',
    inputSchema: {
      type: 'object',
      properties: {
        pubkey: { type: 'string', description: 'Member public key to remove' }
      },
      required: ['pubkey']
    }
  },
  {
    name: 'viking_update_role',
    description: 'Change a member\'s role (admin only).',
    inputSchema: {
      type: 'object',
      properties: {
        pubkey: { type: 'string', description: 'Member public key' },
        role: { type: 'string', description: 'New role', enum: ['reader', 'contributor', 'admin'] }
      },
      required: ['pubkey', 'role']
    }
  },
  {
    name: 'viking_audit',
    description: 'View recent audit log entries (admin only).',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of entries to return', default: 50 }
      }
    }
  }
]

/* -- Tool name → RPC method mapping ------------------------------------- */

const TOOL_RPC: Record<string, RpcMapper> = {
  // Knowledge
  viking_find: (args) => ['ov.find', { query: args.query, uri: args.uri, limit: (args.limit as number) || 10 }],
  viking_grep: (args) => ['ov.grep', { pattern: args.pattern, uri: args.uri }],
  viking_glob: (args) => ['ov.glob', { pattern: args.pattern, uri: args.uri }],
  viking_read: (args) => ['ov.read', { uri: args.uri }],
  viking_ls: (args) => ['ov.ls', { uri: (args.uri as string) || 'viking://' }],
  viking_tree: (args) => ['ov.tree', { uri: args.uri }],
  viking_overview: (args) => ['ov.overview', { uri: args.uri }],
  viking_abstract: (args) => ['ov.abstract', { uri: args.uri }],
  viking_add_resource: (args) => ['ov.add-resource', { path: args.path, target: args.target_uri }],
  viking_remove: (args) => ['ov.delete', { uri: args.uri, recursive: (args.recursive as boolean) ?? true }],
  viking_health: () => ['ov.health', {}],
  viking_status: () => ['ov.status', {}],
  viking_queue: () => ['ov.observer.queue', {}],

  // Skills
  viking_add_skill: (args) => ['ov.add-skill', { data: args.data, wait: args.wait ?? true }],
  viking_list_skills: (args) => ['ov.list-skills', { limit: args.limit }],

  // Sessions
  viking_session_create: () => ['ov.session.create', {}],
  viking_session_message: (args) => ['ov.session.message', { session_id: args.session_id, role: args.role, content: args.content }],
  viking_session_commit: (args) => ['ov.session.commit', { session_id: args.session_id, wait: args.wait ?? true }],

  // Members (RBAC)
  viking_whoami: () => ['hv.whoami', {}],
  viking_members: () => ['hv.members', {}],
  viking_add_member: (args) => ['hv.add-member', { pubkey: args.pubkey, role: args.role, name: args.name, eth: args.eth }],
  viking_remove_member: (args) => ['hv.remove-member', { pubkey: args.pubkey }],
  viking_update_role: (args) => ['hv.update-role', { pubkey: args.pubkey, role: args.role }],
  viking_audit: (args) => ['hv.audit', { count: args.count || 50 }]
}

/* -- MCP protocol helpers ----------------------------------------------- */

function send (msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function result (id: number, data: unknown): void {
  send({ jsonrpc: '2.0', id, result: data })
}

function error (id: number, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

/* -- Main --------------------------------------------------------------- */

async function main (): Promise<void> {
  process.stderr.write(`[hyperviking-mcp] connecting to ${SERVER_KEY.slice(0, 12)}...\n`)

  let client: HyperVikingClient
  try {
    client = await createClient({
      name: 'mcp',
      serverPublicKey: SERVER_KEY,
      connectTimeout: 30000
    })
    process.stderr.write('[hyperviking-mcp] connected\n')
  } catch (err) {
    process.stderr.write(`[hyperviking-mcp] connection failed: ${(err as Error).message}\n`)
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin })

  rl.on('line', async (line: string) => {
    let msg: McpRequest
    try {
      msg = JSON.parse(line) as McpRequest
    } catch {
      return // ignore malformed
    }

    const { id, method, params } = msg

    try {
      switch (method) {
        /* -- Initialize handshake -- */
        case 'initialize':
          result(id!, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'hyperviking',
              version: '0.3.0'
            }
          })
          break

        /* -- Initialized notification (no response needed) -- */
        case 'notifications/initialized':
          break

        /* -- List tools -- */
        case 'tools/list':
          result(id!, { tools: TOOLS })
          break

        /* -- Call tool -- */
        case 'tools/call': {
          const toolName = params?.name
          const args = params?.arguments || {}
          const mapper = toolName ? TOOL_RPC[toolName] : undefined

          if (!mapper) {
            result(id!, {
              content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
              isError: true
            })
            break
          }

          const [rpcMethod, rpcParams] = mapper(args)
          try {
            const data = await client.call(rpcMethod, rpcParams)
            const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
            result(id!, {
              content: [{ type: 'text', text }]
            })
          } catch (err) {
            result(id!, {
              content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
              isError: true
            })
          }
          break
        }

        /* -- Ping -- */
        case 'ping':
          result(id!, {})
          break

        /* -- Unknown -- */
        default:
          if (id != null) {
            error(id, -32601, `Method not found: ${method}`)
          }
      }
    } catch (err) {
      process.stderr.write(`[hyperviking-mcp] error handling ${method}: ${(err as Error).message}\n`)
      if (id != null) {
        error(id, -32603, (err as Error).message)
      }
    }
  })

  rl.on('close', async () => {
    process.stderr.write('[hyperviking-mcp] stdin closed, shutting down\n')
    await client.close()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    await client.close()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await client.close()
    process.exit(0)
  })
}

main().catch((err: unknown) => {
  process.stderr.write(`[hyperviking-mcp] fatal: ${(err as Error).message}\n`)
  process.exit(1)
})
