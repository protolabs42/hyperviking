#!/usr/bin/env node
// MCP server for HyperViking — zero extra dependencies
// Supports two transports:
//   stdio:  newline-delimited JSON-RPC on stdin/stdout (one session per process)
//   http:   Streamable HTTP transport on localhost (multi-session, one P2P connection)
//
// Usage:
//   hv mcp <server-key> [identity]              — stdio mode
//   hv mcp <server-key> [identity] --http 1940  — HTTP mode on port 1940

import { createClient, type HyperVikingClient } from './client.js'
import { createInterface } from 'node:readline'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'

// Parse args: <server-key> [identity] [--http port]
const args = process.argv.slice(2)
const httpIdx = args.indexOf('--http')
const HTTP_MODE = httpIdx !== -1
const HTTP_PORT = HTTP_MODE ? parseInt(args[httpIdx + 1] || '1940', 10) : 0
const filteredArgs = HTTP_MODE ? args.filter((_, i) => i !== httpIdx && i !== httpIdx + 1) : args

const SERVER_KEY = filteredArgs[0]
const IDENTITY = filteredArgs[1]
if (!SERVER_KEY) {
  process.stderr.write('Usage: hv mcp <server-key> [identity] [--http port]\n')
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
        limit: { type: 'number', description: 'Max results (default 10)', default: 10 },
        include_provenance: { type: 'boolean', description: 'Include retrieval trajectory (tiers, match reasons, thinking trace)' }
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
    description: 'Commit a session. Returns immediately with { status: "accepted", task_id }. Use viking_task_status to poll for completion.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' }
      },
      required: ['session_id']
    }
  },
  {
    name: 'viking_session_used',
    description: 'Record which contexts and skills were actually used during a session. Call before commit to update memory active_count/hotness.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        contexts: { type: 'string', description: 'JSON array of context URIs that were used' },
        skill: { type: 'string', description: 'Skill URI that was used' }
      },
      required: ['session_id']
    }
  },
  {
    name: 'viking_task_status',
    description: 'Poll the status of a background task (e.g. after an async session commit). Returns task state and token_usage when complete.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID returned from async operations' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'viking_memory_stats',
    description: 'Get memory health statistics: total count, category breakdown, hotness distribution (cold/warm/hot), staleness metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (e.g. profile, entities, cases, tools)' }
      }
    }
  },
  {
    name: 'viking_session_stats',
    description: 'Get per-session extraction statistics: turns, memories extracted, contexts used, skills used.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' }
      },
      required: ['session_id']
    }
  },
  {
    name: 'viking_write',
    description: 'Write content to an existing file in the knowledge base. Supports replace and append modes. Triggers semantic refresh after write.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'Viking URI of the file to write (must exist, must be a file)' },
        content: { type: 'string', description: 'Content to write' },
        mode: { type: 'string', description: 'Write mode', enum: ['replace', 'append'], default: 'replace' },
        wait: { type: 'boolean', description: 'Wait for semantic refresh to complete', default: false },
        timeout: { type: 'number', description: 'Timeout in seconds when wait=true' }
      },
      required: ['uri', 'content']
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
  viking_find: (args) => ['ov.find', { query: args.query, uri: args.uri, limit: (args.limit as number) || 10, include_provenance: args.include_provenance }],
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
  viking_session_commit: (args) => ['ov.session.commit', { session_id: args.session_id }],
  viking_session_used: (args) => ['ov.session.used', { session_id: args.session_id, contexts: args.contexts, skill: args.skill }],
  viking_task_status: (args) => ['ov.task.status', { task_id: args.task_id }],
  viking_memory_stats: (args) => ['ov.stats.memories', { category: args.category }],
  viking_session_stats: (args) => ['ov.session.stats', { session_id: args.session_id }],
  viking_write: (args) => ['ov.write', { uri: args.uri, content: args.content, mode: args.mode ?? 'replace', wait: args.wait ?? false, timeout: args.timeout }],

  // Members (RBAC)
  viking_whoami: () => ['hv.whoami', {}],
  viking_members: () => ['hv.members', {}],
  viking_add_member: (args) => ['hv.add-member', { pubkey: args.pubkey, role: args.role, name: args.name, eth: args.eth }],
  viking_remove_member: (args) => ['hv.remove-member', { pubkey: args.pubkey }],
  viking_update_role: (args) => ['hv.update-role', { pubkey: args.pubkey, role: args.role }],
  viking_audit: (args) => ['hv.audit', { count: args.count || 50 }]
}

/* -- MCP message handler (transport-agnostic) ----------------------------- */

