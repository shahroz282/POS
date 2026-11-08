import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import * as XLSX from 'xlsx'
import type { Role } from '@shared/constants'
import type {
  SchemeApplicationDetail, SchemeApplicationRow, SchemeApplicationUpdate,
  SchemePaymentResult, SchemeRow, SchemesSummary, SettingsRow
} from '@shared/schemas'
import { getReceiptSettings, receiptWidthMm } from '../utils/receipt-settings'

type Tab = 'overview' | 'schemes' | 'applications' | 'new-application' | 'edit-applicant' | 'manage-fees'
type SchemeStatus = 'RECEIVED' | 'UNDER_REVIEW' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PENDING_DOCUMENTS' | 'COMPLETED' | 'CANCELLED'
type PayMethod = 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'OTHER'
type ApplicationEditForm = Omit<SchemeApplicationUpdate, 'applicationId'>

const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4 sm:p-5'
const statuses: SchemeStatus[] = ['RECEIVED', 'UNDER_REVIEW', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PENDING_DOCUMENTS', 'COMPLETED', 'CANCELLED']

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(amount)
}

function maskSpreadsheetFormula(value: unknown): string {
  const text = String(value ?? '')
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function friendlyErrorMessage(message: string): string {
  if (message.includes('Admin or Manager permission is required')) return 'Your account does not have permission to make this change. Please contact an Admin or Manager.'
  if (message.includes('Payment cannot exceed')) return 'The payment is greater than the remaining balance. Enter a smaller amount.'
  if (message.includes('There is no outstanding application fee balance')) return 'This applicant has no outstanding fee balance.'
  if (message.includes('Discount cannot exceed')) return 'The discount cannot be greater than the application fee.'
  if (message.includes('Applications can only be added to an active scheme')) return 'Choose an active scheme to register this applicant.'
  if (message.includes('Application date is before the scheme opening date')) return 'The application date is before this scheme opens.'
  if (message.includes('Application date is after the scheme closing date')) return 'The application date is after this scheme closes.'
  if (message.includes('Select a category configured for this scheme')) return 'Choose a category configured for the selected scheme.'
  if (message.includes('Required documents are missing')) return 'Upload the required documents before moving this application to the next status.'
  if (message.includes('Application status cannot change')) return 'This application cannot be moved to that status from its current status.'
  if (message.includes('Today is closed')) return 'Payments cannot be recorded because today has been closed. Ask an Admin to unlock the day.'
  if (message.includes('Closing date must be on or after opening date')) return 'The closing date must be the same as or later than the opening date.'
  if (message.includes('payment key was already used for a different transaction')) return 'This payment attempt was already used for different details. Please try again.'
  if (message.includes('This payment was reversed')) return 'This payment was reversed. Start a new payment if the money has been received.'
  if (message.includes('Cannot collect payment for a cancelled or rejected application')) return 'Fees cannot be collected for a cancelled or rejected application.'
  if (message.includes('Select a valid scheme')) return 'Select a valid scheme and try again.'
  if (message.includes('Select a valid application')) return 'Select a valid applicant and try again.'
  if (message.includes('Scheme not found') || message.includes('Scheme application not found')) return 'This scheme or application could not be found. Refresh the list and try again.'
  if (message.includes('UNIQUE constraint failed')) return 'A record with these details already exists. Check the scheme code and try again.'
  if (/String must|Expected |Invalid |Required|Number must|too (?:small|big)|regex|valid date/i.test(message)) return 'Some information is missing or invalid. Please check the required fields and try again.'
  if (message.includes('no such column')) return 'The database needs an update. Restart the application to apply the latest changes.'
  if (message.includes('Secure document storage is unavailable')) return 'Secure document storage is unavailable on this device. Contact an Admin.'
  return message
}

export default function SchemesPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [role, setRole] = useState<Role>('CASHIER')
  const [schemes, setSchemes] = useState<SchemeRow[]>([])
  const [applications, setApplications] = useState<SchemeApplicationRow[]>([])
  const [summary, setSummary] = useState<SchemesSummary>({
    totalSchemes: 0, activeSchemes: 0, closedSchemes: 0, totalApplications: 0, todayApplications: 0,
    monthApplications: 0, pendingApplications: 0, approvedApplications: 0, rejectedApplications: 0,
    todayCollection: 0, monthCollection: 0, outstanding: 0, recentPayments: []
  })
  const [selected, setSelected] = useState<SchemeApplicationDetail | null>(null)
  const [receipt, setReceipt] = useState<{ payment: SchemePaymentResult; applicant: SchemeApplicationDetail } | null>(null)
  const [receiptSettings, setReceiptSettings] = useState<SettingsRow | null>(null)
  const [search, setSearch] = useState('')
  const [schemeFilter, setSchemeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDateFilter, setFromDateFilter] = useState('')
  const [toDateFilter, setToDateFilter] = useState('')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setErrorState] = useState('')
  const [notice, setNoticeState] = useState('')
  const setError = (message: string) => {
    setErrorState(message ? friendlyErrorMessage(message) : '')
    setNoticeState('')
  }
  const setNotice = (message: string) => {
    setNoticeState(message)
    setErrorState('')
  }
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID())
  const [editingScheme, setEditingScheme] = useState<SchemeRow | null>(null)
  const [schemeFormOpen, setSchemeFormOpen] = useState(false)
  const [schemeSearch, setSchemeSearch] = useState('')
  const [schemeLifecycleFilter, setSchemeLifecycleFilter] = useState('')
  const [schemeCategories, setSchemeCategories] = useState<Array<{ id: number; name: string }>>([])
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<Array<{
    id: number; field_key: string; label: string; field_type: string; options_json: string | null; is_required: number
  }>>([])
  const [documentRequirements, setDocumentRequirements] = useState<Array<{ id: number; name: string; is_required: number }>>([])
  const canManage = role === 'ADMIN' || role === 'MANAGER'
  const filteredSchemes = useMemo(() => {
    const query = schemeSearch.trim().toLocaleLowerCase()
    return schemes.filter((scheme) => {
      const matchesQuery = !query || [
        scheme.name, scheme.scheme_code, scheme.category, scheme.description
      ].some((value) => value?.toLocaleLowerCase().includes(query))
      const matchesStatus = !schemeLifecycleFilter || scheme.lifecycle_status === schemeLifecycleFilter
      return matchesQuery && matchesStatus
    })
  }, [schemes, schemeSearch, schemeLifecycleFilter])

  const [schemeForm, setSchemeForm] = useState({
    name: '', schemeCode: '', category: '', description: '', startDate: today(), endDate: '', defaultFee: '0'
  })
  const [applicationForm, setApplicationForm] = useState({
    schemeId: '', applicantName: '', fatherName: '', cnic: '', mobile: '', address: '',
    city: '', district: '', category: '', purpose: '', applicationDate: today(),
    applicationFee: '', discountAmount: '0', remarks: '', customFields: {} as Record<string, string>
  })
  const [applicationEditForm, setApplicationEditForm] = useState<ApplicationEditForm>({
    applicantName: '', fatherName: '', cnic: '', mobile: '', address: '',
    city: '', district: '', category: '', purpose: '', remarks: ''
  })
  const [paymentForm, setPaymentForm] = useState({
    amount: '', method: 'CASH' as PayMethod, referenceNumber: '', notes: ''
  })

  const selectedScheme = useMemo(
    () => schemes.find((scheme) => String(scheme.id) === applicationForm.schemeId),
    [schemes, applicationForm.schemeId]
  )

  const loadSchemes = useCallback(async () => {
    const result = await window.api.schemesList()
    if (result.ok) setSchemes(result.data)
    else setError(result.error.message)
  }, [])

  const loadSummary = useCallback(async () => {
    const result = await window.api.schemesSummary()
    if (result.ok) setSummary(result.data)
    else setError(result.error.message)
  }, [])

  const loadApplications = useCallback(async (
    query = '', schemeId = '', status = '', fromDate = '', toDate = '', paymentStatus = ''
  ) => {
    const result = await window.api.schemesApplications(
      query, schemeId ? Number(schemeId) : undefined, status ? status as SchemeStatus : undefined,
      fromDate || undefined, toDate || undefined,
      paymentStatus ? paymentStatus as 'UNPAID' | 'PARTIAL' | 'PAID' : undefined
    )
    if (result.ok) setApplications(result.data)
    else setError(result.error.message)
  }, [])

  const openApplication = async (id: number) => {
    const result = await window.api.schemesApplicationDetail(id)
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    setSelected(result.data)
    return true
  }

  const editApplication = async (id: number) => {
    const result = await window.api.schemesApplicationDetail(id)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setSelected(result.data)
    setApplicationEditForm({
      applicantName: result.data.applicant_name,
      fatherName: result.data.father_name || '',
      cnic: result.data.cnic || '',
      mobile: result.data.mobile || '',
      address: result.data.address || '',
      city: result.data.city || '',
      district: result.data.district || '',
      category: result.data.category || '',
      purpose: result.data.purpose || '',
      remarks: result.data.remarks || ''
    })
    setTab('edit-applicant')
  }

  const openApplicationByNo = async (applicationNo: string) => {
    const result = await window.api.schemesApplications(applicationNo)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    const match = result.data.find((item) => item.application_no === applicationNo)
    if (match && await openApplication(match.id)) setTab('applications')
  }

  const openApplicationFees = async (id: number) => {
    if (await openApplication(id)) setTab('manage-fees')
  }

  const refresh = async () => {
    await Promise.all([loadSchemes(), loadSummary(), loadApplications(search, schemeFilter, statusFilter)])
    if (selected) await openApplication(selected.id)
  }

  useEffect(() => {
    void (async () => {
      const session = await window.api.authGetSession()
      if (session.ok && session.data) setRole(session.data.role)
      const settings = getReceiptSettings().then(setReceiptSettings).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Receipt settings could not be loaded.')
      })
      await Promise.all([loadSchemes(), loadSummary(), loadApplications(), settings])
    })()
  }, [loadSchemes, loadSummary, loadApplications])

  useEffect(() => {
    if (!selectedScheme) {
      setSchemeCategories([])
      setCustomFieldDefinitions([])
      setDocumentRequirements([])
      return
    }
    let active = true
    void Promise.all([
      window.api.schemesCategories(selectedScheme.id),
      window.api.schemesCustomFields(selectedScheme.id),
      window.api.schemesDocumentRequirements(selectedScheme.id)
    ]).then(([categories, fields, requirements]) => {
      if (!active) return
      if (categories.ok) setSchemeCategories(categories.data)
      else setError(categories.error.message)
      if (fields.ok) setCustomFieldDefinitions(fields.data)
      else setError(fields.error.message)
      if (requirements.ok) setDocumentRequirements(requirements.data)
      else setError(requirements.error.message)
    })
    return () => { active = false }
  }, [selectedScheme])

  const submitScheme = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const input = {
      ...schemeForm,
      defaultFee: Number(schemeForm.defaultFee),
      lifecycleStatus: editingScheme?.lifecycle_status ?? 'ACTIVE' as const
    }
    const result = editingScheme
      ? await window.api.schemesUpdate({ ...input, schemeId: editingScheme.id })
      : await window.api.schemesCreate(input)
    if (!result.ok) {
      setError(result.error.message)
    } else {
      setSchemeForm({ name: '', schemeCode: '', category: '', description: '', startDate: today(), endDate: '', defaultFee: '0' })
      setNotice(editingScheme ? 'Scheme and details updated.' : 'Scheme created.')
      setEditingScheme(null)
      setSchemeFormOpen(false)
      await loadSchemes()
    }
    setBusy(false)
  }

  const beginEditScheme = (scheme: SchemeRow) => {
    setEditingScheme(scheme)
    setSchemeForm({
      name: scheme.name, schemeCode: scheme.scheme_code, category: scheme.category || '',
      description: scheme.description || '', startDate: scheme.start_date || '',
      endDate: scheme.end_date || '', defaultFee: String(scheme.default_fee)
    })
    setTab('schemes')
    setSchemeFormOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const changeSchemeLifecycle = async (scheme: SchemeRow, next: SchemeRow['lifecycle_status']) => {
    const action = next === 'CLOSED' ? 'Close' : next === 'SUSPENDED' ? 'Suspend' : 'Activate'
    if (!window.confirm(`${action} ${scheme.name}?`)) return
    const result = await window.api.schemesLifecycleUpdate(scheme.id, next)
    if (!result.ok) setError(result.error.message)
    else {
      setNotice(`Scheme ${next.toLowerCase()}.`)
      await loadSchemes()
    }
  }

  const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const result = await window.api.schemesApplicationCreate({
      schemeId: Number(applicationForm.schemeId),
      applicantName: applicationForm.applicantName,
      fatherName: applicationForm.fatherName,
      cnic: applicationForm.cnic,
      mobile: applicationForm.mobile,
      address: applicationForm.address,
      city: applicationForm.city,
      district: applicationForm.district,
      category: applicationForm.category,
      purpose: applicationForm.purpose,
      applicationDate: applicationForm.applicationDate,
      applicationFee: canManage ? Number(applicationForm.applicationFee || selectedScheme?.default_fee || 0) : undefined,
      discountAmount: canManage ? Number(applicationForm.discountAmount) : 0,
      remarks: applicationForm.remarks,
      customFields: applicationForm.customFields
    })
    if (!result.ok) {
      setError(result.error.message)
    } else {
      setNotice(`Application saved: ${result.data.applicationNo}`)
      setApplicationForm({
        schemeId: '', applicantName: '', fatherName: '', cnic: '', mobile: '', address: '',
        city: '', district: '', category: '', purpose: '', applicationDate: today(),
        applicationFee: '', discountAmount: '0', remarks: '', customFields: {}
      })
      await Promise.all([loadApplications(), loadSummary(), loadSchemes()])
      if (await openApplication(result.data.applicationId)) setTab('applications')
    }
    setBusy(false)
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    setNotice('')
    const result = await window.api.schemesPaymentCreate({
      applicationId: selected.id,
      idempotencyKey: paymentKey,
      amount: Number(paymentForm.amount),
      method: paymentForm.method,
      referenceNumber: paymentForm.referenceNumber,
      notes: paymentForm.notes
    })
    if (!result.ok) {
      setError(result.error.message)
    } else {
      setPaymentKey(crypto.randomUUID())
      setPaymentForm({ amount: '', method: 'CASH', referenceNumber: '', notes: '' })
      setNotice(`Payment saved. Receipt ${result.data.receiptNumber}`)
      await Promise.all([loadSummary(), loadApplications(search, schemeFilter, statusFilter)])
      const refreshed = await window.api.schemesApplicationDetail(selected.id)
      if (refreshed.ok) {
        setSelected(refreshed.data)
        setReceipt({ payment: result.data, applicant: refreshed.data })
        setTab('manage-fees')
      } else setError(refreshed.error.message)
    }
    setBusy(false)
  }

  const updateStatus = async (status: SchemeStatus) => {
    if (!selected) return
    const result = await window.api.schemesApplicationStatus({ applicationId: selected.id, status })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setNotice(`Application status changed to ${status.replaceAll('_', ' ').toLowerCase()}.`)
    await Promise.all([openApplication(selected.id), loadApplications(search, schemeFilter, statusFilter), loadSummary()])
  }

  const saveApplication = async (input: SchemeApplicationUpdate) => {
    const result = await window.api.schemesApplicationUpdate(input)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setNotice('Applicant details updated.')
    await Promise.all([openApplication(input.applicationId), loadApplications(search, schemeFilter, statusFilter)])
    setTab('applications')
  }

  const submitApplicationEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    setNotice('')
    await saveApplication({ applicationId: selected.id, ...applicationEditForm })
    setBusy(false)
  }

  const reversePayment = async (paymentId: number) => {
    const reason = window.prompt('Enter the reason for reversing this payment:')
    if (!reason) return
    const result = await window.api.schemesPaymentReverse(paymentId, reason)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setNotice('Payment reversal recorded. The original payment remains in history.')
    await Promise.all([openApplication(selected!.id), loadApplications(search, schemeFilter, statusFilter), loadSummary()])
  }

  const exportExcel = async () => {
    setExporting(true)
    setError('')
    try {
      const rows = applications.map((application) => ({
        'Application ID': maskSpreadsheetFormula(application.application_no),
        Scheme: maskSpreadsheetFormula(application.scheme_name),
        Applicant: maskSpreadsheetFormula(application.applicant_name),
        'Father / Husband': maskSpreadsheetFormula(application.father_name),
        CNIC: maskSpreadsheetFormula(application.cnic),
        Phone: maskSpreadsheetFormula(application.mobile),
        Category: maskSpreadsheetFormula(application.category),
        'Application Date': application.application_date,
        Status: application.status,
        'Fee (PKR)': application.application_fee,
        'Discount (PKR)': application.discount_amount,
        'Paid (PKR)': application.total_paid,
        'Balance (PKR)': application.balance
      }))
      const sheet = XLSX.utils.json_to_sheet(rows)
      sheet['!cols'] = [{ wch: 26 }, { wch: 24 }, { wch: 28 }, { wch: 28 }, { wch: 20 }, { wch: 18 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }]
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Scheme Applications')
      const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
      const result = await window.api.schemesExportExcel(new Uint8Array(bytes))
      if (!result.ok) setError(result.error.message)
      else if (result.data.saved) setNotice('Scheme applications exported to Excel.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Excel export failed.')
    } finally {
      setExporting(false)
    }
  }

  const selectedCanMoveTo = (status: SchemeStatus) => {
    const allowed: Record<SchemeStatus, SchemeStatus[]> = {
      RECEIVED: ['UNDER_REVIEW', 'PENDING_DOCUMENTS', 'CANCELLED'],
      UNDER_REVIEW: ['SUBMITTED', 'APPROVED', 'REJECTED', 'PENDING_DOCUMENTS', 'CANCELLED'],
      SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PENDING_DOCUMENTS', 'CANCELLED'],
      PENDING_DOCUMENTS: ['UNDER_REVIEW', 'SUBMITTED', 'CANCELLED'],
      APPROVED: ['COMPLETED', 'CANCELLED'],
      REJECTED: [], COMPLETED: [], CANCELLED: []
    }
    if (!selected) return false
    if (!canManage && ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'].includes(status)) return false
    return allowed[selected.status as SchemeStatus].includes(status)
  }

  const navigate = (next: Tab) => {
    setTab(next)
    setError('')
    setNotice('')
    if (next === 'schemes' && !editingScheme) setSchemeFormOpen(false)
    if (next === 'new-application' && schemes.length > 0) {
      const firstActive = schemes.find((scheme) => scheme.lifecycle_status === 'ACTIVE')
      if (firstActive) setApplicationForm((current) => ({ ...current, schemeId: String(firstActive.id), applicationFee: String(firstActive.default_fee) }))
    }
  }

  const navigationTabs: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ['schemes', 'Schemes'],
    ['applications', 'Applications'],
    ['new-application', 'New Applicant']
  ]

  return <div className="space-y-5 p-4 sm:p-6">
    {error && <Feedback type="error" message={error} onClose={() => setError('')} />}
    {notice && <Feedback type="success" message={notice} onClose={() => setNotice('')} />}
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Module 6</p><h1 className="mt-1 text-2xl font-bold text-gray-100">Schemes</h1><p className="mt-1 text-sm text-gray-500">Manage schemes, applicants and fee collection.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void refresh()} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">Refresh</button>{canManage && <button type="button" disabled={exporting || applications.length === 0} onClick={() => void exportExcel()} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50">{exporting ? 'Preparing…' : 'Export Excel'}</button>}</div>
    </header>

    <nav className="flex flex-wrap gap-1 border-b border-gray-800" aria-label="Schemes sections">
      {navigationTabs.map(([id, label]) => (
        <button key={id} type="button" onClick={() => navigate(id)} className={`border-b-2 px-3 py-2.5 text-sm ${tab === id ? 'border-brand-400 text-brand-300' : 'border-transparent text-gray-500 hover:text-gray-200'}`}>{label}</button>
      ))}
    </nav>

    {tab === 'overview' && <section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="All schemes" value={summary.totalSchemes} /><Metric label="Active schemes" value={summary.activeSchemes} />
        <Metric label="Applications" value={summary.totalApplications} /><Metric label="Applications today" value={summary.todayApplications} />
        <Metric label="Applications this month" value={summary.monthApplications} /><Metric label="Pending applications" value={summary.pendingApplications} />
        <Metric label="Approved / completed" value={summary.approvedApplications} /><Metric label="Rejected" value={summary.rejectedApplications} />
        <Metric label="Fees collected today" value={money(summary.todayCollection)} /><Metric label="Fees collected this month" value={money(summary.monthCollection)} />
        <Metric label="Outstanding application fees" value={money(summary.outstanding)} /><Metric label="Closed schemes" value={summary.closedSchemes} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className={sectionClass}><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-100">Recent applications</h2><button type="button" onClick={() => navigate('applications')} className="text-xs text-brand-300">View all</button></div><ApplicationTable rows={applications.slice(0, 8)} onOpen={(id) => void openApplication(id).then((opened) => { if (opened) setTab('applications') })} onManageFees={(id) => void openApplicationFees(id)} /></section>
        <section className={sectionClass}><h2 className="mb-3 text-sm font-semibold text-gray-100">Recent fee payments</h2><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Receipt / application', 'Applicant / scheme', 'Amount', 'Method', 'Date', ''].map((head) => <th key={head} className="px-2 py-2">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{summary.recentPayments.map((payment) => <tr key={payment.id}><td className="px-2 py-2"><span className="block text-brand-300">{payment.receipt_no}</span><span className="text-gray-500">{payment.application_no}</span></td><td className="px-2 py-2"><span className="block text-gray-200">{payment.applicant_name}</span><span className="text-gray-500">{payment.scheme_name}</span></td><td className="px-2 py-2 text-gray-200">{money(payment.amount)}</td><td className="px-2 py-2 text-gray-400">{payment.method}{payment.reversed ? ' · reversed' : ''}</td><td className="px-2 py-2 text-gray-400">{payment.paid_at}</td><td className="px-2 py-2"><button type="button" onClick={() => void openApplicationByNo(payment.application_no)} className="text-brand-300">Open</button></td></tr>)}</tbody></table>{summary.recentPayments.length === 0 && <Empty text="No scheme payments yet." />}</div></section>
      </div>
    </section>}

    {tab === 'schemes' && <section className="space-y-4">
      {schemeFormOpen ? (canManage ? <form onInvalidCapture={(event) => {
        event.preventDefault()
        setError('Please complete the required scheme details and check the highlighted fields.')
      }} onSubmit={(event) => void submitScheme(event)} className={`${sectionClass} grid gap-3 sm:grid-cols-2 xl:grid-cols-4`}>
        <div className="flex items-center justify-between sm:col-span-2 xl:col-span-4"><h2 className="text-sm font-semibold text-gray-100">{editingScheme ? 'Edit scheme' : 'Add scheme'}</h2><button type="button" onClick={() => { setSchemeFormOpen(false); setEditingScheme(null); setSchemeForm({ name: '', schemeCode: '', category: '', description: '', startDate: today(), endDate: '', defaultFee: '0' }) }} className="border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Back to schemes</button></div>
        <Field label="Scheme name" required><input required maxLength={120} className={inputClass} value={schemeForm.name} onChange={(event) => setSchemeForm({ ...schemeForm, name: event.target.value })} placeholder="e.g. Housing Assistance 2026" /></Field>
        <Field label="Unique scheme code" required><input required minLength={2} maxLength={12} pattern="[A-Za-z0-9_-]+" title="Use 2–12 letters, numbers, hyphens or underscores." className={inputClass} value={schemeForm.schemeCode} onChange={(event) => setSchemeForm({ ...schemeForm, schemeCode: event.target.value.toUpperCase() })} placeholder="e.g. HA26" /></Field>
        <Field label="Category"><input maxLength={100} className={inputClass} value={schemeForm.category} onChange={(event) => setSchemeForm({ ...schemeForm, category: event.target.value })} placeholder="Optional" /></Field>
        <Field label="Default application fee (PKR)" required><input required type="number" min="0" max="100000000" step="1" className={inputClass} value={schemeForm.defaultFee} onChange={(event) => setSchemeForm({ ...schemeForm, defaultFee: event.target.value })} /></Field>
        <Field label="Opening date"><CalendarDateInput value={schemeForm.startDate} onChange={(value) => setSchemeForm({ ...schemeForm, startDate: value })} /></Field>
        <Field label="Closing date"><CalendarDateInput value={schemeForm.endDate} onChange={(value) => setSchemeForm({ ...schemeForm, endDate: value })} /></Field>
        <Field label="Description"><input maxLength={1000} className={inputClass} value={schemeForm.description} onChange={(event) => setSchemeForm({ ...schemeForm, description: event.target.value })} /></Field>
        <div className="flex items-end gap-2"><button disabled={busy} className="w-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{busy ? 'Saving…' : editingScheme ? 'Save changes' : 'Create scheme'}</button></div>
      </form> : <p className={sectionClass}>Only Admin or Manager can create or edit schemes.</p>) : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-gray-100">Schemes</h2><p className="mt-1 text-xs text-gray-500">Search and filter your schemes, or open a scheme to manage it.</p></div>
        {canManage && <button type="button" onClick={() => { setEditingScheme(null); setSchemeForm({ name: '', schemeCode: '', category: '', description: '', startDate: today(), endDate: '', defaultFee: '0' }); setSchemeFormOpen(true); setError(''); setNotice('') }} className="bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">+ Add scheme</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_220px_auto]">
        <Field label="Search schemes"><input className={inputClass} value={schemeSearch} onChange={(event) => setSchemeSearch(event.target.value)} placeholder="Search name, code, category…" /></Field>
        <Field label="Status"><select className={inputClass} value={schemeLifecycleFilter} onChange={(event) => setSchemeLifecycleFilter(event.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option><option value="SUSPENDED">Suspended</option></select></Field>
        <div className="flex items-end"><button type="button" onClick={() => { setSchemeSearch(''); setSchemeLifecycleFilter('') }} className="border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800">Clear filters</button></div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filteredSchemes.map((scheme) => <SchemeCard key={scheme.id} scheme={scheme} canManage={canManage} onEdit={() => beginEditScheme(scheme)} onLifecycle={(status) => void changeSchemeLifecycle(scheme, status)} onView={() => { setSchemeFilter(String(scheme.id)); void loadApplications(search, String(scheme.id), statusFilter); setTab('applications') }} />)}</div>
      {filteredSchemes.length === 0 && <Empty text={schemes.length === 0 ? 'No schemes yet. Admin or Manager can add the first scheme.' : 'No schemes match these filters.'} />}
      </>}
    </section>}

    {tab === 'applications' && <section className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadApplications(search, schemeFilter, statusFilter) }} placeholder="Search ID, applicant, CNIC, phone…" aria-label="Search scheme applications" />
        <select className={inputClass} value={schemeFilter} onChange={(event) => setSchemeFilter(event.target.value)}><option value="">All schemes</option>{schemes.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}</option>)}</select>
        <select className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select>
        <CalendarDateInput ariaLabel="Applications from date" value={fromDateFilter} onChange={setFromDateFilter} />
        <CalendarDateInput ariaLabel="Applications to date" value={toDateFilter} onChange={setToDateFilter} />
        <select className={inputClass} value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)}><option value="">All payment states</option><option value="UNPAID">Unpaid</option><option value="PARTIAL">Partially paid</option><option value="PAID">Fully paid</option></select>
        <button type="button" onClick={() => void loadApplications(search, schemeFilter, statusFilter, fromDateFilter, toDateFilter, paymentStatusFilter)} className="border border-gray-700 px-4 text-sm text-gray-200 hover:bg-gray-800 xl:col-span-6">Search</button>
      </div>
      <section className={sectionClass}><ApplicationTable rows={applications} onOpen={(id) => void openApplication(id)} onEdit={(id) => void editApplication(id)} onManageFees={(id) => void openApplicationFees(id)} /></section>
      {selected && <ApplicationProfile application={selected} canManage={canManage} onEdit={() => void editApplication(selected.id)} onStatus={updateStatus} canMoveTo={selectedCanMoveTo} onCollect={() => setTab('manage-fees')} onReverse={(id) => void reversePayment(id)} onPrintPayment={(payment) => {
        setReceipt({ applicant: selected, payment: {
          receiptNumber: payment.receipt_no, amount: payment.amount,
          balance: payment.balance_after ?? selected.balance, paidAt: payment.paid_at,
          method: payment.method, referenceNumber: payment.reference_no
        } })
        if (receiptSettings) setTimeout(() => window.print(), 0)
        else setError('Receipt settings are not ready. Wait for them to load, then print the receipt.')
      }} />}
    </section>}

    {tab === 'new-application' && <form onInvalidCapture={(event) => {
      event.preventDefault()
      setError('Please complete the required applicant details and check the highlighted fields.')
    }} onSubmit={(event) => void submitApplication(event)} className="space-y-4">
      <section className={`${sectionClass} space-y-4`}>
        <h2 className="text-sm font-semibold text-gray-100">Applicant registration</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Scheme" required><select required className={inputClass} value={applicationForm.schemeId} onChange={(event) => {
            const scheme = schemes.find((item) => String(item.id) === event.target.value)
            setApplicationForm({ ...applicationForm, schemeId: event.target.value, applicationFee: String(scheme?.default_fee ?? 0), category: '', customFields: {} })
          }}><option value="">Select scheme</option>{schemes.filter((scheme) => scheme.lifecycle_status === 'ACTIVE').map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name} ({scheme.scheme_code})</option>)}</select></Field>
          <Field label="Applicant full name" required><input required maxLength={100} className={inputClass} value={applicationForm.applicantName} onChange={(event) => setApplicationForm({ ...applicationForm, applicantName: event.target.value })} /></Field>
          <Field label="Father / husband name"><input maxLength={100} className={inputClass} value={applicationForm.fatherName} onChange={(event) => setApplicationForm({ ...applicationForm, fatherName: event.target.value })} /></Field>
          <Field label="CNIC" required><input required minLength={13} maxLength={15} pattern="[0-9]{5}-?[0-9]{7}-?[0-9]" title="Enter a valid 13-digit CNIC." className={inputClass} placeholder="XXXXX-XXXXXXX-X" value={applicationForm.cnic} onChange={(event) => setApplicationForm({ ...applicationForm, cnic: event.target.value })} /></Field>
          <Field label="Phone number"><input maxLength={30} className={inputClass} value={applicationForm.mobile} onChange={(event) => setApplicationForm({ ...applicationForm, mobile: event.target.value })} /></Field>
          <Field label="Application date" required><CalendarDateInput required value={applicationForm.applicationDate} onChange={(value) => setApplicationForm({ ...applicationForm, applicationDate: value })} /></Field>
          <Field label="Category"><input list="scheme-category-options" maxLength={100} className={inputClass} value={applicationForm.category} onChange={(event) => setApplicationForm({ ...applicationForm, category: event.target.value })} /><datalist id="scheme-category-options">{schemeCategories.map((item) => <option key={item.id} value={item.name} />)}</datalist></Field>
          <Field label="City"><input maxLength={100} className={inputClass} value={applicationForm.city} onChange={(event) => setApplicationForm({ ...applicationForm, city: event.target.value })} /></Field>
          <Field label="District"><input maxLength={100} className={inputClass} value={applicationForm.district} onChange={(event) => setApplicationForm({ ...applicationForm, district: event.target.value })} /></Field>
          <Field label="Address"><input maxLength={500} className={inputClass} value={applicationForm.address} onChange={(event) => setApplicationForm({ ...applicationForm, address: event.target.value })} /></Field>
          <Field label="Application purpose"><input maxLength={500} className={inputClass} value={applicationForm.purpose} onChange={(event) => setApplicationForm({ ...applicationForm, purpose: event.target.value })} /></Field>
          <Field label="Remarks"><input maxLength={1000} className={inputClass} value={applicationForm.remarks} onChange={(event) => setApplicationForm({ ...applicationForm, remarks: event.target.value })} /></Field>
        </div>
      </section>
      <section className={`${sectionClass} space-y-3`}>
        <h2 className="text-sm font-semibold text-gray-100">Application fee (whole PKR)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Application fee">{canManage ? <input type="number" min="0" step="1" className={inputClass} value={applicationForm.applicationFee || selectedScheme?.default_fee || 0} onChange={(event) => setApplicationForm({ ...applicationForm, applicationFee: event.target.value })} /> : <p className="rounded border border-gray-800 px-3 py-2 text-sm text-gray-200">{money(selectedScheme?.default_fee ?? 0)}</p>}</Field>
          {canManage && <Field label="Discount"><input type="number" min="0" step="1" className={inputClass} value={applicationForm.discountAmount} onChange={(event) => setApplicationForm({ ...applicationForm, discountAmount: event.target.value })} /></Field>}
        </div>
        <p className="text-xs text-gray-500">Registration does not require full payment. Record collection separately in Fee collection.</p>
        {customFieldDefinitions.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{customFieldDefinitions.map((field) => {
          const value = applicationForm.customFields[field.field_key] ?? ''
          const update = (next: string) => setApplicationForm((current) => ({
            ...current, customFields: { ...current.customFields, [field.field_key]: next }
          }))
          const options = field.options_json ? JSON.parse(field.options_json) as string[] : []
          return <Field key={field.id} label={field.label} required={Boolean(field.is_required)}>
            {field.field_type === 'SELECT'
              ? <select required={Boolean(field.is_required)} className={inputClass} value={value} onChange={(event) => update(event.target.value)}><option value="">Select</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
              : field.field_type === 'CHECKBOX'
                ? <select required={Boolean(field.is_required)} className={inputClass} value={value} onChange={(event) => update(event.target.value)}><option value="">Select</option><option value="true">Yes</option><option value="false">No</option></select>
                : field.field_type === 'DATE'
                  ? <CalendarDateInput required={Boolean(field.is_required)} value={value} onChange={update} />
                  : <input required={Boolean(field.is_required)} type={field.field_type === 'NUMBER' ? 'number' : 'text'} className={inputClass} value={value} onChange={(event) => update(event.target.value)} />}
          </Field>
        })}</div>}
        {documentRequirements.length > 0 && <div className="border-t border-gray-800 pt-3"><p className="text-xs font-medium text-gray-400">Scheme document requirements</p><ul className="mt-2 flex flex-wrap gap-2">{documentRequirements.map((item) => <li key={item.id} className="border border-gray-700 px-2 py-1 text-xs text-gray-400">{item.name}{item.is_required ? ' *' : ''}</li>)}</ul><p className="mt-2 text-xs text-amber-400">Application can be registered before documents are complete; track this with Pending Documents status.</p></div>}
      </section>
      <div className="flex justify-end"><button disabled={busy || schemes.every((scheme) => scheme.lifecycle_status !== 'ACTIVE')} className="bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save application'}</button></div>
      {schemes.every((scheme) => scheme.lifecycle_status !== 'ACTIVE') && <Empty text="Create or activate a scheme before registering applications." />}
    </form>}

    {tab === 'edit-applicant' && selected && canManage && <form onInvalidCapture={(event) => {
      event.preventDefault()
      setError('Please enter a valid applicant name and CNIC before saving changes.')
    }} onSubmit={(event) => void submitApplicationEdit(event)} className="space-y-4">
      <section className={`${sectionClass} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-gray-100">Edit applicant</h2><p className="mt-1 text-xs text-gray-500">{selected.application_no} · {selected.scheme_name} · Applied {selected.application_date}</p></div>
          <div className="text-right text-xs text-gray-400"><p>Fee: {money(selected.application_fee)}</p><p>Balance: {money(selected.balance)}</p></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label="Applicant full name" required><input required maxLength={100} className={inputClass} value={applicationEditForm.applicantName} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, applicantName: event.target.value })} /></Field>
          <Field label="Father / husband name"><input maxLength={100} className={inputClass} value={applicationEditForm.fatherName || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, fatherName: event.target.value })} /></Field>
          <Field label="CNIC" required><input required minLength={13} maxLength={15} pattern="[0-9]{5}-?[0-9]{7}-?[0-9]" title="Enter a valid 13-digit CNIC." className={inputClass} value={applicationEditForm.cnic} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, cnic: event.target.value })} /></Field>
          <Field label="Phone number"><input maxLength={30} className={inputClass} value={applicationEditForm.mobile || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, mobile: event.target.value })} /></Field>
          <Field label="Category"><input maxLength={100} className={inputClass} value={applicationEditForm.category || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, category: event.target.value })} /></Field>
          <Field label="Application purpose"><input maxLength={500} className={inputClass} value={applicationEditForm.purpose || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, purpose: event.target.value })} /></Field>
          <Field label="Address"><input maxLength={500} className={inputClass} value={applicationEditForm.address || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, address: event.target.value })} /></Field>
          <Field label="City"><input maxLength={100} className={inputClass} value={applicationEditForm.city || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, city: event.target.value })} /></Field>
          <Field label="District"><input maxLength={100} className={inputClass} value={applicationEditForm.district || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, district: event.target.value })} /></Field>
          <Field label="Remarks"><input maxLength={1000} className={inputClass} value={applicationEditForm.remarks || ''} onChange={(event) => setApplicationEditForm({ ...applicationEditForm, remarks: event.target.value })} /></Field>
        </div>
      </section>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setTab('applications')} className="border border-gray-700 px-4 py-2 text-sm text-gray-300">Cancel</button><button disabled={busy} className="bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button></div>
    </form>}

    {tab === 'manage-fees' && <section className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(160px,1fr)_auto]"><input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find application by ID, name, CNIC or phone" /><button type="button" onClick={() => void loadApplications(search, schemeFilter, statusFilter)} className="border border-gray-700 px-4 text-sm text-gray-200 hover:bg-gray-800">Find</button></div>
      {selected && <section className={`${sectionClass} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-100">{selected.applicant_name}</h2><p className="text-xs text-gray-500">{selected.application_no} · {selected.scheme_name} · {selected.mobile || 'No phone'}</p></div><div className="text-right"><p className="text-xs text-gray-500">Outstanding</p><p className="text-lg font-semibold text-amber-300">{money(selected.balance)}</p></div></div>
        <div className="grid gap-3 sm:grid-cols-4"><Metric label="Application fee" value={money(selected.application_fee)} /><Metric label="Discount" value={money(selected.discount_amount)} /><Metric label="Paid" value={money(selected.total_paid)} /><Metric label="Processing status" value={selected.status.replaceAll('_', ' ')} /></div>
        {selected.balance > 0 && selected.status !== 'CANCELLED' && selected.status !== 'REJECTED' && <form onInvalidCapture={(event) => {
          event.preventDefault()
          setError('Enter an amount from 1 PKR up to the outstanding balance and check the required fields.')
        }} onSubmit={(event) => void submitPayment(event)} className="grid gap-3 border-t border-gray-800 pt-4 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Amount received (PKR)" required><input required type="number" min="1" max={selected.balance} step="1" className={inputClass} value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></Field>
          <Field label="Payment method" required><select required className={inputClass} value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value as PayMethod })}><option value="CASH">Cash</option><option value="BANK">Bank transfer</option><option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option><option value="OTHER">Other</option></select></Field>
          <Field label="Reference"><input maxLength={100} className={inputClass} value={paymentForm.referenceNumber} onChange={(event) => setPaymentForm({ ...paymentForm, referenceNumber: event.target.value })} /></Field>
          <Field label="Remarks"><input maxLength={500} className={inputClass} value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></Field>
          <div className="flex items-end"><button disabled={busy} className="w-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">{busy ? 'Saving…' : 'Save payment'}</button></div>
        </form>}
        <PaymentHistory application={selected} canManage={canManage} onReverse={(id) => void reversePayment(id)} onPrint={(payment) => {
          setReceipt({ applicant: selected, payment: {
            receiptNumber: payment.receipt_no, amount: payment.amount,
            balance: payment.balance_after ?? selected.balance, paidAt: payment.paid_at,
            method: payment.method, referenceNumber: payment.reference_no
          } })
          if (receiptSettings) setTimeout(() => window.print(), 0)
          else setError('Receipt settings are not ready. Wait for them to load, then print the receipt.')
        }} />
      </section>}
      {!selected && <section className={sectionClass}><ApplicationTable rows={applications} onOpen={(id) => void openApplication(id)} onManageFees={(id) => void openApplicationFees(id)} /></section>}
    </section>}

    {receipt && <div className="print-receipt mx-auto w-full max-w-2xl border border-gray-700 bg-white p-6 text-gray-950">
      <div className="text-center"><h2 className="text-xl font-bold">{receiptSettings?.shop_name || ''}</h2><p className="text-sm">Scheme Application Fee Receipt</p></div>
      <div className="my-4 grid grid-cols-2 gap-2 border-y border-gray-300 py-3 text-sm">
        <span>Receipt: <strong>{receipt.payment.receiptNumber}</strong></span><span>Application: <strong>{receipt.applicant.application_no}</strong></span>
        <span>Scheme: {receipt.applicant.scheme_name}</span><span>Date: {receipt.payment.paidAt}</span>
        <span>Applicant: {receipt.applicant.applicant_name}</span><span>Father / Husband: {receipt.applicant.father_name || '—'}</span>
        <span>CNIC: {receipt.applicant.cnic || 'Restricted'}</span><span>Phone: {receipt.applicant.mobile || '—'}</span>
        <span>Application fee: {money(receipt.applicant.application_fee)}</span><span>Discount: {money(receipt.applicant.discount_amount)}</span>
        <span>Previously paid: {money(Math.max(0, receipt.applicant.application_fee - receipt.applicant.discount_amount - receipt.payment.balance - receipt.payment.amount))}</span><span>Received: {money(receipt.payment.amount)}</span>
        <span>Remaining balance: {money(receipt.payment.balance)}</span><span>Method: {receipt.payment.method}</span>
        <span>Reference: {receipt.payment.referenceNumber || '—'}</span>
      </div>
      <p className="mt-8 text-right text-sm">Authorized signature: __________________</p>
      <div className="no-print mt-4 flex justify-end gap-2"><button type="button" disabled={!receiptSettings} onClick={() => window.print()} className="border border-gray-400 px-3 py-2 text-sm disabled:opacity-50">Print / reprint</button><button type="button" onClick={() => setReceipt(null)} className="border border-gray-400 px-3 py-2 text-sm">Close receipt</button></div>
    </div>}
    <style>{`@media print { body * { visibility: hidden !important; } .print-receipt, .print-receipt * { visibility: visible !important; } .print-receipt { position: absolute !important; inset: 0 auto auto 0 !important; width: ${receiptSettings ? receiptWidthMm(receiptSettings) : 80}mm !important; max-width: none !important; border: 0 !important; } .no-print { display: none !important; } }`}</style>
  </div>
}

