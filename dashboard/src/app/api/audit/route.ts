import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { readAuditLog } from '@/lib/data'

export async function GET (req: Request) {
  const session = await getSession()
  if (!session || session.status !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }
  const url = new URL(req.url)
  const count = parseInt(url.searchParams.get('count') ?? '100', 10)
  return NextResponse.json({ entries: readAuditLog(count) })
}
