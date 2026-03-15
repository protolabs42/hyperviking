'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BrowserProvider } from 'ethers'
import { SiweMessage } from 'siwe'
import type { MemberWithKey, JoinRequest, AuditEntry } from '@/lib/schemas'

export default function AdminPage () {
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [userName, setUserName] = useState('')
  const [userEth, setUserEth] = useState('')

  const [members, setMembers] = useState<MemberWithKey[]>([])
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])

  // Add member form
  const [addPubkey, setAddPubkey] = useState('')
  const [addRole, setAddRole] = useState<string>('reader')
  const [addName, setAddName] = useState('')
  const [addEth, setAddEth] = useState('')

  const fetchAll = useCallback(async () => {
    const [mRes, rRes, aRes] = await Promise.all([
      fetch('/api/members'),
      fetch('/api/requests'),
      fetch('/api/audit?count=50'),
    ])
    if (mRes.ok) { const d = await mRes.json(); setMembers(d.members || []) }
    if (rRes.ok) { const d = await rRes.json(); setRequests(d.requests || []) }
    if (aRes.ok) { const d = await aRes.json(); setAudit((d.entries || []).reverse()) }
  }, [])

  useEffect(() => { if (authed) fetchAll() }, [authed, fetchAll])

  async function connectWallet () {
    setLoading(true)
    setError('')
    try {
      if (!window.ethereum) throw new Error('No wallet found.')
      const provider = new BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const { chainId } = await provider.getNetwork()

      const { nonce } = await (await fetch('/api/auth/nonce')).json()
      const message = new SiweMessage({ domain: window.location.host, address, statement: 'Sign in to HyperViking Admin', uri: window.location.origin, version: '1', chainId: Number(chainId), nonce })
      const messageStr = message.prepareMessage()
      const signature = await signer.signMessage(messageStr)

      const res = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: messageStr, signature }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.status !== 'admin') throw new Error('Admin access required.')

      setUserName(data.name || '')
      setUserEth(data.eth)
      setAuthed(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function addMember () {
    if (!addPubkey || !addName) return
    await fetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey: addPubkey, role: addRole, name: addName, eth: addEth || undefined }) })
    setAddPubkey(''); setAddName(''); setAddEth('')
    fetchAll()
  }

  async function changeRole (pubkey: string, role: string) {
    await fetch(`/api/members?pubkey=${pubkey}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
    fetchAll()
  }

  async function removeMember (pubkey: string, name: string) {
    if (!confirm(`Remove ${name}?`)) return
    await fetch(`/api/members?pubkey=${pubkey}`, { method: 'DELETE' })
    fetchAll()
  }

  async function approveReq (eth: string, role: string) {
    await fetch(`/api/requests?action=approve&eth=${eth}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
    fetchAll()
  }

  async function denyReq (eth: string) {
    if (!confirm('Deny this request?')) return
    await fetch(`/api/requests?action=deny&eth=${eth}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    fetchAll()
  }

  function shortEth (eth: string) { return `${eth.slice(0, 6)}...${eth.slice(-4)}` }

  if (!authed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
        <div className="text-5xl">&#x1f6e1;</div>
        <p className="text-xs uppercase tracking-[3px] text-primary">Community HyperViking</p>
        <h1 className="text-2xl font-semibold">HyperViking Admin</h1>
        <p className="text-muted-foreground text-sm text-center max-w-sm leading-relaxed">
          Connect your Ethereum wallet to manage the community. Only admin wallets can access this dashboard.
        </p>
        <Button onClick={connectWallet} disabled={loading} size="lg">
          {loading ? 'Connecting\u2026' : 'Connect Wallet'}
        </Button>
        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>
    )
  }

  return (
    <div className="min-h-screen max-w-4xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-8 pb-4 border-b flex-wrap gap-2">
        <h1 className="text-lg font-semibold">HyperViking Admin</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm">{userName}</span>
          <Badge>Admin</Badge>
          <span className="text-xs font-mono text-primary">{shortEth(userEth)}</span>
          <Button variant="outline" size="sm" onClick={() => setAuthed(false)}>Disconnect</Button>
        </div>
      </div>

      {/* Members */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Members</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchAll}>Refresh</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[200px] space-y-1">
              <Label className="text-xs">Pubkey</Label>
              <Input placeholder="Hyperswarm public key\u2026" value={addPubkey} onChange={e => setAddPubkey(e.target.value)} className="font-mono text-xs" spellCheck={false} autoComplete="off" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <Select value={addRole} onValueChange={v => { if (v) setAddRole(v) }}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reader">Reader</SelectItem>
                  <SelectItem value="contributor">Contributor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input placeholder="Name\u2026" value={addName} onChange={e => setAddName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">ETH (optional)</Label>
              <Input placeholder="0x\u2026" value={addEth} onChange={e => setAddEth(e.target.value)} className="font-mono text-xs" />
            </div>
            <Button size="sm" onClick={addMember}>Add</Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Pubkey</TableHead>
                  <TableHead>ETH</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(m => (
                  <TableRow key={m.pubkey}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell><Badge variant={m.role === 'admin' ? 'default' : 'secondary'}>{m.role}</Badge></TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={m.pubkey}>{m.pubkey.slice(0, 16)}\u2026</TableCell>
                    <TableCell className="font-mono text-xs text-primary">{m.eth ? shortEth(m.eth) : '\u2014'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(m.addedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 items-center">
                        <Select defaultValue={m.role} onValueChange={v => { if (v) changeRole(m.pubkey, v) }}>
                          <SelectTrigger className="h-7 text-xs w-[100px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="reader">Reader</SelectItem>
                            <SelectItem value="contributor">Contributor</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => removeMember(m.pubkey, m.name)}>Remove</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Requests */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Join Requests</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchAll}>Refresh</Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>ETH</TableHead>
                  <TableHead>Pubkey</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No join requests</TableCell></TableRow>
                ) : requests.map(r => (
                  <TableRow key={r.eth}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs text-primary">{shortEth(r.eth)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground" title={r.pubkey}>{r.pubkey.slice(0, 16)}\u2026</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{r.message || '\u2014'}</TableCell>
                    <TableCell><Badge variant={r.status === 'pending' ? 'outline' : 'secondary'}>{r.status}</Badge></TableCell>
                    <TableCell>
                      {r.status === 'pending' && (
                        <div className="flex gap-1 items-center">
                          <Button size="sm" className="h-7 text-xs" onClick={() => approveReq(r.eth, 'reader')}>Approve</Button>
                          <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => denyReq(r.eth)}>Deny</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Audit */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Audit Log</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchAll}>Refresh</Button>
        </CardHeader>
        <CardContent className="p-0">
          {audit.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">No audit entries</p>
          ) : (
            <div className="divide-y max-h-[400px] overflow-y-auto">
              {audit.map((e, i) => (
                <div key={i} className="flex items-baseline gap-3 px-4 py-2 text-xs flex-wrap">
                  <span className="text-muted-foreground w-16 shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <Badge variant={e.status === 'allowed' ? 'secondary' : 'destructive'} className="text-[10px]">{e.status}</Badge>
                  <span>{e.peerName}</span>
                  <span className="text-muted-foreground font-mono">{e.method}</span>
                  {e.error && <span className="text-muted-foreground">{e.error}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