function SchemeCard({ scheme, canManage, onEdit, onLifecycle, onView }: {
  scheme: SchemeRow; canManage: boolean; onEdit: () => void; onLifecycle: (status: SchemeRow['lifecycle_status']) => void; onView: () => void
}) {
  return <article className={`${sectionClass} space-y-3`}>
    <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-gray-100">{scheme.name}</h3><p className="text-xs text-gray-500">{scheme.scheme_code} · {scheme.category || 'General'}</p></div><span className={`text-xs ${scheme.lifecycle_status === 'ACTIVE' ? 'text-emerald-300' : 'text-amber-300'}`}>{scheme.lifecycle_status}</span></div>
    <p className="line-clamp-2 min-h-8 text-xs text-gray-400">{scheme.description || 'No description'}</p>
    <div className="grid grid-cols-2 gap-2 text-xs"><div><p className="text-gray-500">Applications</p><p className="text-gray-200">{scheme.application_count} · today {scheme.today_applications}</p></div><div><p className="text-gray-500">Default fee</p><p className="text-gray-200">{money(scheme.default_fee)}</p></div><div><p className="text-gray-500">Collected</p><p className="text-emerald-300">{money(scheme.fees_collected)}</p></div><div><p className="text-gray-500">Outstanding</p><p className="text-amber-300">{money(scheme.outstanding)}</p></div></div>
    <div className="grid grid-cols-2 gap-2">{canManage && <><button type="button" onClick={onEdit} className="border border-gray-700 px-3 py-2 text-xs text-gray-300">Edit scheme</button>{scheme.lifecycle_status === 'ACTIVE' ? <><button type="button" onClick={() => onLifecycle('CLOSED')} className="border border-gray-700 px-3 py-2 text-xs text-gray-300">Close scheme</button><button type="button" onClick={() => onLifecycle('SUSPENDED')} className="border border-amber-900 px-3 py-2 text-xs text-amber-300">Suspend scheme</button></> : <button type="button" onClick={() => onLifecycle('ACTIVE')} className="border border-gray-700 px-3 py-2 text-xs text-gray-300">Activate scheme</button>}</>}<button type="button" onClick={onView} className="col-span-2 border border-brand-700 px-3 py-2 text-xs text-brand-300 hover:bg-brand-950">View applications</button></div>
  </article>
}

