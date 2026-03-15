import { z } from 'zod'

// ── Roles ──

export const RoleSchema = z.enum(['reader', 'contributor', 'admin'])
export type Role = z.infer<typeof RoleSchema>

export const MemberSchema = z.object({
  role: RoleSchema,
  name: z.string().min(1),
  eth: z.string().optional(),
  addedAt: z.string(),
  addedBy: z.string(),
})
export type Member = z.infer<typeof MemberSchema>

export const MemberWithKeySchema = MemberSchema.extend({
  pubkey: z.string(),
})
export type MemberWithKey = z.infer<typeof MemberWithKeySchema>

export const RoleListSchema = z.object({
  members: z.record(z.string(), MemberSchema),
  updatedAt: z.string(),
})
export type RoleList = z.infer<typeof RoleListSchema>

// ── Requests ──

export const RequestStatusSchema = z.enum(['pending', 'approved', 'denied'])
export type RequestStatus = z.infer<typeof RequestStatusSchema>

export const JoinRequestSchema = z.object({
  name: z.string().min(1),
  message: z.string(),
  pubkey: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a 64-character hex key'),
  eth: z.string(),
  requestedAt: z.string(),
  status: RequestStatusSchema,
  decidedAt: z.string().optional(),
  decidedBy: z.string().optional(),
  deniedCooldownUntil: z.string().optional(),
})
export type JoinRequest = z.infer<typeof JoinRequestSchema>

// ── Auth ──

export const UserStatusSchema = z.enum(['admin', 'member', 'pending', 'denied', 'unknown'])
export type UserStatus = z.infer<typeof UserStatusSchema>

export const SessionPayloadSchema = z.object({
  eth: z.string(),
  status: UserStatusSchema,
  role: RoleSchema.optional(),
  name: z.string().optional(),
  exp: z.number(),
})
export type SessionPayload = z.infer<typeof SessionPayloadSchema>

// ── API inputs ──

export const VerifyInputSchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
})

export const AddMemberInputSchema = z.object({
  pubkey: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a 64-character hex key'),
  role: RoleSchema,
  name: z.string().min(1),
  eth: z.string().optional(),
})

export const UpdateRoleInputSchema = z.object({
  role: RoleSchema,
})

export const SubmitRequestInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  message: z.string().default(''),
  pubkey: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a 64-character hex key'),
})

export const ApproveRequestInputSchema = z.object({
  role: RoleSchema.default('reader'),
})

// ── Audit ──

export const AuditEntrySchema = z.object({
  timestamp: z.string(),
  peer: z.string(),
  peerName: z.string(),
  role: z.string(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['allowed', 'denied', 'error', 'rate-limited']),
  error: z.string().optional(),
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>
