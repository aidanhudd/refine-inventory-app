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
        <div className="app-nav-shell">
          <NavBar />
        </div>
        {children}
      </body>
    </html>
  )
}
