import { NextResponse } from 'next/server'
import { SiweMessage } from 'siwe'
import { consumeNonce, createToken, makeSessionPayload } from '@/lib/auth'
import { resolveUserStatus } from '@/lib/data'
import { VerifyInputSchema } from '@/lib/schemas'

export async function POST (req: Request) {
  try {
    const body = VerifyInputSchema.parse(await req.json())
    const siwe = new SiweMessage(body.message)
    const result = await siwe.verify({ signature: body.signature })

    if (!result.success) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    if (!consumeNonce(siwe.nonce)) {
      return NextResponse.json({ error: 'Invalid or expired nonce' }, { status: 401 })
    }

    const { status, role, name } = resolveUserStatus(siwe.address)
    const payload = makeSessionPayload(siwe.address, status, role, name)
    const token = createToken(payload)

    const response = NextResponse.json({ token, status, role, name, eth: siwe.address })
    response.cookies.set('hv-session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    })
    return response
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
