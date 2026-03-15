import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Configure via env: HV_ADMIN_HOSTS and HV_COMMUNITY_HOSTS (comma-separated)
const ADMIN_HOSTS = (process.env.HV_ADMIN_HOSTS || 'localhost:8044').split(',').map(h => h.trim())
const COMMUNITY_HOSTS = (process.env.HV_COMMUNITY_HOSTS || 'localhost:3000').split(',').map(h => h.trim())

export function middleware (request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const { pathname } = request.nextUrl

  // API routes pass through
  if (pathname.startsWith('/api/')) return NextResponse.next()

  // Admin hostname → rewrite to /admin routes
  if (ADMIN_HOSTS.some(h => hostname.includes(h))) {
    if (!pathname.startsWith('/admin')) {
      const url = request.nextUrl.clone()
      url.pathname = `/admin${pathname === '/' ? '' : pathname}`
      return NextResponse.rewrite(url)
    }
  }

  // Community hostname → default behavior (serves root pages)
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
