import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Role } from '@shared/constants'
import type {
  AdmissionClassRow, AdmissionDetail, AdmissionPaymentResult, AdmissionPaymentRow, AdmissionStudentRow,
  AdmissionDocumentCategoryType, AdmissionDocumentRow, SettingsRow
} from '@shared/schemas'
import { getReceiptSettings, receiptWidthMm } from '../utils/receipt-settings'

type Tab = 'overview' | 'students' | 'new-student' | 'classes' | 'manage-fees'
type PayMethod = 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'

const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4 sm:p-5'

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(amount)
}

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

function friendlyErrorMessage(message: string): string {
  if (message.includes('Only Admin or Manager')) return 'Your account does not have permission to change admission fees or discounts.'
  if (message.includes('Payment cannot exceed')) return 'The payment is greater than the remaining balance. Enter a smaller amount.'
  if (message.includes('outstanding admission fee balance')) return 'This student has no outstanding admission fee balance.'
  if (message.includes('UNIQUE constraint failed')) return 'A record with these details already exists. Please check the information and try again.'
  if (/String must|Expected |Invalid |Required/i.test(message)) return 'Some information is missing or invalid. Please check the form and try again.'
  if (message.includes('no such column')) return 'The database needs an update. Restart the application to apply the latest changes.'
  return message
}

