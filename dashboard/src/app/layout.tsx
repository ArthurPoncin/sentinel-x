import { NavLink, Outlet } from 'react-router'
import { ConnectionIndicator } from '@/features/live-feed'

export function Layout() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Sentinel-X</span>
        <nav>
          <NavLink to="/" end>
            Operator
          </NavLink>
          <NavLink to="/twin">Digital Twin</NavLink>
        </nav>
        <ConnectionIndicator />
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
