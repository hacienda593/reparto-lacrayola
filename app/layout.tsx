import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Reparto La Crayola',
  description: 'Sistema de entregas para repartidores',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.className}>
      <body className="bg-[#0c0f12] antialiased">
        {children}
      </body>
    </html>
  )
}
