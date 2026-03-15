// Server setup — installs OpenViking (Docker), configures HyperViking, starts everything

import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getOrCreateKeypair } from './keys.js'
import { loadRoleList, saveRoleList, addMember } from './roles.js'
import b4a from 'b4a'

const HV_DIR = join(homedir(), '.hyperviking')
const OV_DIR = join(HV_DIR, 'openviking')
const DATA_DIR = join(HV_DIR, 'data')
const MEMBERS_PATH = join(HV_DIR, 'members.json')

// ── Prompts ──

function ask (question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function askSecret (question: string): Promise<string> {
  process.stderr.write(question)
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (ch: string) => {
      if (ch === '\n' || ch === '\r') {
        process.stdin.setRawMode?.(false)
        process.stdin.pause()
        process.stderr.write('\n')
        resolve(buf.trim())
      } else if (ch === '\u007f' || ch === '\b') {
        buf = buf.slice(0, -1)
      } else {
        buf += ch
      }
    })
  })
}

// ── Checks ──

function hasCommand (cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    // Windows fallback
    try {
      execSync(`where ${cmd}`, { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
}

async function waitForHealth (url: string, retries = 12, intervalMs = 5000): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) return true
    } catch {}
    if (i < retries - 1) {
      process.stderr.write('.')
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }
  return false
}

// ── Docker Compose ──

function generateDockerCompose (apiKey: string): string {
  return `services:
  openviking:
    image: python:3.12-slim
    volumes:
      - openviking-src:/app
      - openviking-data:/data
      - ./ov.conf:/root/.openviking/ov.conf:ro
    ports:
      - "127.0.0.1:1933:1933"
    working_dir: /app
    command: >
      bash -c "
        if [ ! -f /app/setup.py ] && [ ! -f /app/pyproject.toml ]; then
          apt-get update -qq && apt-get install -y -qq git build-essential cmake > /dev/null 2>&1 &&
          git clone --depth 1 https://github.com/volcengine/openviking.git /app
        fi &&
        pip install -e '.[all]' --quiet &&
        python -m openviking.server.bootstrap --host 0.0.0.0 --port 1933
      "
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:1933/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped

volumes:
  openviking-src:
  openviking-data:
`
}

function generateOvConf (apiKey: string): string {
  return JSON.stringify({
    storage: { workspace: '/data' },
    log: { level: 'INFO', output: 'stdout' },
    embedding: {
      dense: {
        api_base: 'https://api.openai.com/v1',
        api_key: apiKey,
        provider: 'openai',
        dimension: 3072,
        model: 'text-embedding-3-large'
      },
      max_concurrent: 10
    }
  }, null, 2)
}

// ── Main setup ──

