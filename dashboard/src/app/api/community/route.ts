import { NextResponse } from 'next/server'
import { getCommunityConfig } from '@/lib/community'

export async function GET () {
  return NextResponse.json(getCommunityConfig())
}
