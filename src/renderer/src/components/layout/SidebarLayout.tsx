import type { PageId } from '../../app/App'
import type { SessionUser } from '@shared/schemas'
import { todayDate, useSelectedDate } from '../../utils/selected-date'

interface NavItem {
  id: Exclude<PageId, 'login' | 'setup-admin'>
  label: string
  icon: string
}

const ALL_NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',      icon: '🏠' },
  { id: 'sales',         label: 'Shop Sale',      icon: '🛒' },
  { id: 'stamp-paper',   label: 'Stamp Ledger',   icon: '📜' },
  { id: 'photocopy',     label: 'Photocopy',      icon: '📄' },
  { id: 'admissions',    label: 'Admissions',     icon: '🎓' },
  { id: 'filer-customers', label: 'Filer Customers', icon: '🧾' },
  { id: 'schemes',       label: 'Schemes',        icon: '📋' },
  { id: 'daily-closing', label: 'Galla Cash',     icon: '📅' },
  { id: 'udhaar',        label: 'Udhaar / Pending', icon: '💳' },
  { id: 'inventory',     label: 'Stock',          icon: '📦' },
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
  const [selectedDate, setSelectedDate] = useSelectedDate()
  const pastDate = selectedDate !== todayDate()

  return (
    <div className="flex h-screen min-h-0 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 min-h-0 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo / app name */}
        <div className="px-4 py-5 border-b border-gray-800">
          <h1 className="text-brand-400 font-bold text-lg leading-tight">Saqib</h1>
          <p className="text-gray-500 text-xs">Photo State — POS</p>
        </div>

        {/* Nav links */}
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
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
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-gray-950">
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 ${pastDate ? 'border-red-900 bg-red-950/30' : 'border-gray-800 bg-gray-900/40'}`}>
          <div className="text-xs">
            <span className="font-semibold text-gray-400">Master Date:</span>{' '}
            <span className={pastDate ? 'font-semibold text-red-300' : 'text-gray-300'}>{selectedDate}</span>
            {pastDate && <span className="ml-2 text-red-400">Past-date mode</span>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              max={todayDate()}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Master date"
              className="border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-100"
            />
            {pastDate && (
              <button type="button" onClick={() => setSelectedDate(todayDate())}
                className="border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800">
                Today
              </button>
            )}
          </div>
        </div>
        {children}
      </main>
    </div>
  )
}
