'use client'

import { createContext, useContext, useEffect, useState } from 'react'

const THEMES = ['dark', 'light', 'latte', 'frappe', 'macchiato', 'mocha'] as const
type Theme = (typeof THEMES)[number]

const SCHEME: Record<Theme, 'dark' | 'light'> = {
  dark: 'dark',
  light: 'light',
  latte: 'light',
  frappe: 'dark',
  macchiato: 'dark',
  mocha: 'dark',
}

const META_COLORS: Record<Theme, string> = {
  dark: '#0a0a0f',
  light: '#ffffff',
  latte: '#eff1f5',
  frappe: '#303446',
  macchiato: '#24273a',
  mocha: '#1e1e2e',
}

const ThemeContext = createContext<{
  theme: Theme
  setTheme: (t: Theme) => void
}>({ theme: 'mocha', setTheme: () => {} })

export function ThemeProvider ({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('hv-theme') as Theme | null
    const initial = saved && THEMES.includes(saved) ? saved : 'mocha'
    setThemeState(initial)
    applyTheme(initial)
    setMounted(true)
  }, [])

  function setTheme (t: Theme) {
    setThemeState(t)
    localStorage.setItem('hv-theme', t)
    applyTheme(t)
  }

  function applyTheme (t: Theme) {
    const html = document.documentElement
    for (const cls of THEMES) html.classList.remove(cls)
    html.classList.add(t)
    html.style.colorScheme = SCHEME[t]

    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', META_COLORS[t])
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme () {
  return useContext(ThemeContext)
}
