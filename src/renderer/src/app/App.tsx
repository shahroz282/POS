import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@shared/schemas'
import type { Role } from '@shared/constants'
import { Permissions } from '@shared/constants'
import SidebarLayout from '../components/layout/SidebarLayout'
import DashboardPage from '../pages/DashboardPage'
import SalesPage from '../pages/SalesPage'
import StampPaperPage from '../pages/StampPaperPage'
import AdmissionsPage from '../pages/AdmissionsPage'
import SchemesPage from '../pages/SchemesPage'
import DailyClosingPage from '../pages/DailyClosingPage'
import UdhaarPage from '../pages/UdhaarPage'
import InventoryPage from '../pages/InventoryPage'
import ReportsPage from '../pages/ReportsPage'
import SettingsPage from '../pages/SettingsPage'
import BackupPage from '../pages/BackupPage'
import LoginPage from '../pages/LoginPage'
import SetupAdminPage from '../pages/SetupAdminPage'
import UsersPage from '../pages/UsersPage'

export type PageId =
  | 'login'
  | 'setup-admin'
  | 'dashboard'
  | 'sales'
  | 'stamp-paper'
  | 'admissions'
  | 'schemes'
  | 'daily-closing'
  | 'udhaar'
  | 'inventory'
  | 'reports'
  | 'settings'
  | 'users'
  | 'backup'

type AppPageId = Exclude<PageId, 'login' | 'setup-admin'>

const PAGE_MAP: Record<AppPageId, React.ReactNode> = {
  dashboard: <DashboardPage />,
  sales: <SalesPage />,
  'stamp-paper': <StampPaperPage />,
  admissions: <AdmissionsPage />,
  schemes: <SchemesPage />,
  'daily-closing': <DailyClosingPage />,
  udhaar: <UdhaarPage />,
  inventory: <InventoryPage />,
  reports: <ReportsPage />,
  settings: <SettingsPage />,
  users: <UsersPage />,
  backup: <BackupPage />
}

/**
 * SPEC.md §1: Sidebar shows only pages the role is allowed to see.
 * Returns the page IDs this role can access.
 */
export function getAllowedPages(role: Role): AppPageId[] {
  const pages: AppPageId[] = ['dashboard', 'sales', 'stamp-paper', 'admissions', 'schemes', 'udhaar']

  if (Permissions.canDailyClosing(role)) pages.push('daily-closing')
  if (Permissions.canPurchase(role)) pages.push('inventory')
  if (role === 'CASHIER') {
    pages.push('reports') // sales-only reports
  } else if (Permissions.canViewAllReports(role)) {
    pages.push('reports')
  }
  if (Permissions.canManageUsers(role)) pages.push('users')
  if (Permissions.canSettings(role)) pages.push('settings')
  if (Permissions.canBackup(role)) pages.push('backup')

  return pages
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('login')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null) // null = loading

  useEffect(() => {
    // Check if first-run setup is needed
    window.api.authHasUsers().then((result) => {
      if (result.ok) {
        setNeedsSetup(!result.data.hasUsers)
        if (!result.data.hasUsers) {
          setCurrentPage('setup-admin')
        }
      }
    })
  }, [])

  const handleLogin = useCallback((loggedInUser: SessionUser) => {
    setUser(loggedInUser)
    setCurrentPage('dashboard')
  }, [])

  const handleLogout = useCallback(async () => {
    await window.api.authLogout()
    setUser(null)
    setCurrentPage('login')
  }, [])

  const handleSetupComplete = useCallback((newUser: SessionUser) => {
    setUser(newUser)
    setNeedsSetup(false)
    setCurrentPage('dashboard')
  }, [])

  // Loading state
  if (needsSetup === null) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    )
  }

  // First-run setup
  if (needsSetup) {
    return <SetupAdminPage onSetupComplete={handleSetupComplete} />
  }

  // Not logged in
  if (!user) {
    return <LoginPage onLogin={handleLogin} />
  }

  // Logged in — render with sidebar
  const allowedPages = getAllowedPages(user.role as Role)

  return (
    <SidebarLayout
      currentPage={currentPage as AppPageId}
      onNavigate={setCurrentPage}
      user={user}
      allowedPages={allowedPages}
      onLogout={handleLogout}
    >
      {PAGE_MAP[currentPage as AppPageId] ?? <DashboardPage />}
    </SidebarLayout>
  )
}