async function handleMessage (msg: McpRequest, client: HyperVikingClient): Promise<Record<string, unknown> | null> {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize': {
      // Echo back the client's protocol version if we support it (MCP spec requirement)
      const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])
      const clientVersion = (params as Record<string, unknown>)?.protocolVersion as string || '2024-11-05'
      const negotiatedVersion = SUPPORTED_VERSIONS.has(clientVersion) ? clientVersion : '2024-11-05'
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: negotiatedVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'hyperviking', version: '0.5.0' }
      }}
    }

    case 'notifications/initialized':
      return null // no response for notifications

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }

    case 'tools/call': {
      const toolName = params?.name
      const toolArgs = params?.arguments || {}
      const mapper = toolName ? TOOL_RPC[toolName] : undefined

      if (!mapper) {
        return { jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
          isError: true
        }}
      }

      const [rpcMethod, rpcParams] = mapper(toolArgs)
      try {
        const data = await client.call(rpcMethod, rpcParams)
        const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
        return { jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text }]
        }}
      } catch (err) {
        return { jsonrpc: '2.0', id, result: {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true
        }}
      }
    }

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }

    default:
      if (id != null) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
      }
      return null
  }
}

/* -- Transport: stdio ----------------------------------------------------- */

function startStdio (client: HyperVikingClient): void {
  const rl = createInterface({ input: process.stdin })

  rl.on('line', async (line: string) => {
    let msg: McpRequest
    try {
      msg = JSON.parse(line) as McpRequest
    } catch { return }

    try {
      const res = await handleMessage(msg, client)
      if (res) process.stdout.write(JSON.stringify(res) + '\n')
    } catch (err) {
      process.stderr.write(`[hyperviking-mcp] error: ${(err as Error).message}\n`)
      if (msg.id != null) {
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: (err as Error).message }
        }) + '\n')
      }
    }
  })

  rl.on('close', async () => {
    process.stderr.write('[hyperviking-mcp] stdin closed, shutting down\n')
    await client.close()
    process.exit(0)
  })
}

/* -- Transport: Streamable HTTP ------------------------------------------- */

function startHttp (client: HyperVikingClient, port: number): void {
  const ALLOWED_ORIGINS = new Set(['http://localhost', 'http://127.0.0.1', 'null', ''])

  // Track SSE connections for server→client notifications (future use)
  const sseClients = new Set<ServerResponse>()

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url?.split('?')[0] || '/'

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'http://localhost',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      })
      res.end()
      return
    }

    // Health check
    if (req.method === 'GET' && (path === '/health' || path === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', transport: 'http', identity: IDENTITY || 'ephemeral' }))
      return
    }

    // SSE stream (GET /mcp) — MCP spec requires this for server→client messages
    if (req.method === 'GET' && path === '/mcp') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': 'http://localhost'
      })
      // Send endpoint info so client knows where to POST
      res.write(`event: endpoint\ndata: /mcp\n\n`)
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return // keep connection open
    }

    // POST /mcp — main request handler
    if (req.method !== 'POST' || path !== '/mcp') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    // Validate Origin header (MCP spec requirement — prevent DNS rebinding)
    const origin = req.headers.origin || ''
    if (origin && !ALLOWED_ORIGINS.has(origin.replace(/:\d+$/, ''))) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Forbidden: invalid origin' }, id: null }))
      return
    }

    // Read body (capped at 1MB)
    const chunks: Buffer[] = []
    let size = 0
    const MAX_BODY = 1024 * 1024

    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: 'Request too large' }, id: null }))
        return
      }
      chunks.push(chunk as Buffer)
    }

    let msg: McpRequest
    try {
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as McpRequest
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }))
      return
    }

    const corsHeaders = { 'Access-Control-Allow-Origin': 'http://localhost' }

    try {
      const result = await handleMessage(msg, client)
      if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify(result))
      } else {
        res.writeHead(202, corsHeaders)
        res.end()
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({
        jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: msg.id ?? null
      }))
    }
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`[hyperviking-mcp] HTTP transport listening on http://127.0.0.1:${port}/mcp`)
    console.log(`[hyperviking-mcp] identity: ${IDENTITY || 'ephemeral'}`)
  })
}

/* -- Main --------------------------------------------------------------- */

async function main (): Promise<void> {
  const log = (msg: string) => process.stderr.write(`[hyperviking-mcp] ${msg}\n`)
  log(`connecting to ${SERVER_KEY.slice(0, 12)}...${HTTP_MODE ? ` (HTTP mode, port ${HTTP_PORT})` : ''}`)

  let client: HyperVikingClient
  try {
    client = await createClient({
      name: IDENTITY || 'mcp',
      ephemeral: !IDENTITY,
      serverPublicKey: SERVER_KEY,
      connectTimeout: 30000
    })
    log('connected')
  } catch (err) {
    log(`connection failed: ${(err as Error).message}`)
    process.exit(1)
  }

  if (HTTP_MODE) {
    startHttp(client, HTTP_PORT)
  } else {
    startStdio(client)
  }

  process.on('SIGINT', async () => { await client.close(); process.exit(0) })
  process.on('SIGTERM', async () => { await client.close(); process.exit(0) })
}

main().catch((err: unknown) => {
  process.stderr.write(`[hyperviking-mcp] fatal: ${(err as Error).message}\n`)
  process.exit(1)
})
