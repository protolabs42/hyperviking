'use client'

import { useTheme } from './theme-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

const themes = [
  { id: 'dark' as const, label: 'Dark' },
  { id: 'light' as const, label: 'Light' },
  { id: 'latte' as const, label: 'Latte' },
  { id: 'frappe' as const, label: 'Frapp\u00e9' },
  { id: 'macchiato' as const, label: 'Macchiato' },
  { id: 'mocha' as const, label: 'Mocha' },
] as const

export function ThemeSwitcher () {
  const { theme, setTheme } = useTheme()
  const current = themes.find(t => t.id === theme) || themes[0]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ThemeDot themeId={current.id} />
        <span className="hidden sm:inline">{current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('dark')} className={theme === 'dark' ? 'bg-accent' : ''}>
          <ThemeDot themeId="dark" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('light')} className={theme === 'light' ? 'bg-accent' : ''}>
          <ThemeDot themeId="light" /> Light
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {themes.filter(t => !['dark', 'light'].includes(t.id)).map(t => (
          <DropdownMenuItem key={t.id} onClick={() => setTheme(t.id)} className={theme === t.id ? 'bg-accent' : ''}>
            <ThemeDot themeId={t.id} /> {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThemeDot ({ themeId }: { themeId: string }) {
  const colors: Record<string, string> = {
    dark: '#0a0a0f', light: '#ffffff', latte: '#eff1f5',
    frappe: '#303446', macchiato: '#24273a', mocha: '#1e1e2e',
  }
  const accents: Record<string, string> = {
    dark: '#888', light: '#333', latte: '#8839ef',
    frappe: '#ca9ee6', macchiato: '#c6a0f6', mocha: '#cba6f7',
  }
  return (
    <span className="flex items-center gap-0.5 mr-1">
      <span className="w-3 h-3 rounded-full border border-border" style={{ background: colors[themeId] || '#333' }} />
      <span className="w-2 h-2 rounded-full" style={{ background: accents[themeId] || '#888' }} />
    </span>
  )
}
