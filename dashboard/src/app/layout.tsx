import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const geist = Geist({ variable: '--font-geist', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'HyperViking',
  description: 'A shared brain for AI agents — encrypted P2P knowledge base with RBAC',
}

// Inline script to set theme before React hydrates — prevents flash
const themeScript = `(function(){try{var t=localStorage.getItem('hv-theme');var v=['dark','light','latte','frappe','macchiato','mocha'];if(t&&v.indexOf(t)!==-1){document.documentElement.className=t;document.documentElement.style.colorScheme=['light','latte'].indexOf(t)!==-1?'light':'dark'}}catch(e){}})();`

export default function RootLayout ({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0a0a0f" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
