import '../styles/globals.css'
import { ReactNode } from 'react'

export const metadata = {
  title: 'Periocular Recognition',
  description: 'Periocular + partial-face recognition demo',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="min-h-screen flex items-center justify-center p-6">
          {children}
        </main>
      </body>
    </html>
  )
}
