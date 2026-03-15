import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveUserStatus, getServerPubkey } from '@/lib/data'

export async function GET () {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { status, role, name } = resolveUserStatus(session.eth)
  return NextResponse.json({ eth: session.eth, status, role, name, serverPubkey: getServerPubkey() })
}
