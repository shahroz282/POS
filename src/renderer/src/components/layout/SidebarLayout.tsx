import type { PageId } from '../../app/App'
import type { SessionUser } from '@shared/schemas'

interface NavItem {
  id: Exclude<PageId, 'login' | 'setup-admin'>
  label: string
  icon: string
}

const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',      icon: '🏠' },
  { id: 'sales',         label: 'Normal Sales',   icon: '🛒' },
  { id: 'stamp-paper',   label: 'Stamp Paper',    icon: '📜' },
  { id: 'admissions',    label: 'Admissions',     icon: '🎓' },
  { id: 'schemes',       label: 'Schemes',        icon: '📋' },
  { id: 'daily-closing', label: 'Daily Closing',  icon: '📅' },
  { id: 'udhaar',        label: 'Udhaar',         icon: '💳' },
  { id: 'inventory',     label: 'Inventory',      icon: '📦' },
  { id: 'reports',       label: 'Reports',        icon: '📊' },
  { id: 'users',         label: 'Users',          icon: '👥' },
  { id: 'settings',      label: 'Settings',       icon: '⚙️' },
  { id: 'backup',        label: 'Backup',         icon: '💾' }
]

interface Props {
  currentPage: PageId
  onNavigate: (page: PageId) => void
  user: SessionUser
  allowedPages: string[]
  onLogout: () => void
  children: React.ReactNode
}

/**
 * SPEC.md §1: Sidebar shows only the pages the role is allowed to see.
 */
export default function SidebarLayout({ currentPage, onNavigate, user, allowedPages, onLogout, children }: Props) {
  const visibleItems = ALL_NAV_ITEMS.filter((item) => allowedPages.includes(item.id))

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo / app name */}
        <div className="px-4 py-5 border-b border-gray-800">
          <h1 className="text-brand-400 font-bold text-lg leading-tight">Saqib</h1>
          <p className="text-gray-500 text-xs">Photo State — POS</p>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleItems.map((item) => {
            const active = currentPage === item.id
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => onNavigate(item.id)}
                className={`
                  w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors
                  ${active
                    ? 'bg-brand-700/40 text-brand-300 border-r-2 border-brand-400'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}
                `}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* User info + logout */}
        <div className="px-4 py-3 border-t border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm text-gray-200 font-medium truncate">{user.name}</p>
              <p className="text-xs text-gray-500">{user.role}</p>
            </div>
            <button
              id="btn-logout"
              onClick={onLogout}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-gray-800"
              title="Sign out"
            >
              ↪ Out
            </button>
          </div>
          <p className="text-xs text-gray-600">v0.1.0 — offline</p>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto bg-gray-950">
        {children}
      </main>
    </div>
  )
}
