import type { PageId } from '../../app/App'

interface NavItem {
  id: Exclude<PageId, 'login'>
  label: string
  icon: string
  moduleNo: number
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',      icon: '🏠', moduleNo: 2 },
  { id: 'sales',         label: 'Normal Sales',   icon: '🛒', moduleNo: 3 },
  { id: 'stamp-paper',   label: 'Stamp Paper',    icon: '📜', moduleNo: 4 },
  { id: 'admissions',    label: 'Admissions',     icon: '🎓', moduleNo: 5 },
  { id: 'schemes',       label: 'Schemes',        icon: '📋', moduleNo: 6 },
  { id: 'daily-closing', label: 'Daily Closing',  icon: '📅', moduleNo: 7 },
  { id: 'udhaar',        label: 'Udhaar',         icon: '💳', moduleNo: 8 },
  { id: 'inventory',     label: 'Inventory',      icon: '📦', moduleNo: 9 },
  { id: 'reports',       label: 'Reports',        icon: '📊', moduleNo: 10 },
  { id: 'settings',      label: 'Settings',       icon: '⚙️',  moduleNo: 11 },
  { id: 'backup',        label: 'Backup',         icon: '💾', moduleNo: 12 }
]

interface Props {
  currentPage: PageId
  onNavigate: (page: PageId) => void
  children: React.ReactNode
}

export default function SidebarLayout({ currentPage, onNavigate, children }: Props) {
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
          {NAV_ITEMS.map((item) => {
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

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-600">
          v0.1.0 — offline
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto bg-gray-950">
        {children}
      </main>
    </div>
  )
}