function ApplicationTable({ rows, onOpen, onEdit, onManageFees }: {
  rows: SchemeApplicationRow[]
  onOpen: (id: number) => void
  onEdit?: (id: number) => void
  onManageFees?: (id: number) => void
}) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs">
    <thead className="border-b border-gray-800 text-gray-500"><tr>{['Application ID', 'Applicant / CNIC', 'Scheme / Category', 'Date', 'Status', 'Fee', 'Paid', 'Balance', ''].map((head) => <th key={head} className="px-2 py-3 font-medium">{head}</th>)}</tr></thead>
    <tbody className="divide-y divide-gray-800">{rows.map((row) => <tr key={row.id} className="hover:bg-gray-800/60">
      <td className="px-2 py-3 text-brand-300">{row.application_no}</td><td className="px-2 py-3"><span className="block text-gray-200">{row.applicant_name}</span><span className="text-gray-500">{row.cnic || 'CNIC hidden'}</span></td>
      <td className="px-2 py-3"><span className="block text-gray-200">{row.scheme_name}</span><span className="text-gray-500">{row.category || '—'}</span></td>
      <td className="px-2 py-3 text-gray-300">{row.application_date}</td><td className="px-2 py-3 text-gray-300">{row.status.replaceAll('_', ' ')}</td>
      <td className="px-2 py-3 text-gray-300">{money(row.application_fee - row.discount_amount)}</td><td className="px-2 py-3 text-gray-300">{money(row.total_paid)}</td>
      <td className={`px-2 py-3 ${row.balance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{money(row.balance)}</td>
      <td className="px-2 py-3"><div className="flex gap-2">{onEdit && <button type="button" onClick={() => onEdit(row.id)} className="border border-gray-700 px-2.5 py-1.5 text-gray-300 hover:bg-gray-800">Edit</button>}<button type="button" onClick={() => onOpen(row.id)} className="border border-brand-700 px-2.5 py-1.5 text-brand-300 hover:bg-brand-950">Open</button>{onManageFees && <button type="button" onClick={() => onManageFees(row.id)} className="whitespace-nowrap border border-gray-700 px-2.5 py-1.5 text-gray-300 hover:bg-gray-800">Manage Fees</button>}</div></td>
    </tr>)}</tbody></table>{rows.length === 0 && <Empty text="No scheme applications found." />}</div>
}

function ApplicationProfile({ application, canManage, onEdit, onStatus, canMoveTo, onCollect, onReverse, onPrintPayment }: {
  application: SchemeApplicationDetail; canManage: boolean; onStatus: (status: SchemeStatus) => void
  onEdit: () => void
  canMoveTo: (status: SchemeStatus) => boolean; onCollect: () => void; onReverse: (paymentId: number) => void
  onPrintPayment: (payment: SchemeApplicationDetail['payments'][number]) => void
}) {
  return <section className={`${sectionClass} space-y-4`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-brand-300">{application.application_no}</p><h2 className="text-lg font-semibold text-gray-100">{application.applicant_name}</h2><p className="text-xs text-gray-500">{application.scheme_name} · {application.father_name || '—'} · {application.mobile || 'No phone'}</p></div><div className="flex flex-wrap gap-2">{canManage && <button type="button" onClick={onEdit} className="border border-gray-700 px-3 py-2 text-xs text-gray-200">Edit details</button>}<button type="button" onClick={onCollect} className="bg-brand-700 px-3 py-2 text-xs text-white">Collect fee</button>{statuses.filter(canMoveTo).map((status) => <button key={status} type="button" onClick={() => onStatus(status)} className="border border-gray-700 px-3 py-2 text-xs text-gray-200">{status.replaceAll('_', ' ')}</button>)}</div></div>
    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5"><Metric label="CNIC" value={application.cnic || 'Hidden'} /><Metric label="Phone" value={application.mobile || '—'} /><Metric label="City / district" value={[application.city, application.district].filter(Boolean).join(' / ') || '—'} /><Metric label="Fee / discount" value={`${money(application.application_fee)} / ${money(application.discount_amount)}`} /><Metric label="Paid / balance" value={`${money(application.total_paid)} / ${money(application.balance)}`} /></div>
    {application.address && <p className="text-xs text-gray-400">Address: {application.address}</p>}
    {application.purpose && <p className="text-xs text-gray-400">Purpose: {application.purpose}</p>}
    <div className="grid gap-4 lg:grid-cols-2"><div><h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">Payment history</h3><PaymentHistory application={application} canManage={canManage} onReverse={onReverse} onPrint={onPrintPayment} /></div>
      <div><h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">Status history</h3><div className="space-y-2">{application.status_history.map((item) => <div key={item.id} className="border-l border-gray-700 pl-3 text-xs"><p className="text-gray-200">{item.to_status.replaceAll('_', ' ')} <span className="text-gray-500">· {item.changed_at}</span></p><p className="text-gray-500">{item.changed_by_name}{item.remarks ? ` · ${item.remarks}` : ''}</p></div>)}</div></div></div>
  </section>
}

function PaymentHistory({ application, canManage, onReverse, onPrint }: {
  application: SchemeApplicationDetail; canManage: boolean; onReverse: (id: number) => void; onPrint: (payment: SchemeApplicationDetail['payments'][number]) => void
}) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Receipt', 'Date', 'Amount', 'Method', 'Reference', 'State', ''].map((head) => <th key={head} className="px-2 py-2">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{application.payments.map((payment) => <tr key={payment.id}><td className="px-2 py-2 text-brand-300">{payment.receipt_no}</td><td className="px-2 py-2 text-gray-300">{payment.paid_at}</td><td className="px-2 py-2 text-gray-200">{money(payment.amount)}</td><td className="px-2 py-2 text-gray-300">{payment.method}</td><td className="px-2 py-2 text-gray-400">{payment.reference_no || '—'}</td><td className="px-2 py-2 text-gray-300">{payment.reversed ? `Reversed: ${payment.reversal_reason}` : 'Posted'}</td><td className="px-2 py-2"><div className="flex gap-2"><button type="button" onClick={() => onPrint(payment)} className="text-brand-300">Print</button>{canManage && !payment.reversed && <button type="button" onClick={() => onReverse(payment.id)} className="text-red-300">Reverse</button>}</div></td></tr>)}</tbody></table>{application.payments.length === 0 && <p className="py-3 text-xs text-gray-500">No fee payments recorded.</p>}</div>
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-gray-400">{label}{required ? ' *' : ''}</span>{children}</label>
}

function CalendarDateInput({ value, onChange, required = false, ariaLabel }: {
  value: string
  onChange: (value: string) => void
  required?: boolean
  ariaLabel?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <div className="relative">
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      className={`${inputClass} pr-10 [color-scheme:dark]`}
      type="date"
      required={required}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
    <button
      type="button"
      aria-label="Open calendar"
      title="Open calendar"
      onClick={() => inputRef.current?.showPicker()}
      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-brand-300"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <rect x="2.75" y="4.25" width="14.5" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 2.75v3M13.5 2.75v3M3 8h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  </div>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="border border-gray-800 bg-gray-900/60 p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold text-gray-100">{value}</p></div>
}

function Empty({ text }: { text: string }) {
  return <p className="py-7 text-center text-sm text-gray-500">{text}</p>
}

function Feedback({ type, message, onClose }: { type: 'error' | 'success'; message: string; onClose: () => void }) {
  const isError = type === 'error'
  return <div className={`fixed right-4 top-4 z-[100] flex w-[min(26rem,calc(100vw-2rem))] items-start justify-between gap-3 border bg-gray-900 p-4 shadow-2xl ${isError ? 'border-red-900' : 'border-emerald-900'}`} role={isError ? 'alert' : 'status'}>
    <div><p className={`text-sm font-semibold ${isError ? 'text-red-300' : 'text-emerald-300'}`}>{isError ? 'Please check' : 'Success'}</p><p className="mt-1 break-words text-sm text-gray-200">{message}</p></div><button type="button" onClick={onClose} className="text-xs text-gray-400 hover:text-white">Close</button>
  </div>
}
