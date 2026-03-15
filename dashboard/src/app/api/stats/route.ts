import { NextResponse } from 'next/server'
import { listMembers, ovFetch } from '@/lib/data'

export async function GET () {
  const members = listMembers()
  let resourceCount = 0
  let protocolCount = 0

  try {
    const res = await ovFetch('/api/v1/fs/ls?uri=viking://resources/&limit=256')
    const entries = res.result || res
    if (Array.isArray(entries)) resourceCount = entries.length
  } catch {}

  try {
    const res = await ovFetch('/api/v1/fs/ls?uri=viking://resources/protocols/&limit=256')
    const entries = res.result || res
    if (Array.isArray(entries)) protocolCount = entries.length
  } catch {}

  return NextResponse.json({
    members: members.length,
    roles: {
      admin: members.filter(m => m.role === 'admin').length,
      contributor: members.filter(m => m.role === 'contributor').length,
      reader: members.filter(m => m.role === 'reader').length,
    },
    resources: resourceCount,
    protocols: protocolCount,
  })
}
