import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveUserStatus, ovFetch, listMembers, readAuditLog } from '@/lib/data'

export async function GET () {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { status } = resolveUserStatus(session.eth)
  if (status !== 'admin' && status !== 'member') {
    return NextResponse.json({ error: 'Members only' }, { status: 403 })
  }

  // Build activity from audit log + recent resources
  const items: Array<{ type: string; text: string; time: string; icon: string }> = []

  // Recent audit entries (resource additions, member joins)
  try {
    const entries = readAuditLog(50)
    for (const e of entries.reverse()) {
      if (e.method === 'ov.add-resource' && e.status === 'allowed') {
        items.push({ type: 'resource', text: `${e.peerName} added a resource`, time: e.timestamp, icon: '+' })
      } else if (e.method === 'ov.add-skill' && e.status === 'allowed') {
        items.push({ type: 'skill', text: `${e.peerName} shared a skill`, time: e.timestamp, icon: '*' })
      } else if (e.method === 'ls.add-member' && e.status === 'allowed') {
        items.push({ type: 'member', text: `New member joined`, time: e.timestamp, icon: '>' })
      } else if (e.method === 'ov-update' && e.status === 'allowed') {
        items.push({ type: 'system', text: `Knowledge engine updated`, time: e.timestamp, icon: '^' })
      }
    }
  } catch {}

  // Recent protocol updates (check modTime of protocol dirs)
  try {
    const protocols = await ovFetch('/api/v1/fs/ls?uri=viking://resources/protocols/&limit=20')
    const entries = protocols.result || protocols
    if (Array.isArray(entries)) {
      for (const e of entries) {
        const name = e.uri?.split('/').filter(Boolean).pop() || e.uri
        items.push({ type: 'index', text: `${name} protocol indexed`, time: e.modTime || '', icon: '#' })
      }
    }
  } catch {}

  // Members count
  const members = listMembers()
  items.push({ type: 'stat', text: `${members.length} members in the community`, time: '', icon: '~' })

  return NextResponse.json({ items: items.slice(0, 20) })
}
