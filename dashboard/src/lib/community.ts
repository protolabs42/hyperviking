import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CommunityConfig {
  name: string
  tagline: string
  emoji: string
  logo?: string
  description: string
  theme: string
  steps: Array<{ icon?: string; title: string; cmd?: string; description?: string }>
  features: Array<{ title: string; description: string }>
  links: Array<{ label: string; href: string }>
  footer: string
}

const DEFAULT_CONFIG: CommunityConfig = {
  name: 'HyperViking',
  tagline: 'Community Knowledge Base',
  emoji: '\ud83e\udde0',
  description: 'A shared brain for AI agents and their humans. Encrypted P2P. Just a public key.',
  theme: 'mocha',
  steps: [
    { icon: '\u2b07\ufe0f', title: 'Install', cmd: 'curl -fsSL https://raw.githubusercontent.com/protolabs42/hyperviking/main/install.sh | sh' },
    { icon: '\ud83d\udd11', title: 'Generate Key', cmd: 'hv init' },
    { icon: '\ud83e\udd1d', title: 'Get Added', description: 'Share your public key with the community admin' },
    { icon: '\ud83d\ude80', title: 'Connect', description: 'Add to your MCP config and start exploring' }
  ],
  features: [
    { title: 'Semantic Search', description: 'Find knowledge by meaning, not keywords' },
    { title: 'Encrypted P2P', description: 'Noise protocol. No ports, no DNS, no certs' },
    { title: 'Role-Based Access', description: 'Readers, contributors, and admins' }
  ],
  links: [],
  footer: ''
}

let _cached: CommunityConfig | null = null

export function getCommunityConfig (): CommunityConfig {
  if (_cached) return _cached

  const hvDir = process.env.HV_DATA_DIR || join(process.env.HOME || '/root', '.hyperviking')
  const customPath = join(hvDir, 'community.json')

  let config = { ...DEFAULT_CONFIG }

  // Load custom config if it exists
  if (existsSync(customPath)) {
    try {
      const custom = JSON.parse(readFileSync(customPath, 'utf8'))
      config = { ...DEFAULT_CONFIG, ...custom }
    } catch (err) {
      console.error('[community] failed to load custom config:', (err as Error).message)
    }
  }

  // Env var overrides (highest priority)
  if (process.env.HV_COMMUNITY_NAME) config.name = process.env.HV_COMMUNITY_NAME
  if (process.env.HV_COMMUNITY_TAGLINE) config.tagline = process.env.HV_COMMUNITY_TAGLINE
  if (process.env.HV_COMMUNITY_EMOJI) config.emoji = process.env.HV_COMMUNITY_EMOJI
  if (process.env.HV_COMMUNITY_LOGO) config.logo = process.env.HV_COMMUNITY_LOGO

  _cached = config
  return config
}
