import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { listMembers, addMember, removeMember, updateRole } from '@/lib/data'
import { AddMemberInputSchema, UpdateRoleInputSchema } from '@/lib/schemas'

function requireAdmin (session: { status: string } | null) {
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.status !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  return null
}

export async function GET () {
  const session = await getSession()
  const err = requireAdmin(session)
  if (err) return err
  return NextResponse.json({ members: listMembers() })
}

export async function POST (req: Request) {
  const session = await getSession()
  const err = requireAdmin(session)
  if (err) return err

  const parsed = AddMemberInputSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  const { pubkey, role, name, eth } = parsed.data
  addMember(pubkey, { role, name, eth, addedAt: new Date().toISOString(), addedBy: session!.eth })
  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function PUT (req: Request) {
  const session = await getSession()
  const err = requireAdmin(session)
  if (err) return err

  const url = new URL(req.url)
  const pubkey = url.searchParams.get('pubkey')
  if (!pubkey) return NextResponse.json({ error: 'pubkey required' }, { status: 400 })

  const parsed = UpdateRoleInputSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 })

  if (!updateRole(pubkey, parsed.data.role)) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE (req: Request) {
  const session = await getSession()
  const err = requireAdmin(session)
  if (err) return err

  const url = new URL(req.url)
  const pubkey = url.searchParams.get('pubkey')
  if (!pubkey) return NextResponse.json({ error: 'pubkey required' }, { status: 400 })

  if (!removeMember(pubkey)) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
