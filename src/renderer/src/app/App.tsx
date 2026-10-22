import { useState } from 'react'
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

export type PageId =
  | 'login'
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
  | 'backup'

const PAGE_MAP: Record<Exclude<PageId, 'login'>, React.ReactNode> = {
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
  backup: <BackupPage />
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard')
  const [loggedIn, setLoggedIn] = useState(false)

  if (!loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />
  }

  return (
    <SidebarLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {PAGE_MAP[currentPage as Exclude<PageId, 'login'>]}
    </SidebarLayout>
  )
}