export async function setupServer (solo: boolean = false): Promise<void> {
  console.log('')
  console.log('HyperViking Server Setup')
  console.log('════════════════════════')
  console.log('')

  // ── Check prerequisites ──

  const hasDocker = hasCommand('docker')
  if (!hasDocker) {
    console.log('Docker is required to run OpenViking.')
    console.log('')
    console.log('Install Docker:')
    console.log('  macOS:   brew install --cask docker')
    console.log('  Linux:   curl -fsSL https://get.docker.com | sh')
    console.log('  Windows: https://docs.docker.com/desktop/install/windows-install/')
    console.log('')
    process.exit(1)
  }

  // Check docker is running
  try {
    execSync('docker info', { stdio: 'ignore' })
  } catch {
    console.log('Docker is installed but not running. Start Docker first.')
    process.exit(1)
  }

  // Check docker compose
  let composeCmd = 'docker compose'
  try {
    execSync('docker compose version', { stdio: 'ignore' })
  } catch {
    try {
      execSync('docker-compose --version', { stdio: 'ignore' })
      composeCmd = 'docker-compose'
    } catch {
      console.log('Docker Compose not found. Install it: https://docs.docker.com/compose/install/')
      process.exit(1)
    }
  }

  // ── Gather info ──

  console.log('This will set up:')
  console.log('  1. OpenViking (knowledge engine) via Docker')
  console.log('  2. HyperViking (encrypted P2P transport)')
  if (!solo) console.log('  3. RBAC with you as admin')
  console.log('')

  const name = await ask('Your name: ')
  if (!name) { console.log('Name is required.'); process.exit(1) }

  console.log('')
  console.log('OpenViking needs an embedding API key for semantic search.')
  console.log('Get one at: https://platform.openai.com/api-keys')
  console.log('')
  const apiKey = await ask('OpenAI API key: ')
  if (!apiKey) { console.log('API key is required.'); process.exit(1) }

  // ── Create directories ──

  mkdirSync(OV_DIR, { recursive: true })
  mkdirSync(DATA_DIR, { recursive: true })

  // ── Generate configs ──

  console.log('')
  console.log('Generating configs...')

  writeFileSync(join(OV_DIR, 'docker-compose.yml'), generateDockerCompose(apiKey))
  writeFileSync(join(OV_DIR, 'ov.conf'), generateOvConf(apiKey))

  // ── Start OpenViking ──

  console.log('Starting OpenViking (first run may take a few minutes)...')
  console.log('')

  try {
    execSync(`${composeCmd} up -d`, { cwd: OV_DIR, stdio: 'inherit' })
  } catch (err) {
    console.log('')
    console.log('Failed to start OpenViking. Check Docker is running.')
    process.exit(1)
  }

  // ── Wait for health ──

  process.stderr.write('Waiting for OpenViking to be ready')
  const healthy = await waitForHealth('http://127.0.0.1:1933')
  if (!healthy) {
    console.log('')
    console.log('OpenViking did not become healthy in time.')
    console.log(`Check logs: ${composeCmd} logs -f (in ${OV_DIR})`)
    process.exit(1)
  }
  console.log(' ready!')
  console.log('')

  // ── Generate server keypair ──

  const kp = getOrCreateKeypair('server')
  const pubKeyHex = b4a.toString(kp.publicKey, 'hex')
  console.log(`Server public key: ${pubKeyHex}`)

  // ── Setup access control ──

  if (solo) {
    // Simple allowlist — just allow own key
    const clientKp = getOrCreateKeypair('default')
    const clientPubHex = b4a.toString(clientKp.publicKey, 'hex')
    const { saveAllowlist } = await import('./keys.js')
    saveAllowlist(join(HV_DIR, 'allowlist.json'), new Set([clientPubHex]))
    console.log(`Allowlisted your key: ${clientPubHex.slice(0, 12)}...`)
  } else {
    // RBAC — add operator as admin
    const clientKp = getOrCreateKeypair('default')
    const clientPubHex = b4a.toString(clientKp.publicKey, 'hex')
    const roleList = loadRoleList(MEMBERS_PATH)
    addMember(roleList, clientPubHex, {
      role: 'admin',
      name,
      addedAt: new Date().toISOString(),
      addedBy: 'setup'
    })
    saveRoleList(MEMBERS_PATH, roleList)
    console.log(`Added you as admin: ${name} (${clientPubHex.slice(0, 12)}...)`)
  }

  // ── Print summary ──

  console.log('')
  console.log('════════════════════════════════════════════════')
  console.log('  Setup complete!')
  console.log('════════════════════════════════════════════════')
  console.log('')
  console.log('Start the server:')
  if (solo) {
    console.log('  hv serve')
  } else {
    console.log('  hv serve --roles')
  }
  console.log('')
  console.log('Your server pubkey:')
  console.log(`  ${pubKeyHex}`)
  console.log('')

  if (!solo) {
    console.log('Add members:')
    console.log('  hv add-member <pubkey> reader "Name"')
    console.log('')
    console.log('Members connect with:')
    console.log(`  hv mcp ${pubKeyHex}`)
    console.log('')
  } else {
    console.log('Connect from any machine:')
    console.log(`  hv mcp ${pubKeyHex}`)
    console.log('')
  }

  console.log('MCP config (Claude Code / Cursor):')
  console.log('  {')
  console.log('    "mcpServers": {')
  console.log('      "hyperviking": {')
  console.log('        "command": "hv",')
  console.log(`        "args": ["mcp", "${pubKeyHex}"]`)
  console.log('      }')
  console.log('    }')
  console.log('  }')
  console.log('')
  console.log('Manage OpenViking:')
  console.log(`  ${composeCmd} logs -f    (in ${OV_DIR})`)
  console.log(`  ${composeCmd} restart`)
  console.log(`  ${composeCmd} down`)
}

// ── Self-update ──

