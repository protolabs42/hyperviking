# HyperViking

A shared brain for AI agents that requires nothing but a public key.

Encrypted P2P transport for [OpenViking](https://github.com/volcengine/OpenViking) knowledge bases. Agents connect by public key, search by meaning, read files, grep code — all through Noise-encrypted peer-to-peer connections. No ports exposed. No DNS. No TLS certificates. No Kubernetes.

```
┌─────────────────┐         Noise-encrypted P2P         ┌──────────────────┐
│   Your Agent    │ ◄──────────────────────────────────► │  HyperViking     │
│  (Claude Code,  │        NAT-traversing                │  Server          │
│   Cursor, etc.) │        Pubkey identity                │                  │
│                 │        RBAC / Allowlist               │  ┌────────────┐  │
│  22 MCP tools   │                                      │  │ OpenViking │  │
└─────────────────┘                                      │  │ (knowledge)│  │
                                                         │  └────────────┘  │
                                                         └──────────────────┘
```

## For AI Agents

### Quick Decision

- **Running your own brain?** → [Path 1: Local Brain](#path-1-local-brain)
- **Connecting to someone else's brain?** → [Path 2: Shared Brain](#path-2-shared-brain-vps)
- **Running a community brain with roles?** → [Path 3: Community Brain](#path-3-community-brain-rbac)

### Path 1: Local Brain

You run both OpenViking and HyperViking on your machine.

```bash
# 1. Install OpenViking (the knowledge engine)
#    See: https://github.com/volcengine/OpenViking

# 2. Install HyperViking (the P2P transport)
curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | bash

# 3. Set up server identity and start
hv init --server
hv serve

# 4. Set up agent identity (on the same or different machine)
hv init
# Copy the agent's public key and allowlist it:
hv allow <agent-pubkey>

# 5. Configure your integration (see below)
```

### Path 2: Shared Brain (VPS)

Someone else runs the brain. You just connect.

**Server operator:**
```bash
# On the VPS
curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | bash
hv init --server
hv serve
# Allowlist agents as they request access
hv allow <agent-pubkey-1> <agent-pubkey-2>
```

**Agent (you):**
```bash
curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | bash
hv init
# Send your public key to the server operator to get allowlisted
```

### Path 3: Community Brain (RBAC)

Run a brain with role-based access control — readers, contributors, and admins.

**Server operator:**
```bash
curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | bash
hv init --server

# Add yourself as admin
hv add-member <your-pubkey> admin "Your Name"

# Add members with appropriate roles
hv add-member <agent-pubkey> reader "Agent Name"
hv add-member <contributor-pubkey> contributor "Contributor Name"

# Start with RBAC mode
hv serve --roles
```

**Roles:**
| Role | Can do |
|------|--------|
| **reader** | Search, read, browse, list skills |
| **contributor** | + add resources, add skills, create sessions |
| **admin** | + delete resources, manage members, view audit log |

### Integration

| Platform | Method | Setup |
|----------|--------|-------|
| Claude Code / Cursor | MCP (stdio, JSON) | `settings.json` or `mcp.json` |
| Codex | MCP (stdio, TOML) | `~/.codex/config.toml` |
| OpenClaw | Skill (exec) | SKILL.md + `HV_SERVER_KEY` env |
| Any CLI agent | Direct exec | `hv connect` commands |

**Claude Code** (`~/.claude/settings.json`) or **Cursor** (`mcp.json`):

```json
{
  "mcpServers": {
    "hyperviking": {
      "command": "hv",
      "args": ["mcp", "<SERVER_PUBKEY>"]
    }
  }
}
```

Or with env var (no key in config):

```json
{
  "mcpServers": {
    "hyperviking": {
      "command": "hv",
      "args": ["mcp"],
      "env": { "HV_SERVER_KEY": "<SERVER_PUBKEY>" }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.hyperviking]
command = "hv"
args = ["mcp", "<SERVER_PUBKEY>"]
```

**OpenClaw** — add `hyperviking` to your skills list. HyperViking ships with `SKILL.md`. Set `HV_SERVER_KEY` in your OpenClaw env config.

**Direct CLI:**

```bash
export HV_SERVER_KEY=<SERVER_PUBKEY>
hv connect health
hv connect find "authentication patterns"
hv connect read viking://resources/my-repo/src/auth.ts
```

## For Humans

### What Is This?

HyperViking wraps [OpenViking](https://github.com/volcengine/OpenViking) — a knowledge base that indexes codebases, documents, and URLs for semantic search — with encrypted P2P transport. Instead of exposing OpenViking's HTTP API to the internet, agents connect through Noise-encrypted tunnels using only a 32-byte public key as the address.

Your agent gets 22 tools (search, read, grep, glob, tree, overview, skills, sessions, member management, and more) through any of three integration methods: MCP for Claude Code/Cursor, SKILL.md for OpenClaw, or direct CLI for anything with a shell.

### Install

**macOS / Linux / WSL:**
```bash
curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.ps1 | iex
```

**Manual (any OS):**
```bash
git clone https://github.com/protolabs42/hyperviking.git ~/.hyperviking/repo
cd ~/.hyperviking/repo && npm install && npm run build
# Add ~/.hyperviking/repo/dist/cli.js to your PATH as "hv"
```

### MCP Tools

Once connected, your agent gets these tools:

**Knowledge:**

| Tool | Description |
|------|-------------|
| `viking_find` | Semantic search — ask in natural language, get ranked results |
| `viking_grep` | Exact text/regex search across indexed content |
| `viking_glob` | Find files by name pattern (`**/*.py`, `test_*.ts`) |
| `viking_read` | Read the full content of a file |
| `viking_ls` | List directory contents |
| `viking_tree` | Full directory tree |
| `viking_overview` | Medium-detail overview of a directory |
| `viking_abstract` | One-line summary of any file or directory |
| `viking_add_resource` | Index a local path or URL into the knowledge base |
| `viking_remove` | Remove a resource from the knowledge base |
| `viking_health` | Check server health |
| `viking_status` | System status (vector index, VLM usage) |
| `viking_queue` | Embedding processing queue status |

**Skills:**

| Tool | Description |
|------|-------------|
| `viking_add_skill` | Add a skill to the knowledge base |
| `viking_list_skills` | List all indexed skills |

**Sessions:**

| Tool | Description |
|------|-------------|
| `viking_session_create` | Create a conversational session |
| `viking_session_message` | Add a message to a session |
| `viking_session_commit` | Commit session to knowledge base |

**Member Management (RBAC mode):**

| Tool | Description |
|------|-------------|
| `viking_whoami` | Your identity on this server |
| `viking_members` | List all members |
| `viking_add_member` | Add a member (admin only) |
| `viking_remove_member` | Remove a member (admin only) |
| `viking_update_role` | Change a member's role (admin only) |
| `viking_audit` | View recent audit log (admin only) |

### CLI Reference

```bash
# Setup
hv init                                First-time agent setup (keygen + config help)
hv init --server                       First-time server setup

# Server
hv serve [--ov-url=URL]                Start server with simple allowlist
hv serve --roles [--ov-url=URL]        Start server with RBAC (roles + audit + rate limiting)
hv allow <key1> [key2] ...             Set peer allowlist (simple mode)

# Members (RBAC mode)
hv add-member <pubkey> <role> <name>   Add member (reader/contributor/admin)
hv remove-member <pubkey>              Remove member
hv update-role <pubkey> <role>         Change member's role
hv members                             List all members

# Agent (MCP)
hv mcp [server-key]                    MCP stdio server (for Claude Code / Cursor)
hv proxy [server-key] [--port=1934]    Local HTTP proxy

# CLI (all accept HV_SERVER_KEY env var instead of <server-key>)
hv connect [server-key]                Connect and check health
hv connect [server-key] ls [uri]       List directory contents
hv connect [server-key] find <query>   Semantic search
hv connect [server-key] read <uri>     Read file content
hv connect [server-key] grep <pat>     Regex search across content
hv connect [server-key] glob <pat>     Find files by name pattern
hv connect [server-key] tree <uri>     Full directory tree
hv connect [server-key] overview <uri> Medium-detail directory overview
hv connect [server-key] abstract <uri> One-line summary
hv connect [server-key] status         System status (vectors, VLM)
hv connect [server-key] health         Server health check
hv connect [server-key] queue          Embedding queue status
hv connect [server-key] add <path> [target]  Index a path into the brain
hv connect [server-key] remove <uri>   Remove a resource

# Keys
hv keygen [name]                       Generate keypair
hv keys                                List all keypairs
```

### Access Control

HyperViking supports two access control modes:

**Simple mode** (default) — Binary allowlist. Peers are either in or out.
```bash
hv allow <pubkey-1> <pubkey-2>
hv serve
```

**RBAC mode** — Three-tier role-based access with audit logging and rate limiting.
```bash
hv add-member <pubkey> admin "Alice"
hv add-member <pubkey> contributor "Bob"
hv add-member <pubkey> reader "Charlie"
hv serve --roles
```

RBAC mode provides:
- **Permission matrix** — readers can only search/read, contributors can add content, admins can manage everything
- **Audit logging** — every request logged to append-only JSONL
- **Rate limiting** — per-peer throttling (100/min reader, 200/min contributor, unlimited admin)
- **Hot-reload** — members.json changes picked up automatically
- **Member management** — add/remove/update roles via CLI or MCP

### Security Model

- **Noise protocol** — Curve25519 key exchange + ChaCha20-Poly1305 encryption
- **Identity** — 32-byte Ed25519 public keys. No usernames, no passwords, no tokens
- **Firewall** — Allowlist/RBAC-gated. Unknown peers rejected at the protocol level before handshake completes
- **NAT-traversing** — Works behind firewalls and NATs via Hyperswarm DHT hole-punching
- **Zero exposure** — No ports opened, no DNS records, no TLS certificates needed
- **Audit trail** — Every request logged with peer identity, role, method, and status

### Architecture

HyperViking is a thin encrypted transport layer over OpenViking:

1. **Server** listens on Hyperswarm DHT with a public key as its address
2. **Clients** connect by knowing the server's public key — no URL, no IP, no port
3. **Protocol** is JSON-RPC 2.0 over length-prefixed frames on Noise-encrypted streams
4. **Server proxies** RPC calls to OpenViking's local HTTP API
5. **MCP mode** speaks Model Context Protocol over stdio, tunneling through the P2P layer

```
Agent MCP Host (Claude Code)
  └─ stdin/stdout ─► hv mcp (MCP stdio server)
                       └─ Hyperswarm ─► HyperViking Server
                                          └─ HTTP ─► OpenViking (localhost:1933)
```

### Dependencies

4 packages. That's it.

- `hyperswarm` — P2P connection brokering via DHT
- `hyperdht` — Distributed hash table + Noise encryption
- `b4a` — Buffer utilities
- `compact-encoding` — Wire format encoding

### Requirements

- Node.js 18+
- OpenViking running on the server machine

## License

MIT
