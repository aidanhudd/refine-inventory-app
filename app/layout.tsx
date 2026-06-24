import './globals.css'
import AppShell from './components/AppShell'
import { AuthProvider } from './components/AuthProvider'
import { HidePricesProvider } from './components/HidePricesProvider'

export const metadata = {
  title: 'Refine Inventory',
  description: 'Warehouse inventory starter'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <HidePricesProvider>
            <AppShell>{children}</AppShell>
          </HidePricesProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
