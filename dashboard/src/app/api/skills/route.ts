import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveUserStatus, ovFetch } from '@/lib/data'

export async function GET (req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { status } = resolveUserStatus(session.eth)
  if (status !== 'admin' && status !== 'member') {
    return NextResponse.json({ error: 'Members only' }, { status: 403 })
  }

  const url = new URL(req.url)
  const uri = url.searchParams.get('uri')

  // Read specific skill content
  if (uri) {
    try {
      const data = await ovFetch(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`)
      return NextResponse.json(data)
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 })
    }
  }

  // List all skills
  try {
    const data = await ovFetch('/api/v1/fs/ls?uri=viking://agent/skills/&limit=256')
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ result: [] })
  }
}
