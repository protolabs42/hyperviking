export { createServer } from './server.js'
export type { ServerOptions, HyperVikingServer, RolesConfig } from './server.js'

export { createClient } from './client.js'
export type { ClientOptions, HyperVikingClient } from './client.js'

export { generateKeypair, loadKeypair, getOrCreateKeypair, listKeys, loadAllowlist, saveAllowlist } from './keys.js'
export type { KeyPair, KeyInfo } from './keys.js'

export { encode, Decoder, request, response, error } from './protocol.js'
export type { JsonRpcRequest, JsonRpcResponse, JsonRpcMessage } from './protocol.js'

// RBAC
export { loadRoleList, saveRoleList, getMember, addMember, removeMember, updateRole, listMembers, isAllowed, getAllowedMethods } from './roles.js'
export type { Role, Member, RoleList } from './roles.js'

export { AuditLog } from './audit.js'
export type { AuditEntry } from './audit.js'

export { RateLimiter } from './ratelimit.js'

export { loadRequests, saveRequests, getRequest, submitRequest, approveRequest, denyRequest, listPendingRequests, listAllRequests } from './requests.js'
export type { RequestStatus, JoinRequest, RequestStore } from './requests.js'

export { setupServer, selfUpdate, doctor } from './setup.js'