export default function AdmissionsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [role, setRole] = useState<Role>('CASHIER')
  const [classes, setClasses] = useState<AdmissionClassRow[]>([])
  const [students, setStudents] = useState<AdmissionStudentRow[]>([])
  const [overviewStudents, setOverviewStudents] = useState<AdmissionStudentRow[]>([])
  const [boardOptions, setBoardOptions] = useState<string[]>([])
  const [selected, setSelected] = useState<AdmissionDetail | null>(null)
  const [summary, setSummary] = useState({ activeStudents: 0, newThisMonth: 0, collectedToday: 0, collectedThisMonth: 0, outstanding: 0, pendingDues: 0 })
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [boardFilter, setBoardFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [slipFilter, setSlipFilter] = useState('')
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
  const [busy, setBusy] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [receipt, setReceipt] = useState<{ payment: AdmissionPaymentResult; admission: AdmissionDetail } | null>(null)

  const [className, setClassName] = useState('')
  const [academicYear, setAcademicYear] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`)
  const [classAdmissionFee, setClassAdmissionFee] = useState('0')

  const [studentForm, setStudentForm] = useState({
    fullName: '', fatherName: '', fatherCnic: '', bFormNumber: '', phone: '', fatherPhone: '',
    whatsapp: '', dateOfBirth: '', gender: '', address: '', classId: '',
    admissionDate: today(), program: '', educationBoard: '', subjects: '', admissionFee: '0',
    admissionDiscount: '0', admissionFeeDueDate: ''
  })
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>('CASH')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID())
  const [receiptSettings, setReceiptSettings] = useState<SettingsRow | null>(null)
  const canManage = role === 'ADMIN' || role === 'MANAGER'
  const classOptions = useMemo(() => classes.map((item) => ({
    id: String(item.id), name: `${item.class_name} — ${item.academic_year}`
  })), [classes])
  const loadClasses = useCallback(async () => {
    const result = await window.api.admissionsClasses()
    if (result.ok) setClasses(result.data)
    else setError(result.error.message)
  }, [])

  const loadStudents = useCallback(async (
    query = '', classId = '', educationBoard = '', paymentStatus = '', slipStatus = ''
  ) => {
    const result = await window.api.admissionsStudents(
      query, classId ? Number(classId) : undefined, educationBoard || undefined,
      paymentStatus ? paymentStatus as AdmissionStudentRow['payment_status'] : undefined,
      slipStatus ? slipStatus as AdmissionStudentRow['slip_status'] : undefined
    )
    if (result.ok) {
      setStudents(result.data)
      setBoardOptions((current) => [...new Set([
        ...current, ...result.data.map((student) => student.education_board).filter(
          (board): board is string => Boolean(board)
        )
      ])].sort())
    }
    else setError(result.error.message)
  }, [])

  const loadOverviewStudents = useCallback(async () => {
    const result = await window.api.admissionsStudents()
    if (result.ok) setOverviewStudents(result.data)
    else setError(result.error.message)
  }, [])

  const loadSummary = useCallback(async () => {
    const result = await window.api.admissionsSummary()
    if (result.ok) setSummary(result.data)
    else setError(result.error.message)
  }, [])

  const openAdmission = async (admissionId: number) => {
    const result = await window.api.admissionsDetail(admissionId)
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    setSelected(result.data)
    return true
  }

  const openFeeManagement = async (admissionId: number) => {
    if (await openAdmission(admissionId)) setTab('manage-fees')
  }

  const refresh = async () => {
    await Promise.all([
      loadClasses(), loadStudents(search, classFilter, boardFilter, paymentFilter, slipFilter),
      loadOverviewStudents(), loadSummary()
    ])
    if (selected) await openAdmission(selected.admission_id)
  }

  useEffect(() => {
    void (async () => {
      const session = await window.api.authGetSession()
      if (session.ok && session.data) setRole(session.data.role)
      const settings = getReceiptSettings().then(setReceiptSettings).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Receipt settings could not be loaded.')
      })
      await Promise.all([loadClasses(), loadStudents('', ''), loadOverviewStudents(), loadSummary(), settings])
    })()
  }, [loadClasses, loadStudents, loadSummary])

  const updateStudentField = (field: keyof typeof studentForm, value: string) => {
    setStudentForm((current) => ({ ...current, [field]: value }))
  }

  const submitClass = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const result = await window.api.admissionsClassCreate({
      className, academicYear,
      admissionFee: Number(classAdmissionFee)
    })
    if (!result.ok) return setError(result.error.message)
    setClassName('')
    setClassAdmissionFee('0')
    setNotice('Class folder created.')
    await loadClasses()
  }

  const submitStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const payload = {
      ...studentForm,
      classId: Number(studentForm.classId),
      gender: studentForm.gender ? studentForm.gender as 'MALE' | 'FEMALE' | 'OTHER' : undefined,
      admissionFee: Number(studentForm.admissionFee),
      admissionDiscount: Number(studentForm.admissionDiscount),
      dateOfBirth: studentForm.dateOfBirth || undefined,
      admissionFeeDueDate: studentForm.admissionFeeDueDate || undefined
    }
    const result = await window.api.admissionsStudentCreate(payload)
    if (!result.ok) {
      setBusy(false)
      return setError(result.error.message)
    }
    setNotice(`Student admitted. Student ID: ${result.data.studentNo}`)
    await Promise.all([loadStudents('', ''), loadOverviewStudents(), loadSummary(), loadClasses()])
    await openAdmission(result.data.admissionId)
    setStudentForm((current) => ({
      ...current, fullName: '', fatherName: '', fatherCnic: '', bFormNumber: '', phone: '',
      fatherPhone: '', whatsapp: '', dateOfBirth: '', gender: '', address: '',
      program: '', educationBoard: '', admissionFee: '0', admissionDiscount: '0',
      subjects: '', admissionFeeDueDate: ''
    }))
    setTab('students')
    setBusy(false)
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    const result = await window.api.admissionsPaymentCreate({
      admissionId: selected.admission_id, idempotencyKey: paymentKey,
      amount: Number(paymentAmount), method: paymentMethod,
      referenceNumber: paymentReference, notes: paymentNotes
    })
    if (!result.ok) {
      setBusy(false)
      return setError(result.error.message)
    }
    const refreshed = await window.api.admissionsDetail(selected.admission_id)
    const receiptAdmission = refreshed.ok ? refreshed.data : selected
    setReceipt({ payment: result.data, admission: receiptAdmission })
    setSelected(receiptAdmission)
    setPaymentKey(crypto.randomUUID())
    setPaymentAmount('')
    setPaymentReference('')
    setPaymentNotes('')
    setNotice(`Payment saved. Receipt ${result.data.receiptNumber}`)
    await Promise.all([loadStudents(), loadOverviewStudents(), loadSummary()])
    setBusy(false)
  }

  const exportStudents = () => {
    const headers = ['Student ID', 'Student', 'Father', 'Phone', 'Class', 'Academic year', 'Board', 'Subjects / stream', 'Admission date', 'Roll No', 'Registration No', 'Fee Status', 'Slip Status', 'Charges (PKR)', 'Discounts (PKR)', 'Paid (PKR)', 'Balance (PKR)']
    const values = students.map((student) => [
      student.student_no, student.full_name, student.father_name, student.phone ?? '',
      student.class_name, student.academic_year, student.education_board ?? '', student.subjects ?? '',
      student.admission_date, student.roll_number ?? '', student.registration_number ?? '',
      student.payment_status, student.slip_status, student.total_charges, student.total_discounts,
      student.total_paid, student.balance
    ])
    const csv = [headers, ...values].map((row) => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `admissions-${today()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportStudentsExcel = async () => {
    setError('')
    setExportingExcel(true)
    try {
      const XLSX = await import('xlsx')
      const headers = ['Student ID', 'Student', 'Father', 'Phone', 'Class', 'Academic year', 'Board', 'Subjects / stream', 'Admission date', 'Roll No', 'Registration No', 'Fee Status', 'Slip Status', 'Charges (PKR)', 'Discounts (PKR)', 'Paid (PKR)', 'Balance (PKR)']
      const rows = students.map((student) => [
        student.student_no, student.full_name, student.father_name, student.phone ?? '',
        student.class_name, student.academic_year, student.education_board ?? '', student.subjects ?? '', student.admission_date,
        student.roll_number ?? '', student.registration_number ?? '', student.payment_status, student.slip_status,
        student.total_charges, student.total_discounts, student.total_paid, student.balance
      ])
      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
      worksheet['!cols'] = [
        { wch: 16 }, { wch: 28 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 },
        { wch: 20 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 14 },
        { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }
      ]
      worksheet['!autofilter'] = { ref: `A1:Q${Math.max(rows.length + 1, 1)}` }
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Students')
      const content = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }))
      const result = await window.api.admissionsStudentsExportExcel(content)
      if (!result.ok) setError(result.error.message)
      else if (result.data.saved) setNotice('Student list exported to Excel.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Excel export failed.')
    } finally {
      setExportingExcel(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <style>{`@media print { body * { visibility: hidden !important; } #admission-receipt, #admission-receipt *, #admissions-report, #admissions-report * { visibility: visible !important; } #admission-receipt { display: block !important; position: absolute; inset: 0; width: ${receiptSettings ? receiptWidthMm(receiptSettings) : 80}mm; padding: 6mm; color: #000; background: #fff; font: 12px Arial, sans-serif; } #admissions-report { display: block !important; position: absolute; inset: 0; width: 100%; padding: 8mm; color: #000; background: #fff; font: 10px Arial, sans-serif; } #admissions-report table { width: 100%; border-collapse: collapse; } #admissions-report th, #admissions-report td { border: 1px solid #999; padding: 4px; color: #000 !important; } }`}</style>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-800 pb-4">
        <div><p className="text-xs font-semibold uppercase text-brand-400">Module 5</p><h1 className="mt-1 text-xl font-semibold text-gray-100">Admissions & Fees</h1><p className="mt-1 text-sm text-gray-500">Manage academic class folders, student admissions and fee ledgers.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportStudents} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">Export CSV</button>
          <button type="button" disabled={exportingExcel} onClick={() => void exportStudentsExcel()} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50">{exportingExcel ? 'Preparing Excel…' : 'Export Excel'}</button>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-gray-800" aria-label="Admissions sections">
        {([['overview', 'Overview'], ['students', 'Students & Fees'], ['new-student', 'Add Student'], ['classes', 'Classes & Sessions']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`border-b-2 px-3 py-2.5 text-sm ${tab === id ? 'border-brand-400 text-brand-300' : 'border-transparent text-gray-500 hover:text-gray-200'}`}>{label}</button>
        ))}
      </nav>

      {tab === 'overview' && <section className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Metric label="Active students" value={summary.activeStudents.toLocaleString()} />
          <Metric label="New admissions this month" value={summary.newThisMonth.toLocaleString()} />
          <Metric label="Fees collected today" value={formatMoney(summary.collectedToday)} />
          <Metric label="Fees collected this month" value={formatMoney(summary.collectedThisMonth)} />
          <Metric label="Outstanding balance" value={formatMoney(summary.outstanding)} />
          <Metric label="Students with dues" value={summary.pendingDues.toLocaleString()} />
        </div>
        <section className={sectionClass}>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-100">Students with outstanding fees</h2><button type="button" onClick={() => void refresh()} className="text-xs text-brand-300">Refresh</button></div>
          <StudentTable students={overviewStudents.filter((student) => student.balance > 0).slice(0, 10)} onManageFees={(id) => void openFeeManagement(id)} />
        </section>
        <section className={sectionClass}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-100">Roll-number slips due today or overdue</h2>
            <span className="text-xs text-amber-300">{overviewStudents.filter((student) =>
              student.slip_status !== 'SLIP_DELIVERED' && student.expected_slip_date && student.expected_slip_date <= today()
            ).length} pending</span>
          </div>
          <StudentTable students={overviewStudents.filter((student) =>
            student.slip_status !== 'SLIP_DELIVERED' && student.expected_slip_date && student.expected_slip_date <= today()
          ).slice(0, 10)} onManageFees={(id) => void openFeeManagement(id)} />
        </section>
      </section>}

      {tab === 'students' && <section className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(160px,1fr)_200px_180px_200px_auto_auto_auto]">
          <input className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void loadStudents(search, classFilter, boardFilter, paymentFilter, slipFilter) }} placeholder="Search name, CNIC, mobile, roll no." aria-label="Search students" />
          <select className={inputClass} value={classFilter} onChange={(event) => setClassFilter(event.target.value)} aria-label="Filter by class">
            <option value="">All class folders</option>{classOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className={inputClass} value={boardFilter} onChange={(event) => setBoardFilter(event.target.value)} aria-label="Filter by education board">
            <option value="">All boards</option>{boardOptions.map((board) => <option key={board} value={board}>{board}</option>)}
          </select>
          <select className={inputClass} value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} aria-label="Filter by payment status">
            <option value="">All fee statuses</option><option value="UNPAID">Unpaid</option><option value="PARTIAL">Partial</option><option value="PAID">Paid</option>
          </select>
          <select className={inputClass} value={slipFilter} onChange={(event) => setSlipFilter(event.target.value)} aria-label="Filter by roll slip status">
            <option value="">All slip statuses</option><option value="PENDING">Pending</option><option value="READY_TO_CALL">Ready to Call</option><option value="CALLED_INFORMED">Called & Informed</option><option value="SLIP_DELIVERED">Slip Delivered</option>
          </select>
          <button type="button" onClick={() => void loadStudents(search, classFilter, boardFilter, paymentFilter, slipFilter)} className="border border-gray-700 px-4 text-sm text-gray-200 hover:bg-gray-800">Search</button>
          <button type="button" onClick={() => setTab('new-student')} className="bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-500">Add student</button>
          <button type="button" onClick={() => window.print()} className="border border-gray-700 px-4 text-sm text-gray-200 hover:bg-gray-800">Print report</button>
        </div>
        <section id="admissions-report" className={sectionClass}>
          <h2 className="mb-3 hidden text-lg font-semibold print:block">Admissions & Fee Report</h2>
          <StudentTable students={students} onManageFees={(id) => void openFeeManagement(id)} />
        </section>
      </section>}

      {tab === 'manage-fees' && selected && <section className="space-y-4">
        <button type="button" onClick={() => setTab('students')} className="border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800">Back to students</button>
        <div>
          <h2 className="text-xl font-semibold text-gray-100">Manage admission fees</h2>
          <p className="mt-1 text-sm text-gray-400">Review the admission-fee balance, record a payment, or reprint a receipt.</p>
        </div>
        <AdmissionLedger admission={selected} onPayment={submitPayment} onValidationError={setError}
          paymentAmount={paymentAmount} setPaymentAmount={setPaymentAmount} paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod} paymentReference={paymentReference} setPaymentReference={setPaymentReference}
          paymentNotes={paymentNotes} setPaymentNotes={setPaymentNotes} busy={busy}
          onReceipt={(payment) => setReceipt({
            admission: selected,
            payment: {
              receiptNumber: payment.receipt_no,
              amount: payment.amount,
              balance: payment.balance_after ?? selected.balance,
              paidAt: payment.paid_at,
              method: payment.method,
              referenceNumber: payment.reference_no
            }
          })} />
        <SlipWorkflow admission={selected} canManage={canManage}
          onSaved={async () => {
            await Promise.all([
              openAdmission(selected.admission_id),
              loadStudents(search, classFilter, boardFilter, paymentFilter, slipFilter),
              loadOverviewStudents()
            ])
            setNotice('Roll-number slip details updated.')
          }} onError={setError} />
        <AdmissionDocuments admissionId={selected.admission_id} canManage={canManage}
          onError={setError} onNotice={setNotice} />
      </section>}

      {tab === 'new-student' && <form onInvalidCapture={(event) => {
        event.preventDefault()
        setError('Please complete the required fields and check the highlighted values.')
      }} onSubmit={(event) => void submitStudent(event)} className="space-y-5">
        <section className={sectionClass}>
          <h2 className="mb-4 text-sm font-semibold text-gray-100">Student & Guardian</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Student full name" required><input className={inputClass} required maxLength={100} value={studentForm.fullName} onChange={(event) => updateStudentField('fullName', event.target.value)} /></Field>
            <Field label="Father / guardian name" required><input className={inputClass} required maxLength={100} value={studentForm.fatherName} onChange={(event) => updateStudentField('fatherName', event.target.value)} /></Field>
            <Field label="Father CNIC (optional)"><input className={inputClass} value={studentForm.fatherCnic} onChange={(event) => updateStudentField('fatherCnic', event.target.value)} placeholder="XXXXX-XXXXXXX-X" /></Field>
            <Field label="B-Form number (optional)"><input className={inputClass} value={studentForm.bFormNumber} onChange={(event) => updateStudentField('bFormNumber', event.target.value)} /></Field>
            <Field label="Student contact"><input className={inputClass} value={studentForm.phone} onChange={(event) => updateStudentField('phone', event.target.value)} /></Field>
            <Field label="Father contact"><input className={inputClass} value={studentForm.fatherPhone} onChange={(event) => updateStudentField('fatherPhone', event.target.value)} /></Field>
            <Field label="WHATSAPP NUMBER (OPTIONAL)"><input className={inputClass} value={studentForm.whatsapp} onChange={(event) => updateStudentField('whatsapp', event.target.value)} /></Field>
            <Field label="Date of birth"><CalendarDateInput value={studentForm.dateOfBirth} onChange={(value) => updateStudentField('dateOfBirth', value)} /></Field>
            <Field label="Gender"><select className={inputClass} value={studentForm.gender} onChange={(event) => updateStudentField('gender', event.target.value)}><option value="">Not specified</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select></Field>
            <Field label="RESIDENTIAL ADDRESS (OPTIONAL)"><input className={inputClass} value={studentForm.address} onChange={(event) => updateStudentField('address', event.target.value)} /></Field>
          </div>
        </section>
        <section className={sectionClass}>
          <h2 className="mb-4 text-sm font-semibold text-gray-100">Admission & Academic Details</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Class / academic year" required><select required className={inputClass} value={studentForm.classId} onChange={(event) => {
              const nextClass = classes.find((item) => String(item.id) === event.target.value)
              setStudentForm((current) => ({ ...current, classId: event.target.value, admissionFee: String(nextClass?.admission_fee ?? 0) }))
            }}><option value="">Select class folder</option>{classOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Admission date" required><CalendarDateInput required value={studentForm.admissionDate} onChange={(value) => updateStudentField('admissionDate', value)} /></Field>
            <Field label="Program / degree"><input className={inputClass} value={studentForm.program} onChange={(event) => updateStudentField('program', event.target.value)} /></Field>
            <Field label="Education board"><input className={inputClass} value={studentForm.educationBoard} onChange={(event) => updateStudentField('educationBoard', event.target.value)} /></Field>
            <Field label="Subjects / stream"><input className={inputClass} maxLength={300} value={studentForm.subjects} onChange={(event) => updateStudentField('subjects', event.target.value)} placeholder="e.g. Pre-medical, Biology, Chemistry" /></Field>
          </div>
        </section>
        <section className={sectionClass}>
          <h2 className="mb-4 text-sm font-semibold text-gray-100">Initial Admission Fee (whole PKR)</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Admission fee"><input className={inputClass} type="number" min="0" step="1" value={studentForm.admissionFee} onChange={(event) => updateStudentField('admissionFee', event.target.value)} /></Field>
            <Field label="Scholarship / discount"><input className={inputClass} type="number" min="0" step="1" value={studentForm.admissionDiscount} onChange={(event) => updateStudentField('admissionDiscount', event.target.value)} /></Field>
            <Field label="Fee due date"><CalendarDateInput value={studentForm.admissionFeeDueDate} onChange={(value) => updateStudentField('admissionFeeDueDate', value)} /></Field>
          </div>
          <p className="mt-3 text-xs text-gray-500">Payment is recorded separately from admission. Collect it from the student ledger after saving.</p>
        </section>
        <div className="flex justify-end"><button type="submit" disabled={busy || classes.length === 0} className="bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save admission'}</button></div>
        {classes.length === 0 && <p className="text-right text-xs text-amber-400">Create a class folder before adding students.</p>}
      </form>}

      {tab === 'classes' && <div className="grid gap-5 xl:grid-cols-2">
        {canManage && <form onInvalidCapture={(event) => {
          event.preventDefault()
          setError('Please enter the required class details before saving.')
        }} onSubmit={(event) => void submitClass(event)} className={`${sectionClass} space-y-3`}>
          <h2 className="text-sm font-semibold text-gray-100">Create class folder</h2>
          <Field label="Class name" required><input className={inputClass} required maxLength={80} value={className} onChange={(event) => setClassName(event.target.value)} placeholder="e.g. 9th, 1st Year" /></Field>
          <Field label="Academic year / session" required><input className={inputClass} required minLength={4} maxLength={20} value={academicYear} onChange={(event) => setAcademicYear(event.target.value)} /></Field>
          <Field label="Standard admission fee (PKR)"><input className={inputClass} type="number" min="0" step="1" value={classAdmissionFee} onChange={(event) => setClassAdmissionFee(event.target.value)} /></Field>
          <button className="bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Create class</button>
        </form>}
        <section className={`${sectionClass} ${canManage ? 'xl:col-span-2' : ''}`}>
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Class folders</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[400px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Class', 'Academic year', 'Active students', 'Standard admission fee'].map((head) => <th key={head} className="px-2 py-3 font-medium">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{classes.map((item) => <tr key={item.id}><td className="px-2 py-3 text-gray-200">{item.class_name}</td><td className="px-2 py-3 text-gray-300">{item.academic_year}</td><td className="px-2 py-3 text-gray-300">{item.student_count}</td><td className="px-2 py-3 text-gray-300">{formatMoney(item.admission_fee)}</td></tr>)}</tbody></table>{classes.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No class folders yet.</p>}</div>
        </section>
      </div>}

        {receipt && <div className="flex items-center justify-between border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">
          <span>Receipt ready: {receipt.payment.receiptNumber}</span>
          <button type="button" disabled={!receiptSettings} onClick={() => window.print()} className="border border-emerald-800 px-3 py-1.5 text-xs hover:bg-emerald-900/40 disabled:opacity-50">Print / reprint receipt</button>
        </div>}
        {receipt && <article id="admission-receipt" className="hidden">
          <h1>{receiptSettings?.shop_name || ''}</h1><p>Admission fee receipt</p><hr />
          <p>Receipt: {receipt.payment.receiptNumber}</p><p>Date: {new Date(receipt.payment.paidAt).toLocaleString()}</p>
          <p>Student ID: {receipt.admission.student_no}</p><p>Student: {receipt.admission.full_name}</p>
          <p>Father: {receipt.admission.father_name}</p><p>Class: {receipt.admission.class_name} ({receipt.admission.academic_year})</p>
          <p>Amount received: {formatMoney(receipt.payment.amount)}</p><p>Payment method: {receipt.payment.method}</p>
          {receipt.payment.referenceNumber && <p>Reference: {receipt.payment.referenceNumber}</p>}
          <p>Remaining balance: {formatMoney(receipt.payment.balance)}</p><hr /><p>Authorized signature: __________________</p>
        </article>}
        {(error || notice) && <FeedbackPopup
          type={error ? 'error' : 'success'}
          message={error || notice}
          onClose={() => {
            setError('')
            setNotice('')
          }}
        />}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-gray-800 bg-gray-900/60 p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-2 text-xl font-semibold text-gray-100">{value}</p></div>
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block"><span className={labelClass}>{label}{required ? ' *' : ''}</span>{children}</label>
}

