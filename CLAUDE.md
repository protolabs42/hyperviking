# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

HyperViking is an encrypted P2P transport layer for OpenViking knowledge bases. Agents connect by 32-byte public key over Noise-encrypted Hyperswarm connections — no ports, DNS, or TLS needed. The server proxies JSON-RPC 2.0 calls to a local OpenViking HTTP API.

## Commands

```bash
# Build (TypeScript → dist/)
npm run build

# Run all tests (requires build first; e2e tests need OpenViking on localhost:1933)
npm test

# Run a single test file
node --test test/rbac.test.js

# Start server (simple allowlist mode)
node dist/server.js
# or: hv serve

# Start server (RBAC mode)
hv serve --roles

# Dashboard (Next.js app in dashboard/)
cd dashboard && npm run dev
```

## Architecture

### Core (src/)

The system has three layers: **transport** (Hyperswarm P2P), **protocol** (JSON-RPC 2.0 over length-prefixed frames), and **access control** (allowlist or RBAC).

- **`server.ts`** — Creates a Hyperswarm listener keyed by the server's public key. On each connection: decodes JSON-RPC frames, runs the RBAC middleware stack (member check → rate limit → permission check → route), then either handles `hv.*` methods internally or proxies `ov.*` methods to OpenViking's HTTP API. The `proxyToOpenViking` function maps RPC method names to OpenViking REST routes.

- **`client.ts`** — Connects to a server by public key via Hyperswarm topic join. Maintains a pending request map keyed by JSON-RPC id with timeout handling. Exposes convenience methods (`health`, `ls`, `find`, `read`, etc.) that delegate to `call(method, params)`.

- **`protocol.ts`** — Wire format: 4-byte LE length prefix + JSON payload. Provides `encode`, `Decoder` (streaming parser), `request`, `response`, `error` helpers. All messages are JSON-RPC 2.0.

- **`mcp.ts`** — MCP stdio server (newline-delimited JSON-RPC on stdin/stdout, logging to stderr). Defines 28 tool schemas and a `TOOL_RPC` mapping table that translates MCP tool names (`viking_*`) to internal RPC methods (`ov.*` / `hv.*`). Zero extra dependencies.

- **`proxy.ts`** — Local HTTP server that translates OpenViking REST API paths back to HyperViking RPC calls. Lets existing `ov` CLI tools work through the P2P tunnel.

- **`cli.ts`** — Entry point for the `hv` binary. Dispatches to subcommands. The `connect` command creates a client, runs a single RPC call, prints JSON, and exits.

### Access Control

Two modes, selected at server start:

- **Simple mode** (default): Binary allowlist loaded from `~/.hyperviking/allowlist.json`. Unknown peers rejected at Hyperswarm firewall level.

- **RBAC mode** (`--roles`): Three-tier roles (reader/contributor/admin) with a permission matrix in `roles.ts`. Includes audit logging (`audit.ts`, append-only JSONL), rate limiting (`ratelimit.ts`, per-peer sliding window), and hot-reload of `members.json` via fs.watch.

The permission matrix is defined as nested Sets in `roles.ts` — `READER_METHODS` ⊂ `CONTRIBUTOR_METHODS` ⊂ `ADMIN_METHODS`.

### Join Requests (`requests.ts`)

Self-service join flow: submit request with ETH address → pending → approved/denied. Denied requests have a 7-day cooldown. Keyed by lowercase ETH address.

### Dashboard (dashboard/)

Next.js 16 app with React 19, Tailwind 4, shadcn/ui, SIWE (Sign-In with Ethereum). Community management interface for the RBAC server. Uses `community.default.json` for server-rendered config.

### State Files

All state lives in `~/.hyperviking/`:
- `keys/*.json` — Ed25519 keypairs (public + secret)
- `allowlist.json` — Simple mode peer list
- `members.json` — RBAC role list
- `audit.jsonl` — Append-only audit log
- `openviking/` — Docker Compose setup for OpenViking

## RPC Method Naming

- `ov.*` — Proxied to OpenViking HTTP API (e.g., `ov.find` → `POST /api/v1/search/find`)
- `hv.*` — Handled internally by the server (e.g., `hv.whoami`, `hv.add-member`)

### v0.5.0 new methods

- `ov.write` → `POST /api/v1/content/write` (replace/append existing files, contributor+)
- `ov.session.used` → `POST /sessions/{id}/used` (record context/skill usage)
- `ov.task.status` → `GET /api/v1/tasks/{id}` (poll async task completion)
- `ov.stats.memories` → `GET /api/v1/stats/memories` (memory health stats)
- `ov.session.stats` → `GET /api/v1/stats/sessions/{id}` (session extraction stats)
- `ov.find` now accepts `include_provenance` for retrieval trajectory
- `ov.session.commit` is now async — returns `{ status, task_id }`, use `ov.task.status` to poll
- `ov.session.get` now accepts `auto_create` param (upstream no longer auto-creates)

## Upstream License

OpenViking changed to AGPL-3.0 in March 2026. HyperViking connects over HTTP and does not embed OpenViking code, so AGPL does not propagate. The `ov` CLI remains Apache 2.0.

## Testing

Tests use Node.js built-in test runner (`node:test` + `node:assert/strict`). Tests import from `dist/` so you must build first.

- `test/rbac.test.js` — Unit tests for roles, permissions, audit, rate limiter, and join requests. Runs without OpenViking.
- `test/e2e.test.js` — Integration tests that create real Hyperswarm server+client pairs. Requires OpenViking running on `localhost:1933`. Skips gracefully if unavailable.

## Key Dependencies

Only 4 runtime deps: `hyperswarm` (P2P connections), `hyperdht` (DHT + Noise encryption), `b4a` (buffer utils), `compact-encoding` (wire format). Custom type declarations for hyperswarm and hyperdht live in `src/types/`.
