import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// ── Types ──

export type Role = 'reader' | 'contributor' | 'admin'

export interface Member {
  role: Role
  name: string
  eth?: string
  addedAt: string
  addedBy: string
}

export interface RoleList {
  members: Record<string, Member> // keyed by hyperswarm pubkey hex
  updatedAt: string
}

// ── Permission matrix ──

const READER_METHODS = new Set([
  'ov.health', 'ov.ls', 'ov.find', 'ov.read', 'ov.overview',
  'ov.abstract', 'ov.grep', 'ov.glob', 'ov.tree', 'ov.status',
  'ov.observer.queue', 'ov.observer.system', 'ov.observer.vikingdb',
  'ov.list-skills', 'ov.read-skill',
  'ov.session.get', 'ov.session.list',
  'hv.whoami', 'hv.members'
])

const CONTRIBUTOR_METHODS = new Set([
  ...READER_METHODS,
  'ov.add-resource', 'ov.add-skill',
  'ov.session.create', 'ov.session.message', 'ov.session.commit'
])

const ADMIN_METHODS = new Set([
  ...CONTRIBUTOR_METHODS,
  'ov.delete',
  'hv.add-member', 'hv.remove-member', 'hv.update-role', 'hv.audit'
])

const ROLE_METHODS: Record<Role, Set<string>> = {
  reader: READER_METHODS,
  contributor: CONTRIBUTOR_METHODS,
  admin: ADMIN_METHODS
}

// ── Role list management ──

export function loadRoleList (path: string): RoleList {
  if (!existsSync(path)) {
    return { members: {}, updatedAt: new Date().toISOString() }
  }
  return JSON.parse(readFileSync(path, 'utf8')) as RoleList
}

export function saveRoleList (path: string, roleList: RoleList): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  roleList.updatedAt = new Date().toISOString()
  writeFileSync(path, JSON.stringify(roleList, null, 2))
}

export function getMember (roleList: RoleList, pubkey: string): Member | null {
  return roleList.members[pubkey] ?? null
}

export function addMember (roleList: RoleList, pubkey: string, member: Member): void {
  roleList.members[pubkey] = member
}

export function removeMember (roleList: RoleList, pubkey: string): boolean {
  if (!(pubkey in roleList.members)) return false
  delete roleList.members[pubkey]
  return true
}

export function updateRole (roleList: RoleList, pubkey: string, role: Role): boolean {
  const member = roleList.members[pubkey]
  if (!member) return false
  member.role = role
  return true
}

export function listMembers (roleList: RoleList): Array<{ pubkey: string } & Member> {
  return Object.entries(roleList.members).map(([pubkey, m]) => ({ pubkey, ...m }))
}

// ── Authorization ──

export function isAllowed (role: Role, method: string): boolean {
  const allowed = ROLE_METHODS[role]
  return allowed ? allowed.has(method) : false
}

export function getAllowedMethods (role: Role): string[] {
  const allowed = ROLE_METHODS[role]
  return allowed ? [...allowed] : []
}