function CalendarDateInput({ value, onChange, required = false }: {
  value: string; onChange: (value: string) => void; required?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return <div className="relative">
    <input
      ref={inputRef}
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

function StudentTable({ students, onManageFees }: {
  students: AdmissionStudentRow[]
  onManageFees: (id: number) => void
}) {
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[1100px] text-left text-xs">
      <thead className="border-b border-gray-800 text-gray-500"><tr>{['Student ID / name', 'Father / contact', 'Class / session', 'Board', 'Roll No', 'Admission status', 'Fee status', 'Slip status', 'Charges', 'Paid', 'Balance', 'Action'].map((head) => <th key={head} className="px-2 py-3 font-medium">{head}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-800">{students.map((student) => <tr key={student.admission_id} className="hover:bg-gray-800/60">
        <td className="px-2 py-3"><span className="block text-brand-300">{student.student_no}</span><span className="text-gray-200">{student.full_name}</span></td>
        <td className="px-2 py-3"><span className="block text-gray-300">{student.father_name}</span><span className="text-gray-500">{student.father_phone || student.phone || '—'}</span></td>
        <td className="px-2 py-3"><span className="block text-gray-200">{student.class_name}</span><span className="text-gray-500">{student.academic_year}</span></td>
        <td className="px-2 py-3 text-gray-300">{student.education_board || '—'}</td>
        <td className="px-2 py-3 text-gray-300">{student.roll_number || '—'}</td>
        <td className="px-2 py-3 text-gray-300">{student.status}</td>
        <td className={`px-2 py-3 ${student.payment_status === 'PAID' ? 'text-emerald-300' : student.payment_status === 'PARTIAL' ? 'text-amber-300' : 'text-red-300'}`}>{student.payment_status}</td>
        <td className="px-2 py-3 text-gray-300">{student.slip_status.replaceAll('_', ' ')}</td>
        <td className="px-2 py-3 text-gray-300">{formatMoney(student.total_charges - student.total_discounts)}</td>
        <td className="px-2 py-3 text-gray-300">{formatMoney(student.total_paid)}</td>
        <td className={`px-2 py-3 ${student.balance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{formatMoney(student.balance)}</td>
        <td className="space-y-1 px-2 py-3 print:hidden">
          <button type="button" onClick={() => onManageFees(student.admission_id)} className="whitespace-nowrap border border-brand-700 px-2.5 py-1.5 font-medium text-brand-300 hover:bg-brand-950">Manage</button>
          {whatsAppUrl(student) && <a className="block whitespace-nowrap px-2.5 py-1 text-emerald-300 hover:text-emerald-200" href={whatsAppUrl(student)!} target="_blank" rel="noreferrer">WhatsApp</a>}
        </td>
      </tr>)}</tbody>
    </table>
    {students.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No students found.</p>}
  </div>
}

function whatsAppUrl(student: AdmissionStudentRow): string | null {
  const rawPhone = student.whatsapp || student.father_phone || student.phone
  if (!rawPhone) return null
  let number = rawPhone.replace(/\D/g, '')
  if (number.startsWith('0')) number = `92${number.slice(1)}`
  if (number.length < 7 || number.length > 15) return null
  const slipMessage: Record<AdmissionStudentRow['slip_status'], string> = {
    PENDING: 'being processed',
    READY_TO_CALL: 'ready for collection',
    CALLED_INFORMED: 'ready for collection; we have already tried to inform you',
    SLIP_DELIVERED: 'issued and delivered'
  }
  const message = `Assalamu Alaikum ${student.father_name}, the roll number slip for ${student.full_name} is ${slipMessage[student.slip_status]}. Please contact the school for details.`
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

function SlipWorkflow({ admission, canManage, onSaved, onError }: {
  admission: AdmissionDetail; canManage: boolean; onSaved: () => Promise<void>; onError: (message: string) => void
}) {
  const [subjects, setSubjects] = useState(admission.subjects ?? '')
  const [rollNumber, setRollNumber] = useState(admission.roll_number ?? '')
  const [registrationNumber, setRegistrationNumber] = useState(admission.registration_number ?? '')
  const [expectedSlipDate, setExpectedSlipDate] = useState(admission.expected_slip_date ?? '')
  const [slipStatus, setSlipStatus] = useState<AdmissionStudentRow['slip_status']>(admission.slip_status)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSubjects(admission.subjects ?? '')
    setRollNumber(admission.roll_number ?? '')
    setRegistrationNumber(admission.registration_number ?? '')
    setExpectedSlipDate(admission.expected_slip_date ?? '')
    setSlipStatus(admission.slip_status)
  }, [admission])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    const result = await window.api.admissionsSlipUpdate({
      admissionId: admission.admission_id, subjects, rollNumber, registrationNumber, expectedSlipDate, slipStatus
    })
    setSaving(false)
    if (!result.ok) return onError(result.error.message)
    await onSaved()
  }

  const reminder = whatsAppUrl(admission)
  return <section className={`${sectionClass} space-y-4`}>
    <div>
      <h3 className="text-sm font-semibold text-gray-100">Roll number & slip workflow</h3>
      <p className="mt-1 text-xs text-gray-500">Track registration details, expected release, and delivery status.</p>
    </div>
    {canManage ? <form onSubmit={(event) => void save(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Subjects / stream"><input className={inputClass} maxLength={300} value={subjects} onChange={(event) => setSubjects(event.target.value)} /></Field>
      <Field label="Official roll number"><input className={inputClass} maxLength={50} value={rollNumber} onChange={(event) => setRollNumber(event.target.value)} /></Field>
      <Field label="Registration number"><input className={inputClass} maxLength={50} value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} /></Field>
      <Field label="Expected slip date"><CalendarDateInput value={expectedSlipDate} onChange={setExpectedSlipDate} /></Field>
      <Field label="Call / delivery status"><select className={inputClass} value={slipStatus} onChange={(event) => setSlipStatus(event.target.value as AdmissionStudentRow['slip_status'])}>
        <option value="PENDING">Pending</option><option value="READY_TO_CALL">Ready to Call</option><option value="CALLED_INFORMED">Called & Informed</option><option value="SLIP_DELIVERED">Slip Delivered</option>
      </select></Field>
      <div className="flex items-end"><button disabled={saving} className="bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{saving ? 'Saving…' : 'Save slip details'}</button></div>
    </form> : <div className="grid gap-3 text-sm text-gray-300 sm:grid-cols-2 lg:grid-cols-3">
      <p>Subjects: {admission.subjects || '—'}</p><p>Roll number: {admission.roll_number || '—'}</p>
      <p>Registration no.: {admission.registration_number || '—'}</p>
      <p>Expected date: {admission.expected_slip_date || '—'}</p><p>Status: {admission.slip_status.replaceAll('_', ' ')}</p>
    </div>}
    {reminder && <a href={reminder} target="_blank" rel="noreferrer" className="inline-flex border border-emerald-800 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950/40">
      Prepare WhatsApp reminder
    </a>}
  </section>
}

function AdmissionDocuments({ admissionId, canManage, onError, onNotice }: {
  admissionId: number; canManage: boolean; onError: (message: string) => void; onNotice: (message: string) => void
}) {
  const [documents, setDocuments] = useState<AdmissionDocumentRow[]>([])
  const [category, setCategory] = useState<AdmissionDocumentCategoryType>('BANK_CHALLAN')
  const [busy, setBusy] = useState(false)

  const loadDocuments = async () => {
    const result = await window.api.admissionsDocuments(admissionId)
    if (result.ok) setDocuments(result.data)
    else onError(result.error.message)
  }

  useEffect(() => {
    if (canManage) void loadDocuments()
  }, [admissionId, canManage])

  const upload = async (file?: File) => {
    if (!file) return
    const mimeType = file.type === 'application/pdf' || file.type === 'image/jpeg' ? file.type : null
    if (!mimeType || file.size > 10 * 1024 * 1024) {
      onError('Choose a PDF or JPG file no larger than 10 MB.')
      return
    }
    setBusy(true)
    let stagedToken: string | null = null
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Could not read the selected file'))
        reader.onerror = () => reject(new Error('Could not read the selected file'))
        reader.readAsDataURL(file)
      })
      const staged = await window.api.admissionsDocumentStage({
        category, originalFilename: file.name, mimeType,
        contentBase64: dataUrl.slice(dataUrl.indexOf(',') + 1)
      })
      if (!staged.ok) throw new Error(staged.error.message)
      stagedToken = staged.data.token
      const saved = await window.api.admissionsDocumentCommit(admissionId, stagedToken)
      if (!saved.ok) throw new Error(saved.error.message)
      stagedToken = null
      await loadDocuments()
      onNotice('Admission document uploaded securely.')
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Document upload failed.')
    } finally {
      if (stagedToken) {
        const discarded = await window.api.admissionsDocumentDiscard(stagedToken)
        if (!discarded.ok) onError(discarded.error.message)
      }
      setBusy(false)
    }
  }

  const openDocument = async (document: AdmissionDocumentRow) => {
    const result = await window.api.admissionsDocumentRead(admissionId, document.id)
    if (!result.ok) return onError(result.error.message)
    const binary = atob(result.data.contentBase64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: result.data.mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const removeDocument = async (documentId: number) => {
    const result = await window.api.admissionsDocumentRemove(admissionId, documentId)
    if (!result.ok) return onError(result.error.message)
    await loadDocuments()
    onNotice('Document removed from the admission record.')
  }

  return <section className={`${sectionClass} space-y-4`}>
    <div>
      <h3 className="text-sm font-semibold text-gray-100">Admission documents</h3>
      <p className="mt-1 text-xs text-gray-500">Encrypted local storage; PDF and JPG only, up to 10 MB per file.</p>
    </div>
    {canManage ? <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Document type"><select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as AdmissionDocumentCategoryType)}>
          <option value="BANK_CHALLAN">Paid bank challan copy</option><option value="ADMISSION_FORM">Submitted admission form</option><option value="ROLL_NUMBER_SLIP">Issued roll number slip</option>
        </select></Field>
        <label className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">
          {busy ? 'Uploading…' : 'Choose PDF/JPG'}
          <input className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg" disabled={busy} onChange={(event) => {
            void upload(event.target.files?.[0])
            event.currentTarget.value = ''
          }} />
        </label>
      </div>
      <ul className="divide-y divide-gray-800">
        {documents.map((document) => <li key={document.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
          <span className="text-gray-300">{document.category.replaceAll('_', ' ')} · {document.original_filename}</span>
          <span className="flex gap-3">
            <button type="button" onClick={() => void openDocument(document)} className="text-brand-300 hover:text-brand-200">Open</button>
            <button type="button" onClick={() => void removeDocument(document.id)} className="text-red-300 hover:text-red-200">Remove</button>
          </span>
        </li>)}
      </ul>
      {documents.length === 0 && <p className="text-xs text-gray-500">No documents uploaded.</p>}
    </> : <p className="text-xs text-gray-500">Document access is limited to Admin and Manager accounts.</p>}
  </section>
}

function FeedbackPopup({ type, message, onClose }: {
  type: 'error' | 'success'
  message: string
  onClose: () => void
}) {
  const isError = type === 'error'
  return <div
    className="fixed right-4 top-4 z-[100] flex w-[min(26rem,calc(100vw-2rem))] items-start gap-3 border border-gray-700 bg-gray-900 p-4 shadow-2xl"
    role={isError ? 'alert' : 'status'}
    aria-live={isError ? 'assertive' : 'polite'}
  >
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`mt-0.5 h-5 w-5 shrink-0 ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
      {isError
        ? <><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="M12 7v6m0 4h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>
        : <><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" /><path d="m8 12 2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
    <div className="min-w-0 flex-1">
      <p className={`text-sm font-semibold ${isError ? 'text-red-300' : 'text-emerald-300'}`}>{isError ? 'Please check' : 'Success'}</p>
      <p className="mt-1 break-words text-sm text-gray-200">{message}</p>
    </div>
    <button type="button" onClick={onClose} className="shrink-0 px-1 text-xs text-gray-400 hover:text-white">Close</button>
  </div>
}

function AdmissionLedger(props: {
  admission: AdmissionDetail; onPayment: (event: FormEvent<HTMLFormElement>) => void;
  onValidationError: (message: string) => void;
  paymentAmount: string; setPaymentAmount: (value: string) => void;
  paymentMethod: PayMethod; setPaymentMethod: (value: PayMethod) => void; paymentReference: string;
  setPaymentReference: (value: string) => void; paymentNotes: string; setPaymentNotes: (value: string) => void;
  busy: boolean; onReceipt: (payment: AdmissionPaymentRow) => void
}) {
  const { admission } = props
  return <section className={`${sectionClass} space-y-5`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-gray-100">{admission.full_name}</h2><p className="text-xs text-gray-500">{admission.student_no} · {admission.father_name} · {admission.class_name} · {admission.academic_year}</p></div>
      <div className="text-right"><p className="text-xs text-gray-500">Outstanding</p><p className={`text-lg font-semibold ${admission.balance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{formatMoney(admission.balance)}</p></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Net charges" value={formatMoney(admission.total_charges - admission.total_discounts)} /><Metric label="Total paid" value={formatMoney(admission.total_paid)} /><Metric label="Admission status" value={admission.status} /></div>
    <div className="overflow-x-auto"><h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">Fee history</h3><table className="w-full min-w-[560px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Fee', 'Period', 'Due date', 'Charge', 'Discount', 'Allocated', 'Balance'].map((head) => <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{admission.charges.map((charge) => <tr key={charge.id}><td className="px-2 py-2 text-gray-200">{charge.description || charge.fee_type}</td><td className="px-2 py-2 text-gray-300">{charge.fee_month || '—'}</td><td className="px-2 py-2 text-gray-300">{charge.due_date || '—'}</td><td className="px-2 py-2 text-gray-300">{formatMoney(charge.amount)}</td><td className="px-2 py-2 text-gray-300">{formatMoney(charge.discount_amount)}</td><td className="px-2 py-2 text-gray-300">{formatMoney(charge.paid_amount)}</td><td className="px-2 py-2 text-gray-300">{formatMoney(charge.balance)}</td></tr>)}</tbody></table>{admission.charges.length === 0 && <p className="py-3 text-xs text-gray-500">No admission fee charge recorded.</p>}</div>
    <form onInvalidCapture={(event) => {
      event.preventDefault()
      props.onValidationError('Enter a payment amount greater than zero and check the other fields.')
    }} onSubmit={props.onPayment} className="grid gap-3 border-t border-gray-800 pt-4 sm:grid-cols-2 xl:grid-cols-6">
      <Field label="Payment amount (PKR)" required><input className={inputClass} type="number" min="1" max="100000000" step="1" required value={props.paymentAmount} onChange={(event) => props.setPaymentAmount(event.target.value)} /></Field>
      <Field label="Method"><select className={inputClass} value={props.paymentMethod} onChange={(event) => props.setPaymentMethod(event.target.value as PayMethod)}><option value="CASH">Cash</option><option value="BANK">Bank transfer</option><option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option></select></Field>
      <Field label="TRANSACTION REFERENCE (OPTIONAL)"><input className={inputClass} value={props.paymentReference} onChange={(event) => props.setPaymentReference(event.target.value)} /></Field>
      <Field label="NOTES (OPTIONAL)"><input className={inputClass} value={props.paymentNotes} onChange={(event) => props.setPaymentNotes(event.target.value)} /></Field>
      <div className="flex items-end xl:col-span-2"><button disabled={props.busy} className="bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{props.busy ? 'Saving…' : 'Collect fee'}</button></div>
    </form>
    <div className="overflow-x-auto"><h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">Payment history</h3><table className="w-full min-w-[600px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Receipt', 'Date', 'Method', 'Reference', 'Amount', 'Receipt copy'].map((head) => <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{admission.payments.map((payment) => <tr key={payment.id}><td className="px-2 py-2 text-brand-300">{payment.receipt_no}</td><td className="px-2 py-2 text-gray-300">{payment.paid_at}</td><td className="px-2 py-2 text-gray-300">{payment.method}</td><td className="px-2 py-2 text-gray-300">{payment.reference_no || '—'}</td><td className="px-2 py-2 text-gray-200">{formatMoney(payment.amount)}</td><td className="px-2 py-2"><button type="button" onClick={() => props.onReceipt(payment)} className="text-brand-300 hover:text-brand-200">Reprint</button></td></tr>)}</tbody></table>{admission.payments.length === 0 && <p className="py-3 text-xs text-gray-500">No payments recorded yet.</p>}</div>
  </section>
}
