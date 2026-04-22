import './globals.css'
import NavBar from './components/NavBar'

export const metadata = {
  title: 'Refine Inventory',
  description: 'Warehouse inventory starter'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-header-shell">
          <header className="topbar app-header">
            <div className="app-brand">
              <img src="/logo.png" alt="Refine Kitchen & Bath Logo" className="app-logo" />
              <div>
                <h1 className="app-title">Warehouse Inventory</h1>
                <p className="subtext">Inventory, photos, usage tracking, undo usage, and job search.</p>
              </div>
            </div>
            <NavBar />
          </header>
        </div>
        {children}
      </body>
    </html>
  )
}
