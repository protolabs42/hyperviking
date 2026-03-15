---
name: hyperviking
description: Search, read, grep, and browse a shared AI knowledge brain via encrypted P2P. Supports RBAC, skills, sessions, and member management.
metadata: {"openclaw": {"requires": {"bins": ["hv"], "env": ["HV_SERVER_KEY"]}, "install": [{"type": "node", "pkg": "hyperviking", "global": true}]}}
---

# HyperViking — Encrypted P2P Knowledge Brain

You have access to a shared knowledge base through HyperViking. All commands return JSON.

## Setup Check

Before using, verify:
1. `hv` is installed: `which hv` (if missing: `curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | sh`)
2. `HV_SERVER_KEY` is set in your environment

## Commands

All commands use `hv connect` with `HV_SERVER_KEY` automatically resolved from env.

### Search & Discovery

```bash
# Semantic search — find content by meaning
hv connect find "how does auth work"
hv connect find "database patterns" 5          # limit results

# Regex/text search — exact matches
hv connect grep "function.*login"
hv connect grep "TODO" viking://resources/my-repo  # scoped to resource

# Find files by name pattern
hv connect glob "**/*.ts"
hv connect glob "test_*" viking://resources/my-repo
```

### Reading Content

```bash
# Read a file
hv connect read viking://resources/my-repo/src/index.ts

# List directory
hv connect ls
hv connect ls viking://resources/my-repo/src

# Directory tree
hv connect tree viking://resources/my-repo

# Medium-detail overview
hv connect overview viking://resources/my-repo/src

# One-line summary
hv connect abstract viking://resources/my-repo
```

### Managing Resources

```bash
# Index a local path or URL into the brain
hv connect add /path/to/project
hv connect add /path/to/project viking://resources/custom-name

# Remove a resource
hv connect remove viking://resources/old-project
```

### System

```bash
# Server health
hv connect health

# System status (vector index, VLM usage)
hv connect status

# Embedding queue progress
hv connect queue
```

## MCP Integration

If using MCP (Claude Code, Cursor, Codex), you get these tools automatically:

**Knowledge:** `viking_find`, `viking_grep`, `viking_glob`, `viking_read`, `viking_ls`, `viking_tree`, `viking_overview`, `viking_abstract`, `viking_add_resource`, `viking_remove`, `viking_health`, `viking_status`, `viking_queue`

**Skills:** `viking_add_skill`, `viking_list_skills`

**Sessions:** `viking_session_create`, `viking_session_message`, `viking_session_commit`

**Members (RBAC servers):** `viking_whoami`, `viking_members`, `viking_add_member`, `viking_remove_member`, `viking_update_role`, `viking_audit`

## Workflow Patterns

**Explore a codebase:**
```
ls → overview → find → read
```

**Find and read a specific file:**
```
glob "**/*.config.*" → read <uri>
```

**Search for a concept then dive in:**
```
find "authentication flow" → read <top-result-uri>
```

**Check what's indexed:**
```
ls → tree <resource-uri>
```

## URI Format

All content is addressed as `viking://resources/<name>/path/to/file`. The root `viking://` lists all indexed resources. Skills live at `viking://agent/skills/`.

## Output Format

All commands output JSON to stdout. Stderr contains connection status messages. Parse stdout for structured data.