export async function selfUpdate (): Promise<void> {
  // Find install directory
  const cliPath = new URL('.', import.meta.url).pathname
  // cli.js is in dist/, repo root is one level up
  const repoDir = join(cliPath, '..')

  if (!existsSync(join(repoDir, '.git'))) {
    console.log('Cannot update: not installed from git.')
    console.log('Reinstall: curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | sh')
    process.exit(1)
  }

  // Get current version
  let oldVersion = 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'))
    oldVersion = pkg.version
  } catch {}

  console.log(`Current version: ${oldVersion}`)
  console.log('Checking for updates...')

  try {
    execSync('git pull --ff-only', { cwd: repoDir, stdio: 'inherit' })
  } catch {
    try {
      execSync('git pull', { cwd: repoDir, stdio: 'inherit' })
    } catch (err) {
      console.error('Failed to pull updates:', (err as Error).message)
      process.exit(1)
    }
  }

  console.log('Installing dependencies...')
  execSync('npm install --ignore-scripts', { cwd: repoDir, stdio: 'ignore' })

  console.log('Building...')
  execSync('npm run build', { cwd: repoDir, stdio: 'ignore' })

  console.log('Pruning...')
  execSync('npm prune --production', { cwd: repoDir, stdio: 'ignore' })

  // Get new version
  let newVersion = 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf8'))
    newVersion = pkg.version
  } catch {}

  if (oldVersion === newVersion) {
    console.log(`Already up to date (v${newVersion})`)
  } else {
    console.log(`Updated: v${oldVersion} → v${newVersion}`)
  }
}

// ── Doctor ──

export async function doctor (): Promise<void> {
  console.log('HyperViking Doctor')
  console.log('══════════════════')
  console.log('')

  let issues = 0

  // Check Node.js
  const nodeVersion = process.versions.node
  const nodeMajor = parseInt(nodeVersion.split('.')[0])
  if (nodeMajor >= 18) {
    console.log(`  ok   Node.js v${nodeVersion}`)
  } else {
    console.log(`  WARN Node.js v${nodeVersion} (18+ recommended)`)
    issues++
  }

  // Check Docker
  if (hasCommand('docker')) {
    try {
      execSync('docker info', { stdio: 'ignore' })
      console.log('  ok   Docker running')
    } catch {
      console.log('  WARN Docker installed but not running')
      issues++
    }
  } else {
    console.log('  info Docker not installed (needed for server setup)')
  }

  // Check keys
  const serverKeyPath = join(HV_DIR, 'keys', 'server.json')
  if (existsSync(serverKeyPath)) {
    console.log('  ok   Server keypair exists')
  } else {
    console.log('  info No server keypair (run: hv init --server)')
  }

  const defaultKeyPath = join(HV_DIR, 'keys', 'default.json')
  if (existsSync(defaultKeyPath)) {
    console.log('  ok   Agent keypair exists')
  } else {
    console.log('  info No agent keypair (run: hv init)')
  }

  // Check RBAC
  if (existsSync(MEMBERS_PATH)) {
    try {
      const rl = loadRoleList(MEMBERS_PATH)
      const count = Object.keys(rl.members).length
      console.log(`  ok   Members: ${count}`)
    } catch {
      console.log('  WARN members.json exists but is invalid')
      issues++
    }
  } else {
    console.log('  info No members.json (RBAC not configured)')
  }

  // Check OpenViking
  try {
    const res = await fetch('http://127.0.0.1:1933/health')
    if (res.ok) {
      console.log('  ok   OpenViking healthy (localhost:1933)')
    } else {
      console.log(`  WARN OpenViking returned ${res.status}`)
      issues++
    }
  } catch {
    console.log('  info OpenViking not running on localhost:1933')
  }

  // Check OpenViking Docker
  if (existsSync(join(OV_DIR, 'docker-compose.yml'))) {
    try {
      const output = execSync('docker compose ps --format json', { cwd: OV_DIR }).toString()
      if (output.includes('running')) {
        console.log('  ok   OpenViking Docker container running')
      } else {
        console.log('  WARN OpenViking Docker container not running')
        issues++
      }
    } catch {
      console.log('  info OpenViking Docker setup exists but status unknown')
    }
  }

  console.log('')
  if (issues === 0) {
    console.log('No issues found.')
  } else {
    console.log(`${issues} issue(s) found.`)
  }
}
