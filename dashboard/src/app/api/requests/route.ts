import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listAllRequests, submitRequest, approveRequest, denyRequest, addMember, resolveUserStatus } from '@/lib/data'
import { SubmitRequestInputSchema, ApproveRequestInputSchema } from '@/lib/schemas'

export async function GET () {
  const session = await getSession()
  if (!session || session.status !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }
  return NextResponse.json({ requests: listAllRequests() })
}

export async function POST (req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const eth = url.searchParams.get('eth')

  // Admin actions: approve/deny
  if (action === 'approve' && eth) {
    if (session.status !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })
    const parsed = ApproveRequestInputSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

    const approved = approveRequest(eth, session.eth)
    if (!approved) return NextResponse.json({ error: 'No pending request' }, { status: 404 })

    addMember(approved.pubkey, {
      role: parsed.data.role,
      name: approved.name,
      eth: approved.eth,
      addedAt: new Date().toISOString(),
      addedBy: session.eth,
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'deny' && eth) {
    if (session.status !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })
    const denied = denyRequest(eth, session.eth)
    if (!denied) return NextResponse.json({ error: 'No pending request' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  // Community action: submit request
  const { status } = resolveUserStatus(session.eth)
  if (status === 'admin' || status === 'member') {
    return NextResponse.json({ error: 'Already a member' }, { status: 400 })
  }

  const parsed = SubmitRequestInputSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const result = submitRequest(session.eth, parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, status: 'pending' }, { status: 201 })
}
