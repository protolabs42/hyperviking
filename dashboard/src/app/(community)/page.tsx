'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { BrowserProvider } from 'ethers'
import { SiweMessage } from 'siwe'

type UserStatus = 'admin' | 'member' | 'pending' | 'denied' | 'unknown' | null

interface UserData { eth: string; status: UserStatus; role?: string; name?: string; serverPubkey?: string }
interface TreeEntry { uri: string; size?: number; isDir?: boolean; abstract?: string }
interface Stats { members: number; roles: { admin: number; contributor: number; reader: number }; resources: number; protocols: number }
interface SkillEntry { uri: string; isDir?: boolean; abstract?: string }
interface ActivityItem { type: string; text: string; time: string; icon: string }
interface CommunityConfig { name: string; tagline: string; emoji: string; logo?: string; description: string; steps: Array<{ icon?: string; title: string; cmd?: string; description?: string }>; features: Array<{ title: string; description: string }>; links: Array<{ label: string; href: string }>; footer: string }

export default function CommunityPage () {
  const [status, setStatus] = useState<UserStatus>(null)
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [community, setCommunity] = useState<CommunityConfig>({ name: 'HyperViking', tagline: 'Community Knowledge Base', emoji: '\ud83e\udde0', description: '', steps: [], features: [], links: [], footer: '' })

  // Member data
  const [stats, setStats] = useState<Stats | null>(null)
  const [tree, setTree] = useState<TreeEntry[]>([])
  const [treePath, setTreePath] = useState('viking://')
  const [treeHistory, setTreeHistory] = useState<string[]>([])
  const [treeLoading, setTreeLoading] = useState(false)
  const [explorerView, setExplorerView] = useState<'grid' | 'list'>('grid')
  const [previewItem, setPreviewItem] = useState<{ uri: string; content: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [skillContent, setSkillContent] = useState<{ uri: string; content: string } | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])

  // Request form
  const [reqName, setReqName] = useState('')
  const [reqPubkey, setReqPubkey] = useState('')
  const [reqMessage, setReqMessage] = useState('')
  const [reqSubmitting, setReqSubmitting] = useState(false)
  const [reqResult, setReqResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => { fetch('/api/community').then(r => r.json()).then(setCommunity).catch(() => {}) }, [])

  const loadAll = useCallback(async () => {
    const [meRes, statsRes, actRes] = await Promise.all([
      fetch('/api/me'), fetch('/api/stats'), fetch('/api/activity'),
    ])
    if (meRes.ok) { const me = await meRes.json(); setUser(prev => prev ? { ...prev, ...me } : me) }
    if (statsRes.ok) setStats(await statsRes.json())
    if (actRes.ok) { const d = await actRes.json(); setActivity(d.items || []) }
    browseTree('viking://')
    loadSkills()
  }, [])

  async function loadSkills () {
    try {
      const res = await fetch('/api/skills')
      if (res.ok) { const d = await res.json(); setSkills(d.result || []) }
    } catch {}
  }

  async function viewSkill (uri: string) {
    try {
      const res = await fetch(`/api/skills?uri=${encodeURIComponent(uri)}`)
      if (res.ok) {
        const d = await res.json()
        const content = d.result?.content || d.content || JSON.stringify(d, null, 2)
        setSkillContent({ uri, content })
      }
    } catch {}
  }

  async function browseTree (uri: string) {
    setTreeLoading(true)
    try {
      const res = await fetch(`/api/tree?uri=${encodeURIComponent(uri)}`)
      const data = await res.json()
      setTree(data.result || [])
      if (uri !== treePath) setTreeHistory(prev => [...prev, treePath])
      setTreePath(uri)
    } catch {}
    setTreeLoading(false)
  }

  function treeGoBack () {
    if (treeHistory.length === 0) return
    const prev = treeHistory[treeHistory.length - 1]
    setTreeHistory(h => h.slice(0, -1))
    browseTreeDirect(prev)
  }

  async function browseTreeDirect (uri: string) {
    setTreeLoading(true)
    try {
      const res = await fetch(`/api/tree?uri=${encodeURIComponent(uri)}`)
      const data = await res.json()
      setTree(data.result || [])
      setTreePath(uri)
    } catch {}
    setTreeLoading(false)
  }

  async function connectWallet () {
    setLoading(true); setError('')
    try {
      if (!window.ethereum) throw new Error('No wallet found. Install MetaMask.')
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const { chainId } = await provider.getNetwork()
      const { nonce } = await (await fetch('/api/auth/nonce')).json()
      const message = new SiweMessage({ domain: window.location.host, address, statement: 'Sign in to HyperViking', uri: window.location.origin, version: '1', chainId: Number(chainId), nonce })
      const messageStr = message.prepareMessage()
      const signature = await signer.signMessage(messageStr)
      const verifyRes = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: messageStr, signature }) })
      const data = await verifyRes.json()
      if (!verifyRes.ok) throw new Error(data.error)
      setUser(data); setStatus(data.status)
      if (data.status === 'admin' || data.status === 'member') loadAll()
    } catch (err) { setError((err as Error).message) }
    finally { setLoading(false) }
  }

  async function submitRequest () {
    setReqSubmitting(true); setReqResult(null)
    try {
      const res = await fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: reqName, pubkey: reqPubkey, message: reqMessage }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || JSON.stringify(data))
      setReqResult({ ok: true, msg: 'Request submitted! An admin will review it.' })
      setTimeout(() => setStatus('pending'), 1500)
    } catch (err) { setReqResult({ ok: false, msg: (err as Error).message }) }
    finally { setReqSubmitting(false) }
  }

  async function previewFile (uri: string) {
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/tree?uri=${encodeURIComponent(uri)}`).catch(() => null)
      // Try reading the file content via the overview endpoint for a summary
      const ovRes = await fetch(`/api/skills?uri=${encodeURIComponent(uri)}`)
      if (ovRes.ok) {
        const d = await ovRes.json()
        const content = d.result?.content || d.content || JSON.stringify(d.result || d, null, 2)
        setPreviewItem({ uri, content })
      }
    } catch {}
    setPreviewLoading(false)
  }

  function FileIcon ({ uri, isDir, size = 'md' }: { uri: string; isDir?: boolean; size?: 'sm' | 'md' }) {
    const dim = size === 'sm' ? 'w-5 h-5' : 'w-8 h-8'
    const inner = size === 'sm' ? 'text-[9px]' : 'text-[11px]'

    if (isDir) {
      return (
        <div className={`${dim} rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0`}>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-[60%] h-[60%]"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg>
        </div>
      )
    }

    const ext = uri.split('.').pop()?.toLowerCase() || ''
    const colors: Record<string, string> = {
      md: 'bg-blue-500/15 text-blue-500', txt: 'bg-blue-500/15 text-blue-500',
      ts: 'bg-blue-600/15 text-blue-600', tsx: 'bg-blue-600/15 text-blue-600',
      js: 'bg-yellow-500/15 text-yellow-500', jsx: 'bg-yellow-500/15 text-yellow-500',
      py: 'bg-green-500/15 text-green-500',
      sol: 'bg-purple-500/15 text-purple-500',
      rs: 'bg-orange-500/15 text-orange-500', go: 'bg-cyan-500/15 text-cyan-500',
      json: 'bg-muted text-muted-foreground', yaml: 'bg-muted text-muted-foreground', yml: 'bg-muted text-muted-foreground', toml: 'bg-muted text-muted-foreground',
      css: 'bg-pink-500/15 text-pink-500', html: 'bg-orange-500/15 text-orange-500',
      svg: 'bg-pink-500/15 text-pink-500',
      png: 'bg-emerald-500/15 text-emerald-500', jpg: 'bg-emerald-500/15 text-emerald-500', gif: 'bg-emerald-500/15 text-emerald-500',
      sh: 'bg-muted text-muted-foreground', bash: 'bg-muted text-muted-foreground',
      lock: 'bg-muted text-muted-foreground',
    }
    const color = colors[ext] || 'bg-muted text-muted-foreground'
    const label = ext.slice(0, 3).toUpperCase() || 'FILE'

    return (
      <div className={`${dim} rounded-md ${color} flex items-center justify-center shrink-0 font-bold ${inner}`}>
        {label}
      </div>
    )
  }

  function breadcrumbs (path: string) {
    const parts = path.replace('viking://', '').split('/').filter(Boolean)
    const crumbs = [{ label: 'viking://', path: 'viking://' }]
    let acc = 'viking://'
    for (const p of parts) {
      acc += p + '/'
      crumbs.push({ label: p, path: acc })
    }
    return crumbs
  }

  function logout () { setStatus(null); setUser(null); setTree([]); setStats(null); setSkills([]); setActivity([]); setPreviewItem(null) }
  function shortEth (eth: string) { return `${eth.slice(0, 6)}\u2026${eth.slice(-4)}` }
  function formatSize (b?: number) { if (!b) return ''; if (b < 1024) return `${b}B`; if (b < 1048576) return `${(b/1024).toFixed(1)}KB`; return `${(b/1048576).toFixed(1)}MB` }
  async function copyText (text: string, e: React.MouseEvent<HTMLElement>) {
    await navigator.clipboard.writeText(text)
    const el = e.currentTarget; const prev = el.textContent
    el.textContent = 'Copied!'; setTimeout(() => { el.textContent = prev }, 1200)
  }

  // ═══════════════════════════════════════
  // LANDING
  // ═══════════════════════════════════════
  if (!status) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="absolute top-4 right-4"><ThemeSwitcher /></div>
        {community.logo
          ? <img src={community.logo} alt={community.name} className="h-16 w-16 object-contain" />
          : <div className="text-5xl">{community.emoji}</div>
        }
        <p className="text-xs uppercase tracking-[3px] text-primary font-medium">{community.tagline}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{community.name}</h1>
        <p className="text-muted-foreground text-sm text-center max-w-md leading-relaxed">
          {community.description}
        </p>
        <Button onClick={connectWallet} disabled={loading} size="lg" className="mt-2">
          {loading ? 'Signing\u2026' : 'Connect Wallet'}
        </Button>
        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="max-w-md w-full mt-8">
          <h2 className="text-xs uppercase tracking-[2px] text-muted-foreground text-center mb-5 font-medium">How It Works</h2>
          <div className="flex flex-col gap-4">
            {community.steps.map((s, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="w-7 h-7 rounded-full border flex items-center justify-center text-xs font-semibold text-primary shrink-0">{s.icon || (i + 1)}</div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{s.title}</span>
                  {s.description && <span className="text-xs text-muted-foreground leading-relaxed">{s.description}</span>}
                  {s.cmd && (
                    <button onClick={(e) => copyText(s.cmd!, e)} className="inline-flex items-center gap-2 mt-1 px-3 py-1.5 bg-card border rounded-md text-xs font-mono text-primary hover:border-primary transition-colors cursor-pointer w-fit">
                      {s.cmd} <span className="text-muted-foreground text-[10px]">copy</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════════════════════════════
  // WAITING ROOM
  // ═══════════════════════════════════════
  if (status === 'unknown') {
    return (
      <div className="min-h-screen max-w-2xl mx-auto px-4 py-10">
        <Header user={user} logout={logout} communityName={community.name} />
        <Card>
          <CardHeader><CardTitle>Request to Join</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">You&rsquo;re not a member yet. Submit a request and an admin will review it.</p>
            <div className="space-y-2">
              <Label htmlFor="reqName">Name</Label>
              <Input id="reqName" placeholder="What should we call you\u2026" value={reqName} onChange={e => setReqName(e.target.value)} autoComplete="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reqPubkey">HyperViking Public Key</Label>
              <Input id="reqPubkey" placeholder="64-character hex key\u2026" value={reqPubkey} onChange={e => setReqPubkey(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">
                Don&rsquo;t have one?{' '}
                <button onClick={(e) => copyText('npx hyperviking init', e)} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-card border rounded text-xs font-mono text-primary hover:border-primary transition-colors cursor-pointer">
                  npx hyperviking init <span className="text-muted-foreground text-[10px]">copy</span>
                </button>
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reqMessage">Message (optional)</Label>
              <Textarea id="reqMessage" placeholder="Why do you want to join\u2026" value={reqMessage} onChange={e => setReqMessage(e.target.value)} />
            </div>
            <Button onClick={submitRequest} disabled={reqSubmitting || !reqName || !reqPubkey} className="w-full sm:w-auto">
              {reqSubmitting ? 'Submitting\u2026' : 'Submit Request'}
            </Button>
            {reqResult && <p className={`text-sm ${reqResult.ok ? 'text-green-500' : 'text-destructive'}`}>{reqResult.msg}</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  // ═══════════════════════════════════════
  // PENDING
  // ═══════════════════════════════════════
  if (status === 'pending') {
    return (
      <div className="min-h-screen max-w-2xl mx-auto px-4 py-10">
        <Header user={user} logout={logout} badge="Pending" communityName={community.name} />
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <div className="text-4xl">&#x23F3;</div>
            <p className="text-sm text-muted-foreground">Your request has been submitted. An admin will review it.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ═══════════════════════════════════════
  // DENIED
  // ═══════════════════════════════════════
  if (status === 'denied') {
    return (
      <div className="min-h-screen max-w-2xl mx-auto px-4 py-10">
        <Header user={user} logout={logout} communityName={community.name} />
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-sm text-muted-foreground">Your request was not approved. You can reapply after the cooldown period (7 days).</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ═══════════════════════════════════════
  // MEMBER / ADMIN DASHBOARD
  // ═══════════════════════════════════════
  return (
    <div className="min-h-screen max-w-3xl mx-auto px-4 py-6">
      <Header user={user} logout={logout} badge={user?.role} communityName={community.name} />

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Members', value: stats.members },
            { label: 'Protocols', value: stats.protocols },
            { label: 'Resources', value: stats.resources },
            { label: 'Contributors', value: stats.roles.contributor + stats.roles.admin },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
                <div className="text-[11px] text-muted-foreground mt-1 uppercase tracking-wider">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="explorer">Explorer</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Connect Your Agent</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <button onClick={(e) => copyText(`hv connect ${user?.serverPubkey || ''}`, e)} className="w-full text-left bg-card border rounded-md p-3 font-mono text-xs text-primary break-all hover:border-primary transition-colors cursor-pointer">
                hv connect {user?.serverPubkey || 'loading\u2026'}
              </button>
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer hover:text-foreground transition-colors text-xs">MCP Config</summary>
                <pre className="bg-card border rounded-md p-3 font-mono text-[10px] text-primary overflow-x-auto mt-2">
{JSON.stringify({ mcpServers: { hyperviking: { command: 'hv', args: ['mcp', user?.serverPubkey || ''] } } }, null, 2)}
                </pre>
              </details>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card>
            <CardHeader><CardTitle className="text-sm">Activity</CardTitle></CardHeader>
            <CardContent className="p-0">
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground p-6 text-center">No recent activity</p>
              ) : (
                <div className="divide-y">
                  {activity.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">{a.icon}</span>
                      <span className="text-foreground">{a.text}</span>
                      {a.time && <span className="text-muted-foreground ml-auto shrink-0 tabular-nums">{formatTime(a.time)}</span>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Skills Tab ── */}
        <TabsContent value="skills" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Community Skills</CardTitle>
              <Button variant="outline" size="sm" onClick={loadSkills}>Refresh</Button>
            </CardHeader>
            <CardContent className="p-0">
              {skills.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <p className="text-sm text-muted-foreground">No skills shared yet.</p>
                  <p className="text-xs text-muted-foreground">Share skills from your agent with:<br/>
                    <code className="text-primary bg-card px-1.5 py-0.5 rounded text-[11px] mt-1 inline-block">viking_add_skill</code>
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {skills.map(s => (
                    <div key={s.uri} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium truncate">{s.uri.split('/').filter(Boolean).pop()}</span>
                        {s.abstract && <span className="text-xs text-muted-foreground truncate">{s.abstract}</span>}
                      </div>
                      <Button variant="outline" size="sm" className="shrink-0 ml-3 text-xs" onClick={() => viewSkill(s.uri + (s.uri.endsWith('/') ? 'SKILL.md' : ''))}>
                        View
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Skill Content Viewer */}
          {skillContent && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-mono">{skillContent.uri.split('/').filter(Boolean).pop()}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={(e) => copyText(skillContent.content, e as React.MouseEvent<HTMLElement>)}>
                    Copy Skill
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setSkillContent(null)}>
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="bg-card border rounded-md p-4 font-mono text-xs overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words">
                  {skillContent.content}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Explorer Tab (Google Drive style) ── */}
        <TabsContent value="explorer" className="space-y-4">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Knowledge Base</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="flex border rounded-md overflow-hidden">
                    <button onClick={() => setExplorerView('grid')} className={`px-2.5 py-1 text-xs transition-colors ${explorerView === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>Grid</button>
                    <button onClick={() => setExplorerView('list')} className={`px-2.5 py-1 text-xs transition-colors ${explorerView === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>List</button>
                  </div>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => browseTree(treePath)}>Refresh</Button>
                </div>
              </div>
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs flex-wrap">
                {breadcrumbs(treePath).map((c, i, arr) => (
                  <span key={c.path} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">/</span>}
                    {i === arr.length - 1 ? (
                      <span className="text-foreground font-medium">{c.label}</span>
                    ) : (
                      <button onClick={() => browseTree(c.path)} className="text-primary hover:underline">{c.label}</button>
                    )}
                  </span>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {treeLoading ? (
                <div className="flex items-center justify-center py-12">
                  <span className="text-sm text-muted-foreground animate-pulse">Loading\u2026</span>
                </div>
              ) : tree.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-muted-foreground"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg>
                  </div>
                  <span className="text-sm text-muted-foreground">Empty folder</span>
                </div>
              ) : explorerView === 'grid' ? (
                /* ── Grid View ── */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {tree.map(e => {
                    const name = e.uri.split('/').filter(Boolean).pop() || e.uri
                    return (
                      <button
                        key={e.uri}
                        onClick={() => e.isDir ? browseTree(e.uri.endsWith('/') ? e.uri : e.uri + '/') : previewFile(e.uri)}
                        className="flex flex-col items-center gap-2 p-4 rounded-lg border border-transparent hover:border-border hover:bg-muted/40 transition-all cursor-pointer group text-center"
                      >
                        <span className="group-hover:scale-110 transition-transform"><FileIcon uri={e.uri} isDir={e.isDir} /></span>
                        <span className="text-xs font-medium truncate w-full">{name}{e.isDir ? '' : ''}</span>
                        {e.abstract && <span className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{e.abstract}</span>}
                        {e.size && !e.isDir && <span className="text-[10px] text-muted-foreground/60 tabular-nums">{formatSize(e.size)}</span>}
                      </button>
                    )
                  })}
                </div>
              ) : (
                /* ── List View ── */
                <div className="divide-y rounded-lg border overflow-hidden">
                  {tree.map(e => {
                    const name = e.uri.split('/').filter(Boolean).pop() || e.uri
                    return (
                      <button
                        key={e.uri}
                        onClick={() => e.isDir ? browseTree(e.uri.endsWith('/') ? e.uri : e.uri + '/') : previewFile(e.uri)}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                      >
                        <FileIcon uri={e.uri} isDir={e.isDir} size="sm" />
                        <span className="text-sm font-medium truncate">{name}</span>
                        {e.abstract && <span className="text-xs text-muted-foreground truncate hidden sm:inline flex-1">{e.abstract}</span>}
                        {e.size && !e.isDir && <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">{formatSize(e.size)}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preview Panel */}
          {previewItem && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-mono truncate">{previewItem.uri.split('/').filter(Boolean).pop()}</CardTitle>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="text-xs" onClick={(e) => copyText(previewItem.content, e as React.MouseEvent<HTMLElement>)}>Copy</Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setPreviewItem(null)}>Close</Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="bg-card border rounded-md p-4 font-mono text-xs overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">
                  {previewLoading ? 'Loading\u2026' : previewItem.content}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Shared Header ──

function Header ({ user, logout, badge, communityName }: { user: UserData | null; logout: () => void; badge?: string; communityName?: string }) {
  return (
    <div className="flex justify-between items-center mb-6 pb-4 border-b flex-wrap gap-2">
      <h1 className="text-lg font-semibold tracking-tight">{communityName || 'HyperViking'}</h1>
      <div className="flex items-center gap-2 flex-wrap">
        {user?.name && <span className="text-sm">{user.name}</span>}
        {badge && <Badge variant={badge === 'admin' ? 'default' : 'secondary'} className="text-[10px]">{badge}</Badge>}
        {user?.eth && <span className="text-xs font-mono text-primary">{user.eth.slice(0, 6)}\u2026{user.eth.slice(-4)}</span>}
        <ThemeSwitcher />
        <Button variant="outline" size="sm" className="text-xs" onClick={logout}>Disconnect</Button>
      </div>
    </div>
  )
}

function formatTime (t: string) {
  if (!t) return ''
  try {
    const d = new Date(t)
    if (isNaN(d.getTime())) return t
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString()
  } catch { return t }
}
